// 옆모습 사진칸: 사진 올리기 → 옆얼굴 실루엣(윤곽선) 추출 → 윤곽선 위에서 8점 자동 찾기 → 상담사가 끌어서 맞춤 → 측정
import { FilesetResolver, ImageSegmenter } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
import { PROFILE_POINTS, measureProfile, describeProfile } from './rules.js';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const SEG_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';
let segPromise = null;
function getSegmenter() {
  if (!segPromise) {
    segPromise = FilesetResolver.forVisionTasks(WASM).then((fs) => ImageSegmenter.createFromOptions(fs, {
      baseOptions: { modelAssetPath: SEG_MODEL, delegate: 'CPU' },
      runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false,
    }));
    segPromise.catch(() => { segPromise = null; });
  }
  return segPromise;
}

// 사람 영역 마스크 (한 번만 계산해서 양쪽 방향에 같이 씀)
async function segmentPerson(img) {
  const W = img.naturalWidth, H = img.naturalHeight;
  const k = Math.min(1, 1200 / Math.max(W, H));
  const w = Math.round(W * k), h = Math.round(H * k);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const c2 = cv.getContext('2d', { willReadFrequently: true });
  c2.drawImage(img, 0, 0, w, h);
  const seg = await getSegmenter();
  const res = seg.segment(cv);
  const mask = res.confidenceMasks[0];
  const mw = mask.width, mh = mask.height;
  const conf = mask.getAsFloat32Array().slice();
  res.close?.();
  const data = c2.getImageData(0, 0, w, h).data;
  return { w, h, k, mw, mh, conf, data };
}

// 행마다 얼굴 앞쪽 끝(윤곽선) x 를 찾고, 밝기 경계로 정밀하게 맞춤
function silhouette(sp, dir) {
  const { w, h, k, mw, mh, conf, data } = sp;
  const lum = (x, y) => { const i = (y * w + x) * 4; return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; };
  const r = Math.max(3, Math.round((w / mw) * 3));
  const raw = new Array(h).fill(null);
  for (let y = 0; y < h; y++) {
    const my = Math.min(mh - 1, Math.floor((y * mh) / h));
    let mx = -1;
    if (dir < 0) { for (let x = 0; x < mw; x++) if (conf[my * mw + x] > 0.5) { mx = x; break; } }
    else { for (let x = mw - 1; x >= 0; x--) if (conf[my * mw + x] > 0.5) { mx = x; break; } }
    if (mx < 0) continue;
    const x0 = Math.round(((mx + 0.5) * w) / mw);
    let best = x0, bg = -1;
    for (let x = Math.max(1, x0 - r); x < Math.min(w - 1, x0 + r); x++) {
      const g = Math.abs(lum(x + 1, y) - lum(x - 1, y));
      if (g > bg) { bg = g; best = x; }
    }
    raw[y] = best;
  }
  const edge = raw.map((v, y) => {
    if (v == null) return null;
    const arr = [];
    for (let d = -3; d <= 3; d++) { const u = raw[y + d]; if (u != null) arr.push(u); }
    arr.sort((a, b) => a - b);
    return arr[arr.length >> 1];
  });
  return { edge, k, h };
}

// 윤곽선을 따라 내려가며 튀어나온 곳(코끝·이마·입술·턱끝)과 들어간 곳(코뿌리·코밑)을 찾음
function snapToOutline(guides, sil, dir) {
  const { edge, k, h } = sil;
  const F = (y) => (edge[y] == null ? null : dir * edge[y]);
  const G = {};
  for (const key in guides) G[key] = { x: guides[key].x * k, y: guides[key].y * k };
  const L = Math.abs(G.chin.y - G.nasion.y) || h * 0.3;
  const arg = (y0, y1, mode) => {
    y0 = Math.max(0, Math.round(y0)); y1 = Math.min(h - 1, Math.round(y1));
    let by = null, bv = null;
    for (let y = y0; y <= y1; y++) {
      const v = F(y);
      if (v == null) continue;
      if (bv == null || (mode === 'max' ? v > bv : v < bv)) { bv = v; by = y; }
    }
    return by;
  };
  // 두 윤곽점 a, b 를 잇는 선 기준으로 가장 안쪽(오목)/바깥쪽(볼록)인 윤곽점
  const chordArg = (a, b, mode) => {
    const A = { x: edge[a], y: a }, B = { x: edge[b], y: b };
    const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
    let by = null, bv = null;
    for (let y = a + 1; y < b; y++) {
      if (edge[y] == null) continue;
      const v = (((B.y - A.y) * (edge[y] - A.x) - (B.x - A.x) * (y - A.y)) / len) * dir;
      if (bv == null || (mode === 'max' ? v > bv : v < bv)) { bv = v; by = y; }
    }
    return by;
  };

  // 윤곽선을 한 방향으로 따라가며 처음 나오는 골(min)/봉우리(max). thr 만큼 반대로 꺾이면 멈춤
  const walk = (y0, step, want, thr, maxLen) => {
    let best = y0, bv = F(y0);
    for (let y = y0 + step, n = 0; y >= 0 && y < h && n < maxLen; y += step, n++) {
      const v = F(y);
      if (v == null) continue;
      if (bv == null || (want === 'min' ? v < bv : v > bv)) { bv = v; best = y; }
      else if (Math.abs(v - bv) > thr) break;
    }
    return best;
  };
  const thrS = Math.max(1.5, 0.01 * L), thrB = Math.max(2, 0.02 * L);
  const S = (f) => Math.round(f * L); // 점 사이 최대 거리

  const tip = arg(G.nasion.y + 0.1 * L, G.nasion.y + 0.65 * L, 'max');          // 코끝: 가장 튀어나온 곳
  if (tip == null) return null;
  const nasion = walk(tip, -1, 'min', thrS, S(0.5));                               // 코끝에서 위로: 처음 들어간 곳 = 코뿌리
  const glabella = walk(nasion, -1, 'max', thrB, S(0.25));                         // 더 위로: 눈썹뼈(미간) 돌출
  const sub = walk(tip, 1, 'min', thrS, S(0.25));                                  // 코끝에서 아래로: 처음 들어간 곳 = 코밑
  const lip = walk(sub, 1, 'max', thrB, S(0.25));                                  // 다음 봉우리 = 입술
  // 턱 아래 끝(멘톤): 입술 아래에서 윤곽선이 목 쪽(뒤)으로 급하게 꺾이기 시작하는 곳
  //  - 입술 아래 골(잠깐 들어갔다 다시 나옴)과 구분하려고, 이후 일정 구간 동안 계속 크게 물러나는지 확인
  let menton = null;
  const win = Math.max(4, S(0.12));
  for (let y = lip + S(0.18); y < Math.min(h - win - 1, lip + S(0.8)); y++) {
    if (edge[y] == null || edge[y + win] == null || edge[y + 3] == null) continue;
    const backNow = (-dir * (edge[y + 3] - edge[y])) / 3;   // 지금 한 줄당 물러나는 양
    const backWin = -dir * (edge[y + win] - edge[y]);        // 앞으로 win 줄 동안 물러나는 총량
    if (backNow > 1 && backWin > 0.25 * L) { menton = y; break; }
  }
  if (menton == null) menton = walk(walk(lip, 1, 'min', thrB, S(0.25)), 1, 'max', thrB, S(0.3));
  // 턱끝(연조직 포고니온): 아랫입술~턱 아래 끝을 잇는 선에서 가장 앞으로 나온 곳
  // (입술 바로 아래 골에 걸리지 않게 입술에서 조금 내려간 곳부터 찾음)
  const chinFrom = Math.min(lip + S(0.1), menton - 1);
  const chin = chordArg(chinFrom, menton, 'max') ?? menton;
  if (new Set([tip, nasion, sub, lip, chin]).size < 5 || !(glabella < nasion && chin > lip)) return null;
  const pt = (y) => ({ x: edge[y] / k, y: y / k });
  let hy = Math.min(glabella - Math.round(0.3 * L), Math.round(G.hair.y));         // 헤어라인: 대략 위치에서 윤곽선 위로
  while (hy < glabella && edge[hy] == null) hy++;
  const forehead = chordArg(hy, nasion, 'max') ?? glabella;                        // 이마: 헤어라인~코뿌리 사이 가장 볼록한 곳
  let dy = Math.round((nasion + tip) / 2);
  while (dy < tip && edge[dy] == null) dy++;
  return { hair: pt(hy), forehead: pt(forehead), nasion: pt(nasion), dorsum: pt(dy), tip: pt(tip), subnasale: pt(sub), lip: pt(lip), chin: pt(chin), menton: pt(menton) };
}

// 얼굴 인식이 옆모습을 잡았을 때 쓸 랜드마크 (얼굴 가운데 세로선)
const LM = { forehead: 151, nasion: 168, dorsum: 197, tip: 1, subnasale: 2, lip: 0, chin: 175 };
// 인식이 안 될 때 기본 위치 (왼쪽을 보는 옆모습 기준, 이미지 비율)
const TEMPLATE = {
  hair: [0.50, 0.20], forehead: [0.44, 0.29], nasion: [0.45, 0.39], dorsum: [0.42, 0.44],
  tip: [0.37, 0.50], subnasale: [0.43, 0.53], lip: [0.42, 0.59], chin: [0.44, 0.69],
};
// 옆모습 턱각(하악각) 점 3개: 귀 아래 턱 뒷선 → 턱 모서리 → 턱 아래 선
const JAW_POINTS = [
  { key: 'ramus', label: '턱 뒷선' },
  { key: 'gonion', label: '턱 모서리' },
  { key: 'jawFront', label: '턱 아래 선' },
];
const JAW_COLOR = '#0e7c86';
const COLORS = { hair: '#c0392b', forehead: '#e0a526', nasion: '#5b3f8c', dorsum: '#5b3f8c', tip: '#c2185b', subnasale: '#2f8f7d', lip: '#c2185b', chin: '#17131d' };

export function initProfile({ getLandmarker, onChange }) {
  const $ = (id) => document.getElementById(id);
  const canvas = $('pCanvas'), ctx = canvas.getContext('2d');
  const st = { img: null, pts: null, initial: null, ready: false, auto: false, drag: null, dir: -1, jaw: null, jawMoved: false, showLabels: true };
  $('pBtnLabels').addEventListener('click', () => {
    st.showLabels = !st.showLabels;
    $('pBtnLabels').textContent = st.showLabels ? '글자 숨기기' : '글자 보기';
    draw();
  });

  // 턱각 점 3개의 처음 위치 (대략적인 자리 — 머리카락에 가려지는 경우가 많아 상담사가 맞추는 것이 기본)
  function placeJaw() {
    const p = st.pts, dir = st.dir || -1;
    const L = Math.hypot(p.nasion.x - p.chin.x, p.nasion.y - p.chin.y);
    const front = p.menton || { x: p.chin.x - dir * 0.08 * L, y: p.chin.y + 0.08 * L };
    // 턱 모서리는 보통 귀 아래, 턱끝에서 얼굴 길이(코뿌리~턱끝)만큼 뒤쪽
    const gonion = { x: p.chin.x - dir * 0.95 * L, y: p.chin.y - 0.15 * L };
    const ramus = { x: gonion.x + dir * 0.06 * L, y: gonion.y - 0.4 * L };
    st.jaw = { ramus, gonion, jawFront: { x: front.x - dir * 0.3 * L, y: front.y + 0.02 * L } };
    st.jawMoved = false;
  }
  function jawAngle() {
    const { ramus: A, gonion: O, jawFront: B } = st.jaw;
    const v1 = { x: A.x - O.x, y: A.y - O.y }, v2 = { x: B.x - O.x, y: B.y - O.y };
    const n = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
    if (n < 4) return null;
    return (Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / n))) * 180) / Math.PI;
  }
  window.__profile = st;

  const pick = () => $('pFile').click();
  $('pDrop').addEventListener('click', pick);
  $('pBtnFile').addEventListener('click', pick);
  $('pFile').addEventListener('change', (e) => e.target.files[0] && load(e.target.files[0]));
  // 옆모습 칸에 끌어다 놓은 사진은 옆모습으로 받음 (정면 칸으로 전달되지 않게 막음)
  const box = $('profileBox');
  ['dragover', 'dragenter'].forEach((t) => box.addEventListener(t, (e) => { e.preventDefault(); e.stopPropagation(); $('pDrop').classList.add('over'); }));
  box.addEventListener('dragleave', (e) => { e.stopPropagation(); $('pDrop').classList.remove('over'); });
  box.addEventListener('drop', (e) => {
    e.preventDefault(); e.stopPropagation(); $('pDrop').classList.remove('over');
    const f = e.dataTransfer?.files?.[0];
    if (f && f.type.startsWith('image/')) load(f);
  });

  $('pBtnReset').addEventListener('click', () => {
    if (!st.initial) return;
    st.pts = clone(st.initial); st.ready = st.auto;
    placeJaw();
    update();
  });
  $('pBtnClear').addEventListener('click', () => {
    Object.assign(st, { img: null, pts: null, initial: null, ready: false, auto: false, jaw: null, jawMoved: false });
    canvas.hidden = true; $('pDrop').hidden = false;
    $('pBtnReset').disabled = $('pBtnClear').disabled = $('pBtnFlip').disabled = $('pBtnZoom').disabled = true;
    $('pResult').innerHTML = '';
    setStatus('옆모습 사진이 없으면 콧대·입체감은 직접 골라 주세요.');
    onChange(null);
  });

  function setStatus(msg) { $('pStatus').textContent = msg; }
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function load(file) {
    const img = new Image();
    img.onload = () => {
      st.img = img;
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      canvas.hidden = false; $('pDrop').hidden = true;
      $('pBtnReset').disabled = $('pBtnClear').disabled = $('pBtnFlip').disabled = $('pBtnZoom').disabled = false;
      st.pts = null; draw();
      place();
    };
    img.src = URL.createObjectURL(file);
  }

  // 1) 얼굴 인식으로 대략 위치·방향 → 2) 실루엣 윤곽선에 붙이기 → 실패하면 기본 위치
  async function place(forceDir) {
    const img = st.img;
    const W = img.naturalWidth, H = img.naturalHeight;
    let guides = null, dir = forceDir || -1;
    const lmk = getLandmarker();
    if (lmk && !forceDir) {
      try {
        const lm = lmk.detect(img).faceLandmarks?.[0];
        if (lm) {
          const p = (i) => ({ x: lm[i].x * W, y: lm[i].y * H });
          guides = {};
          for (const [k, i] of Object.entries(LM)) guides[k] = p(i);
          const top = p(10);
          guides.hair = { x: top.x, y: top.y - (guides.nasion.y - top.y) * 0.5 };
          dir = Math.sign(guides.tip.x - (guides.nasion.x + guides.chin.x) / 2) || -1;
        }
      } catch (e) { console.warn(e); }
    }
    if (!guides) {
      guides = { __template: true };
      for (const [k, [x, y]] of Object.entries(TEMPLATE)) guides[k] = { x: (dir < 0 ? x : 1 - x) * W, y: y * H };
    }
    setStatus('옆얼굴 윤곽선을 찾는 중…');
    // 얼굴 인식이 옆모습에서는 방향을 자주 틀리므로, 왼쪽·오른쪽 양쪽으로 윤곽을 찾아보고
    // 코끝이 더 뚜렷하게 튀어나오는 쪽을 얼굴 방향으로 고름
    let pts = null;
    try {
      const sp = await segmentPerson(img);
      if (st.img !== img) return; // 그 사이 다른 사진으로 바뀜
      let best = null;
      for (const d of [dir, -dir]) {
        const cand = snapToOutline(guides, silhouette(sp, d), d);
        const pm = cand && measureProfile(cand);
        const score = pm ? pm.noseProj : -Infinity;
        if (cand && (!best || score > best.score)) best = { pts: cand, dir: d, score };
      }
      if (best && best.score > 0.05) { pts = best.pts; dir = best.dir; }
    } catch (e) { console.warn('윤곽선 추출 실패', e); }
    st.dir = dir;
    if (!pts && guides.__template && dir > 0) guides = mirrorTemplate(W, H); // 기본 위치도 얼굴 방향에 맞춤
    st.auto = !!pts;
    st.pts = pts || guides; delete st.pts.__template; st.initial = clone(st.pts); st.ready = st.auto;
    placeJaw();
    setStatus(st.auto
      ? `옆얼굴 윤곽선에서 점을 자동으로 찾았어요 (얼굴이 ${dir < 0 ? '왼쪽' : '오른쪽'}을 봄). 위치를 확인하고, 다르면 끌어서 맞춰 주세요.`
      : '윤곽선을 자동으로 찾지 못해 대략적인 위치에 놓았어요. 점 8개를 옆얼굴 윤곽선에 끌어서 맞춰 주세요.');
    update();
  }

  function mirrorTemplate(W, H) {
    const g = {};
    for (const [k, [x, y]] of Object.entries(TEMPLATE)) g[k] = { x: (1 - x) * W, y: y * H };
    return g;
  }

  // 좌우 반전: 사진을 거울처럼 뒤집고 다시 분석
  $('pBtnFlip').addEventListener('click', () => {
    if (!st.img) return;
    const cv = document.createElement('canvas');
    cv.width = st.img.naturalWidth; cv.height = st.img.naturalHeight;
    const c2 = cv.getContext('2d');
    c2.translate(cv.width, 0); c2.scale(-1, 1); c2.drawImage(st.img, 0, 0);
    cv.toBlob((blob) => blob && load(blob), 'image/png');
  });

  function update() {
    draw();
    if (!st.ready) {
      $('pResult').innerHTML = '<div class="muted">점을 옆얼굴 윤곽에 맞추면 측정값이 나와요.</div>';
      onChange(null);
      return;
    }
    const pm = measureProfile(st.pts);
    if (pm) pm.jawAngle = st.jaw && st.jawMoved ? jawAngle() : null;
    if (!pm) {
      $('pResult').innerHTML = '<div class="muted">점이 서로 겹쳐 있어 잴 수 없어요. 점을 옆얼굴 윤곽에 맞춰 주세요.</div>';
      onChange(null);
      return;
    }
    $('pResult').innerHTML = `<table class="meas">${describeProfile(pm).map((d) =>
      `<tr><td>${d.label}<br><span class="muted">${d.val}</span></td><td>${d.text}</td></tr>`).join('')}</table>`;
    onChange(pm);
  }

  const scale = () => Math.max(1.5, Math.hypot(st.pts.nasion.x - st.pts.chin.x, st.pts.nasion.y - st.pts.chin.y) / 110);
  const radius = () => scale() * 4.5;

  function draw() {
    if (!st.img) return;
    ctx.drawImage(st.img, 0, 0);
    if (!st.pts) return;
    const s = scale(), p = st.pts;
    const line = (a, b, color, dash) => {
      ctx.setLineDash(dash ? [s * 4, s * 3] : []);
      ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = s * 2.6;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = s * 1.2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    };
    // 옆얼굴 윤곽 연결선
    const order = ['hair', 'forehead', 'nasion', 'dorsum', 'tip', 'subnasale', 'lip', 'chin'];
    for (let i = 0; i < order.length - 1; i++) line(p[order[i]], p[order[i + 1]], 'rgba(23,19,29,.55)', false);
    // 측정 기준선
    line(p.forehead, p.chin, '#5b3f8c', true);   // 입체감 기준
    line(p.nasion, p.subnasale, '#2f8f7d', true); // 콧대 높이 기준
    line(p.tip, p.chin, '#c2185b', true);         // E라인
    ctx.setLineDash([]);
    const dir = Math.sign(p.tip.x - (p.nasion.x + p.chin.x) / 2) || -1;
    // 턱각 점 3개와 각도
    if (st.jaw) {
      const J = st.jaw;
      line(J.ramus, J.gonion, JAW_COLOR, !st.jawMoved);
      line(J.gonion, J.jawFront, JAW_COLOR, !st.jawMoved);
      ctx.setLineDash([]);
      for (const def of JAW_POINTS) {
        const q = J[def.key], r = radius() * 0.85;
        ctx.beginPath(); ctx.rect(q.x - r, q.y - r, r * 2, r * 2);
        ctx.fillStyle = st.jawMoved ? JAW_COLOR : 'rgba(255,255,255,.95)'; ctx.fill();
        ctx.lineWidth = s * 1.4; ctx.strokeStyle = JAW_COLOR; ctx.stroke();
      }
      if (st.showLabels) {
        // 글자는 선을 가리지 않게 '선 바깥쪽'에: 양 끝 점은 선이 끝나는 방향 너머로, 모서리는 각의 바깥쪽으로
        const unit = (a, b) => { const dx = b.x - a.x, dy = b.y - a.y, n = Math.hypot(dx, dy) || 1; return { x: dx / n, y: dy / n }; };
        const u1 = unit(J.gonion, J.ramus), u2 = unit(J.gonion, J.jawFront);
        let out = { x: -(u1.x + u2.x), y: -(u1.y + u2.y) };
        const on = Math.hypot(out.x, out.y) || 1; out = { x: out.x / on, y: out.y / on };
        const off = radius() * 2.4;
        const a = st.jawMoved ? jawAngle() : null;
        const labelAt = (text, q, d, bold) => {
          ctx.font = `${bold ? 800 : 700} ${Math.round(s * (bold ? 6.5 : 5.5))}px "Malgun Gothic", sans-serif`;
          ctx.textAlign = d.x > 0.3 ? 'left' : d.x < -0.3 ? 'right' : 'center';
          ctx.textBaseline = d.y > 0.3 ? 'top' : d.y < -0.3 ? 'bottom' : 'middle';
          const x = q.x + d.x * off, y = q.y + d.y * off;
          ctx.lineWidth = s * 2.2; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeText(text, x, y);
          ctx.fillStyle = JAW_COLOR; ctx.fillText(text, x, y);
        };
        labelAt('턱 뒷선', J.ramus, u1, false);
        labelAt('턱 아래 선', J.jawFront, u2, false);
        labelAt(a != null ? `턱 모서리 ${Math.round(a)}°` : '턱 모서리 (네모 점 3개를 턱선에 맞춰 주세요)', J.gonion, out, true);
      }
    }
    for (const def of PROFILE_POINTS) {
      const q = p[def.key];
      ctx.beginPath(); ctx.arc(q.x, q.y, radius(), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.fill();
      ctx.lineWidth = s * 1.4; ctx.strokeStyle = COLORS[def.key]; ctx.stroke();
      // 라벨은 얼굴 뒤쪽(머리 쪽)에 표시
      if (!st.showLabels) continue;
      ctx.font = `700 ${Math.round(s * 7)}px "Malgun Gothic", sans-serif`;
      ctx.textAlign = dir < 0 ? 'left' : 'right'; ctx.textBaseline = 'middle';
      const tx = q.x - dir * radius() * 2;
      ctx.lineWidth = s * 2.5; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeText(def.label, tx, q.y);
      ctx.fillStyle = COLORS[def.key]; ctx.fillText(def.label, tx, q.y);
    }
  }

  const imgPoint = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height };
  };
  const hit = (pt) => {
    if (!st.pts) return null;
    let best = null, bd = radius() * 2.4;
    for (const def of PROFILE_POINTS) {
      const q = st.pts[def.key];
      const d = Math.hypot(q.x - pt.x, q.y - pt.y);
      if (d < bd) { best = def.key; bd = d; }
    }
    if (st.jaw) for (const def of JAW_POINTS) {
      const q = st.jaw[def.key];
      const d = Math.hypot(q.x - pt.x, q.y - pt.y);
      if (d < bd) { best = 'jaw:' + def.key; bd = d; }
    }
    return best;
  };
  canvas.addEventListener('pointerdown', (e) => {
    const k = hit(imgPoint(e));
    if (!k) return;
    e.preventDefault(); // 점을 잡으면 사진 이동보다 우선
    st.drag = k; try { canvas.setPointerCapture(e.pointerId); } catch {} canvas.style.cursor = 'move';
  });
  canvas.addEventListener('pointermove', (e) => {
    const pt = imgPoint(e);
    if (!st.drag) { canvas.style.cursor = hit(pt) ? 'move' : ''; return; }
    if (st.drag.startsWith('jaw:')) { st.jaw[st.drag.slice(4)] = pt; st.jawMoved = true; }
    else { st.pts[st.drag] = pt; st.ready = true; }
    update();
  });
  const end = () => { st.drag = null; canvas.style.cursor = ''; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  // 레포트용: 옆모습 점들(윤곽 8개 + 턱각 3개)의 위치
  return {
    points: () => (st.pts ? [...PROFILE_POINTS.map((d) => st.pts[d.key]), ...(st.jaw ? Object.values(st.jaw) : [])].filter(Boolean) : []),
  };
}
