import { FaceLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
import { measure, quality, classifyShape, classifyType, autoShapeAnswers, SHAPE_ITEMS, TYPE_ITEMS, TYPES, SHAPES, CONFIG } from './rules.js';
const CONFIG_R = CONFIG.shapeBase.R[0]; // 화면·레포트에 보여줄 세로÷가로 '보통' 기준
import { initProfile } from './profile.js';
import { setupZoom } from './zoom.js';
import { faceContour, OVAL_L, OVAL_R } from './facecontour.js';
import { reportHTML, reportDocument, REPORT_CSS } from './report.js';
import { describeProfile } from './rules.js';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const FACE_OVAL = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];

const $ = (id) => document.getElementById(id);
const canvas = $('canvas'), ctx = canvas.getContext('2d');
const state = { img: null, lm: null, hairline: null, overrides: {}, drag: null, smile: 0, showLines: true,
  answers: {}, shapeAnswers: {}, finalShape: '', finalType: '', m: null, q: null, pm: null, contour: null, snap: {} };

// 옆모습 측정값으로 콧대·입체감·코 형태 항목 채우기 (상담사가 직접 고른 값은 유지)
function applyProfile() {
  for (const it of TYPE_ITEMS) {
    if (!it.profile) continue;
    const cur = state.answers[it.id];
    if (cur?.src === 'manual') continue;
    if (state.pm) {
      const a = it.profile(state.pm);
      state.answers[it.id] = { v: a.v, src: it.profileHint ? 'hint' : 'auto', val: a.val };
    } else {
      delete state.answers[it.id];
    }
  }
}

// 끌어서 옮길 수 있는 측정점
const HANDLES = [
  { key: 'hair', label: '헤어라인', color: '#c0392b' },
  { key: 9, label: '미간', color: '#17131d' },
  { key: 2, label: '코 밑', color: '#17131d' },
  { key: 152, label: '턱 끝', color: '#17131d' },
  { key: 17, label: '아랫입술', color: '#c2185b' },
  { key: 54, label: '이마', color: '#e0a526' }, { key: 284, label: '이마', color: '#e0a526' },
  { key: 234, label: '광대', color: '#5b3f8c' }, { key: 454, label: '광대', color: '#5b3f8c' },
  { key: 172, label: '턱 모서리', color: '#2f8f7d' }, { key: 397, label: '턱 모서리', color: '#2f8f7d' },
];
let landmarker = null;
window.__face = state; // 기준값 보정용 (개발자 콘솔에서 측정값 확인)

function setStatus(msg, err = false) { const s = $('status'); s.textContent = msg; s.classList.toggle('err', err); }

async function init() {
  try {
    const fs = await FilesetResolver.forVisionTasks(WASM);
    landmarker = await FaceLandmarker.createFromOptions(fs, {
      baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' },
      runningMode: 'IMAGE', numFaces: 1, outputFaceBlendshapes: true,
    });
    setStatus('준비됐어요. 정면 사진을 올려 주세요.');
    if (state.img) detect();
  } catch (e) {
    console.error(e);
    setStatus('얼굴 인식 모델을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.', true);
  }
}

// ───────── 사진 입력 ─────────
const pick = () => $('file').click();
$('drop').addEventListener('click', pick);
$('btnFile').addEventListener('click', pick);
$('file').addEventListener('change', (e) => e.target.files[0] && loadFile(e.target.files[0]));
['dragover', 'dragenter'].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); $('drop').classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); $('drop').classList.remove('over'); }));
document.addEventListener('drop', (e) => { const f = e.dataTransfer?.files?.[0]; if (f && f.type.startsWith('image/')) loadFile(f); });

// 결과 칸을 처음 상태로 (얼굴을 못 찾았을 때 이전 사람 결과가 남지 않게)
function clearResults(msg) {
  state.m = null; state.q = null;
  $('rpMake').disabled = $('rpPrint').disabled = $('rpPdf').disabled = $('rpImg').disabled = true;
  $('rpPreview').innerHTML = '';
  $('rpStatus').textContent = '정면 사진을 분석하면 레포트를 만들 수 있어요.';
  for (const id of ['shapeBody', 'typeBody']) { $(id).classList.add('empty'); $(id).textContent = msg; }
  $('qBody').textContent = msg;
}

let lastUrl = null;
function loadFile(file) {
  const img = new Image();
  if (lastUrl) URL.revokeObjectURL(lastUrl);
  lastUrl = URL.createObjectURL(file);
  img.onerror = () => setStatus('이 사진 파일을 열 수 없어요. 아이폰 HEIC 사진은 JPG로 바꿔서 올려 주세요.', true);
  img.onload = () => {
    state.img = img; state.hairline = null; state.overrides = {}; state.answers = {}; state.lm = null;
    state.shapeAnswers = {}; state.finalShape = ''; state.finalType = ''; state.contour = null; state.snap = {}; state.autoHairline = null;
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    canvas.hidden = false; $('drop').hidden = true; $('btnZoom').disabled = false;
    draw();
    clearResults('분석 중이에요…');
    if (landmarker) detect(); else setStatus('모델을 불러오는 중이에요. 잠시 후 자동으로 분석합니다.');
  };
  img.src = lastUrl;
}

function detect() {
  setStatus('얼굴을 찾는 중…');
  const res = landmarker.detect(state.img);
  if (!res.faceLandmarks?.length) {
    state.lm = null; draw();
    clearResults('이 사진에서 얼굴을 찾지 못해 결과가 없어요.');
    setStatus('얼굴을 찾지 못했어요. 얼굴이 크게 나온 정면 사진으로 다시 시도해 주세요.', true);
    $('btnReset').disabled = $('btnLines').disabled = true;
    return;
  }
  state.lm = res.faceLandmarks[0];
  const bs = res.faceBlendshapes?.[0]?.categories || [];
  const score = (n) => bs.find((c) => c.categoryName === n)?.score ?? 0;
  state.smile = (score('mouthSmileLeft') + score('mouthSmileRight')) / 2;
  $('btnReset').disabled = $('btnLines').disabled = false;
  state.contour = null; state.snap = {}; state.autoHairline = null;
  analyze();
  findContour(state.img, state.lm);
}

// 실제 얼굴 피부 윤곽선을 찾아 폭 측정점(이마·광대·턱·턱끝)을 윤곽선에 붙임
async function findContour(img, lm) {
  setStatus('실제 얼굴 윤곽선을 찾는 중…');
  try {
    const c = await faceContour(img, lm);
    if (state.img !== img) return;
    const W = img.naturalWidth, H = img.naturalHeight;
    const snap = {};
    const pairs = [[54, 284], [234, 454], [172, 397], [149, 378]];
    for (const [l, r] of pairs) {
      for (const [i, side] of [[l, 'L'], [r, 'R']]) {
        const y = lm[i].y * H, x = c.at(side, y);
        // 그 높이의 피부 경계가 머리카락 경계라면(얼굴선이 가려짐) 붙이지 않고 얼굴 인식이 추정한 얼굴선 위치를 씀
        if (x != null && !c.isHidden(side, y)) snap[i] = { x, y };
      }
    }
    // 턱 폭 점은 입꼬리 높이 고정 대신, 윤곽선이 실제로 꺾이는 턱 모서리에 둠 (그쪽 얼굴선이 많이 가려졌으면 제외)
    if (c.jaw.L && c.hiddenSide.L <= 0.3) snap[172] = { x: c.jaw.L.x, y: c.jaw.L.y };
    if (c.jaw.R && c.hiddenSide.R <= 0.3) snap[397] = { x: c.jaw.R.x, y: c.jaw.R.y };
    state.contour = c.coverage > 0.3 ? c : null;
    state.autoHairline = c.hairline;
    state.snap = state.contour ? snap : {};
    setStatus(state.contour
      ? '분석 완료. 흰 선이 실제 얼굴 윤곽이에요. 점이 어긋나 있으면 끌어서 맞춰 주세요.'
      : '얼굴 윤곽이 머리카락 등에 많이 가려 평균 얼굴선을 썼어요. 점을 끌어서 실제 윤곽에 맞춰 주세요.');
  } catch (e) {
    console.warn('윤곽선 추출 실패', e);
    setStatus('윤곽선 자동 추출에 실패해 평균 얼굴선을 썼어요. 점을 끌어서 실제 윤곽에 맞춰 주세요.');
  }
  analyze();
}

// ───────── 측정점 끌어서 옮기기 ─────────
$('btnReset').addEventListener('click', () => {
  state.hairline = null; state.overrides = {};
  analyze();
});
$('btnLines').addEventListener('click', () => {
  state.showLines = !state.showLines;
  $('btnLines').textContent = state.showLines ? '측정선 숨기기' : '측정선 보기';
  draw();
});

function imgPoint(e) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height };
}
function handlePos(key) {
  if (key === 'hair') return state.m.hairlineImg;
  return state.overrides[key] || state.snap?.[key] || { x: state.lm[key].x * canvas.width, y: state.lm[key].y * canvas.height };
}
function hitHandle(pt) {
  if (!state.m || !state.showLines) return null;
  const r = handleRadius() * 2.2;
  let best = null, bd = Infinity;
  for (const h of HANDLES) {
    const p = handlePos(h.key);
    const d = Math.hypot(p.x - pt.x, p.y - pt.y);
    if (d < r && d < bd) { best = h; bd = d; }
  }
  return best;
}
const handleRadius = () => Math.max(5, state.m.faceWidthPx / 40);

canvas.addEventListener('pointerdown', (e) => {
  const h = hitHandle(imgPoint(e));
  if (!h) return;
  e.preventDefault(); // 점을 잡으면 사진 이동보다 우선
  state.drag = h; try { canvas.setPointerCapture(e.pointerId); } catch {} canvas.style.cursor = 'move';
  e.preventDefault();
});
canvas.addEventListener('pointermove', (e) => {
  const pt = imgPoint(e);
  if (!state.drag) { canvas.style.cursor = hitHandle(pt) ? 'move' : ''; return; }
  if (state.drag.key === 'hair') state.hairline = pt; else state.overrides[state.drag.key] = pt;
  scheduleAnalyze();
});
// 끄는 동안은 화면 갱신 주기에 맞춰 한 번씩만 다시 계산 (큰 사진에서 버벅임 방지)
let analyzePending = false;
function scheduleAnalyze() {
  if (analyzePending) return;
  analyzePending = true;
  requestAnimationFrame(() => { analyzePending = false; analyze(); });
}
const endDrag = () => { state.drag = null; canvas.style.cursor = ''; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// ───────── 분석 ─────────
function analyze() {
  const { img, lm } = state;
  if (!img || !lm) return; // 정면 사진 분석 전에는 아무것도 하지 않음
  const m = measure(lm, img.naturalWidth, img.naturalHeight, state.hairline || state.autoHairline, { ...state.snap, ...state.overrides }, state.contour);
  m.hairlineAuto = !state.hairline && !!state.autoHairline;
  m.profJawAngle = state.pm?.jawAngle ?? null; // 옆모습 턱각 (점을 맞춘 경우) → 얼굴형에도 반영
  // 볼·턱 옆이 양쪽 모두 머리카락에 많이 가려짐 → 턱 쪽 측정값은 판단에서 제외 (한쪽만 가려지면 measure가 안 가려진 쪽으로 잼)
  const hs = state.contour?.hiddenSide;
  m.jawHidden = !!hs && hs.L > 0.3 && hs.R > 0.3;
  state.m = m;
  const edited = Object.keys(state.overrides).length + (state.hairline ? 1 : 0);
  const q = quality(m, { smile: state.smile, edited, hidden: state.contour?.hiddenRatio ?? 0 });
  state.q = q;
  const autoS = autoShapeAnswers(m);
  for (const it of SHAPE_ITEMS) {
    const cur = state.shapeAnswers[it.id];
    const a = autoS[it.id];
    if (!cur || cur.src !== 'manual') state.shapeAnswers[it.id] = { v: a.v, src: 'auto', val: a.val };
    else cur.val = a.val;
  }
  for (const it of TYPE_ITEMS) {
    if (!it.auto) continue;
    const cur = state.answers[it.id];
    const a = it.auto(m);
    if (!cur || cur.src !== 'manual') state.answers[it.id] = { v: a.v, src: it.hint ? 'hint' : 'auto', val: a.val };
    else cur.val = a.val;
  }
  applyProfile();
  draw();
  renderQ(q);
  renderShape();
  renderType();
  // 분석이 끝나면 레포트 만들기 없이도 바로 PDF·이미지 저장·인쇄 가능 (누르면 레포트를 새로 만들어 저장)
  if ($('rpMake').disabled) {
    $('rpMake').disabled = $('rpPdf').disabled = $('rpImg').disabled = $('rpPrint').disabled = false;
    $('rpStatus').textContent = '바로 "PDF로 저장"·"이미지로 저장"을 누르거나, "레포트 만들기"로 먼저 미리 볼 수 있어요.';
  }
}

// ───────── 그리기 ─────────
function draw() {
  const { img, lm, m } = state;
  if (!img) return;
  ctx.drawImage(img, 0, 0);
  if (!lm || !m || !state.showLines) return;
  const W = img.naturalWidth, H = img.naturalHeight;
  const p = (i) => ({ x: lm[i].x * W, y: lm[i].y * H });
  const s = Math.max(1.5, m.faceWidthPx / 160);
  const ux = Math.cos(m.roll), uy = Math.sin(m.roll);

  ctx.lineWidth = s; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.setLineDash([]);
  ctx.beginPath();
  if (state.contour) {
    // 실제 피부 윤곽선: 위쪽(이마 위)은 메시, 이마~턱끝은 피부 윤곽
    const side = (ids, key) => {
      const rows = [...state.contour.rows[key].entries()].sort((a, b) => a[0] - b[0]);
      const firstY = rows.length ? rows[0][0] : Infinity;
      const top = ids.map(p).filter((q) => q.y < firstY); // 실제 윤곽이 없는 맨 위쪽만 평균 얼굴선
      return [...top, ...rows.map(([y, x]) => ({ x, y })), p(152)];
    };
    const L = side(OVAL_L, 'L'), R = side(OVAL_R, 'R').reverse();
    [...L, ...R].forEach((q, k) => { k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
  } else {
    FACE_OVAL.forEach((i, k) => { const q = p(i); k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
  }
  ctx.closePath(); ctx.stroke();

  const seg = (a, b, color, label) => {
    const A = handlePos(a), B = handlePos(b);
    ctx.strokeStyle = color; ctx.lineWidth = s * 1.6;
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
    tag(label, B.x + s * 6, B.y, color, s);
  };
  seg(54, 284, '#e0a526', '이마 폭');
  seg(234, 454, '#5b3f8c', '광대 폭');
  seg(172, 397, '#2f8f7d', '턱 모서리 폭');

  // 턱 길이: 아랫입술 아래 끝 → 턱 끝 (얼굴무드 2번 문항). 두 점 모두 끌어서 옮길 수 있음
  const lip = handlePos(17), chinPt = handlePos(152);
  ctx.strokeStyle = '#c2185b'; ctx.lineWidth = s * 1.4;
  ctx.beginPath(); ctx.moveTo(lip.x, lip.y); ctx.lineTo(chinPt.x, chinPt.y); ctx.stroke();
  tag('턱 길이', Math.max(lip.x, chinPt.x) + s * 8, (lip.y + chinPt.y) / 2, '#c2185b', s);

  // 상·중·하안부 경계선 (얼굴 기울기에 맞춰). 어두운 머리 위에서도 보이게 흰 테두리를 먼저 그림
  const half = m.faceWidthPx * 0.62;
  const lines = [['hair', '헤어라인' + (m.hairlineEstimated ? '(추정)' : m.hairlineAuto ? '(자동)' : '')], [9, '미간'], [2, '코 밑'], [152, '턱 끝']];
  for (const [key, label] of lines) {
    const pt = handlePos(key);
    const a = { x: pt.x - ux * half, y: pt.y - uy * half }, b = { x: pt.x + ux * half, y: pt.y + uy * half };
    ctx.setLineDash([]); ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = s * 2.6;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.setLineDash([s * 4, s * 3]); ctx.strokeStyle = 'rgba(23,19,29,.8)'; ctx.lineWidth = s;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    tag(label, a.x - s * 2, a.y - s * 3, '#17131d', s, 'right');
  }
  ctx.setLineDash([]);

  // 끌 수 있는 점: 옮긴 점은 색이 채워짐
  const hr = handleRadius();
  for (const h of HANDLES) {
    const q = handlePos(h.key);
    const moved = h.key === 'hair' ? !!state.hairline : !!state.overrides[h.key];
    ctx.beginPath(); ctx.arc(q.x, q.y, hr, 0, Math.PI * 2);
    ctx.fillStyle = moved ? h.color : 'rgba(255,255,255,.95)'; ctx.fill();
    ctx.lineWidth = s * 1.2; ctx.strokeStyle = h.color; ctx.stroke();
  }
}

let showLabels = true;
$('btnLabels').addEventListener('click', () => {
  showLabels = !showLabels;
  $('btnLabels').textContent = showLabels ? '글자 숨기기' : '글자 보기';
  draw();
});
function tag(text, x, y, color, s, align = 'left') {
  if (!showLabels) return;
  ctx.font = `700 ${Math.round(s * 7)}px "Malgun Gothic", sans-serif`;
  ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.lineWidth = s * 2.5; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeText(text, x, y);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}

// ───────── 결과 표시 ─────────
const LEVEL = { high: ['high', 'Q: high'], mid: ['mid', 'Q: mid'], low: ['low', 'Q: low'] };
const CONF = { 높음: 'high', 보통: 'mid', 낮음: 'low' };

function renderQ(q) {
  const [cls, label] = LEVEL[q.level];
  const rule = { high: '정상 평가', mid: '결론은 내되 신뢰도를 낮춰 표시', low: '확정 결론 없이 후보 2개만 표시' }[q.level];
  $('qBody').innerHTML = `<div class="q"><span class="badge ${cls}">${label}</span><div><b>${rule}</b>
    <ul class="tight">${q.reasons.map((r) => `<li>${r}</li>`).join('')}</ul></div></div>`;
}

// 상담사 최종 판정 선택 (자동 판정 대신 직접 지정)
function finalSelect(kind, names, current, autoName) {
  return `<label class="override">상담사 최종 판정
    <select data-final="${kind}">
      <option value="">자동 판정 사용${autoName ? ` (${autoName})` : ''}</option>
      ${names.map((n) => `<option value="${n}" ${n === current ? 'selected' : ''}>${n}</option>`).join('')}
    </select></label>`;
}
function srcBadge(src) {
  if (src === 'manual') return '<span class="src manual">직접 선택</span>';
  if (src === 'hint') return '<span class="src hint">자동 · 참고용</span>';
  if (src === 'auto') return '<span class="src auto">자동 측정</span>';
  return '<span class="src need">직접 확인 필요</span>';
}

function renderShape() {
  const m = state.m;
  const r = classifyShape(m, state.q, state.shapeAnswers);
  state.shapeResult = r;
  const t = m.thirds;
  const longest = Object.entries(t).sort((a, b) => b[1] - a[1])[0];
  const thirdName = { upper: '상안부', middle: '중안부', lower: '하안부' };
  const thirdNote = longest[1] > 0.36 ? `${thirdName[longest[0]]}가 길게 인식됨` : '세 구간이 비교적 균형';
  const top = r.scores[0].score;
  const auto = r.first;
  const name = state.finalShape || auto;
  const manualCount = SHAPE_ITEMS.filter((it) => state.shapeAnswers[it.id]?.src === 'manual').length;
  const itemHtml = (it) => {
    const ans = state.shapeAnswers[it.id];
    return `<div class="item">
      <div class="top-line"><span>${it.q}</span>${srcBadge(ans?.src)}</div>
      <div class="val">${ans?.val || ''}</div>
      <div class="choiceN" style="grid-template-columns:repeat(${it.options.length},1fr)">
        ${it.options.map(([v, label]) => `<button data-sid="${it.id}" data-v="${v}" class="${ans?.v === v ? 'sel' : ''}">${label}</button>`).join('')}
      </div></div>`;
  };
  $('shapeBody').classList.remove('empty');
  $('shapeBody').innerHTML = `
    <div class="hero ${state.finalShape ? 'fixed' : ''}">
      <div class="label">${state.finalShape ? '최종 판정 · 상담사 지정' : '1순위 (자동 판정)'}</div>
      <div class="name">${name ? `${name}<small>${SHAPES[name].en}</small>` : '확정 보류'}</div>
      <dl class="kv">
        ${state.finalShape ? `<dt>자동 판정</dt><dd>${auto || '확정 보류'}</dd>` : ''}
        ${auto ? '' : `<dt>1순위</dt><dd>${r.rank1} <span class="muted">(점수 ${r.score1})</span></dd>`}
        <dt>2순위</dt><dd>${r.rank2} <span class="muted">(점수 ${r.score2} · 1순위 ${r.score1})</span></dd>
        <dt>신뢰도</dt><dd><span class="badge ${CONF[r.confidence]}">${r.confidence}</span></dd>
        <dt>경계 여부</dt><dd>${r.boundary ? `경계 (${r.candidates.join(' ↔ ')})` : '아님'}</dd>
      </dl>
      ${finalSelect('shape', Object.keys(SHAPES), state.finalShape, auto || '확정 보류')}
    </div>
    <h3>구조 근거 (자동 판정 기준)</h3>
    <ol class="reasons">${r.reasons.map((x) => `<li>${x.label}<span>${x.val}</span></li>`).join('')}</ol>

    <h3 class="with-btn">체크 항목 — 눌러서 바꿀 수 있어요
      ${manualCount ? `<button class="mini" data-reset="shape">자동값으로 되돌리기 (${manualCount})</button>` : ''}</h3>
    <div class="items">${SHAPE_ITEMS.map(itemHtml).join('')}</div>

    <h3>외곽 구조 측정값</h3>
    <table class="meas">
      <tr><td>세로 ÷ 가로 (사진 보통 ${CONFIG_R})${m.hairlineEstimated ? ' · 헤어라인 추정' : ''}</td><td>${m.R.toFixed(2)}</td></tr>
      <tr><td>이마 폭 ÷ 광대 폭</td><td>${m.f.toFixed(2)}</td></tr>
      <tr><td>턱 모서리 폭 ÷ 광대 폭</td><td>${m.j.toFixed(2)}</td></tr>
      <tr><td>턱 모서리 각도 · 정면 (작을수록 각짐, 평균 139°)</td><td>${Math.round(m.Aj)}°</td></tr>
      <tr><td>턱끝 쪽 폭 ÷ 턱 모서리 폭 (작을수록 V)</td><td>${m.chinRatio.toFixed(2)}</td></tr>
      <tr><td>광대~턱 윤곽 곡선도 (작을수록 직선·모서리, 평균 2.7)</td><td>${m.jawRms != null ? (m.jawRms * 100).toFixed(1) : '-'}</td></tr>
      <tr><td>협부 패임 (광대 폭 대비)</td><td>${(m.In * 100).toFixed(1)}%</td></tr>
      ${state.pm?.jawAngle != null ? `<tr><td>턱각 · 옆모습 (120° 미만 각진 편, 참고)</td><td>${Math.round(state.pm.jawAngle)}°</td></tr>` : ''}
    </table>

    <h3>상·중·하안부 비율 — ${thirdNote}</h3>
    <div class="bars">${Object.entries(t).map(([k, v]) => `
      <div class="row"><span>${thirdName[k]}</span><div class="bar ${k === longest[0] ? '' : 'dim'}"><div style="width:${Math.round(v * 250)}%"></div></div><b>${Math.round(v * 100)}%</b></div>`).join('')}
    </div>

    ${name ? `<h3>보완 포인트 (FACE CODE 16)</h3><div class="tip">${SHAPES[name].tip}</div>` : ''}

    <h3>9종 점수</h3>
    <div class="bars">${r.scores.map((s) => `
      <div class="row"><span>${s.name}</span><div class="bar ${s.score === top ? '' : 'dim'}"><div style="width:${Math.round(s.score * 100)}%"></div></div><b>${Math.round(s.score * 100)}</b></div>`).join('')}
    </div>`;

  const body = $('shapeBody');
  body.querySelectorAll('button[data-sid]').forEach((b) => b.addEventListener('click', () => {
    const prev = state.shapeAnswers[b.dataset.sid];
    state.shapeAnswers[b.dataset.sid] = { v: b.dataset.v, src: 'manual', val: prev?.val };
    renderShape();
  }));
  body.querySelector('[data-reset="shape"]')?.addEventListener('click', () => {
    for (const k of Object.keys(state.shapeAnswers)) if (state.shapeAnswers[k].src === 'manual') delete state.shapeAnswers[k];
    analyze();
  });
  body.querySelector('select[data-final="shape"]').addEventListener('change', (e) => { state.finalShape = e.target.value; renderShape(); });
}

const MATRIX = [
  ['동안', { 직선: '쿨캐주얼', 믹스: '프레시', 곡선: '큐트 · 액티브큐트' }],
  ['성숙', { 직선: '쿨', 믹스: '소프트엘리건트 · 엘리건트', 곡선: '페미닌' }],
];

function renderType() {
  const r = classifyType(state.answers);
  state.typeResult = r;
  const final = state.finalType || r.first;
  const info = TYPES[final];
  const manualCount = TYPE_ITEMS.filter((it) => state.answers[it.id]?.src === 'manual').length;
  const cell = (txt) => {
    const names = txt.split(' · ');
    if (names.includes(final)) return `<div class="on">${txt}</div>`;
    if (r.second && names.includes(r.second)) return `<div class="cand">${txt}</div>`;
    return `<div>${txt}</div>`;
  };
  const itemHtml = (it) => {
    const ans = state.answers[it.id];
    const [k1, k2] = it.group === 'age' ? ['a', 'b'] : ['c', 'd'];
    const src = srcBadge(ans?.src);
    const val = ans?.val || it.manual || '';
    return `<div class="item">
      <div class="top-line"><span>${it.q}</span>${src}</div>
      <div class="val">${val}</div>
      <div class="choice2">
        <button data-id="${it.id}" data-v="${k1}" class="${ans?.v === k1 ? 'sel' : ''}"><span class="k">${k1.toUpperCase()}</span>${it[k1]}</button>
        <button data-id="${it.id}" data-v="${k2}" class="${ans?.v === k2 ? 'sel' : ''}"><span class="k">${k2.toUpperCase()}</span>${it[k2]}</button>
      </div></div>`;
  };

  $('typeBody').classList.remove('empty');
  $('typeBody').innerHTML = `
    <div class="hero ${state.finalType ? 'fixed' : ''}">
      <div class="label">${state.finalType ? '최종 판정 · 상담사 지정' : '1순위 (자동 판정)'}${r.missing ? ` · 미응답 ${r.missing}문항` : ''}</div>
      <div class="name">${final}<small>${info.axis}</small></div>
      <dl class="kv">
        ${state.finalType ? `<dt>자동 판정</dt><dd>${r.first}</dd>` : ''}
        <dt>2순위</dt><dd>${r.second || '없음'}</dd>
        <dt>신뢰도</dt><dd><span class="badge ${CONF[r.confidence]}">${r.confidence}</span></dd>
        <dt>경계 여부</dt><dd>${r.boundary ? '경계' : '아님'}</dd>
        <dt>a · b · c · d</dt><dd>동안 ${r.cnt.a} · 성숙 ${r.cnt.b} · 곡선 ${r.cnt.c} · 직선 ${r.cnt.d}</dd>
        <dt>margin</dt><dd>age ${r.ageMargin} · line ${r.lineMargin}</dd>
      </dl>
      ${finalSelect('type', Object.keys(TYPES), state.finalType, r.first)}
    </div>
    <div class="matrix">
      <div class="h"></div><div class="h">직선</div><div class="h">믹스</div><div class="h">곡선</div>
      ${MATRIX.map(([age, row]) => `<div class="h">${age}</div>${cell(row.직선)}${cell(row.믹스)}${cell(row.곡선)}`).join('')}
    </div>
    <h3>판정 근거 (자동 판정 기준)</h3>
    <ol class="reasons">${r.reasons.map((x) => `<li>${x}</li>`).join('')}</ol>
    <h3>${final} 무드 스타일</h3>
    <div class="tip"><b>인상</b> ${info.mood}<br><b>포인트</b> ${info.point}<br><b>어울리는 테이스트</b> ${info.taste}</div>

    <h3 class="with-btn">체크 항목 — 눌러서 바꿀 수 있어요
      ${manualCount ? `<button class="mini" data-reset="type">자동값으로 되돌리기 (${manualCount})</button>` : ''}</h3>
    <div class="group-title">동안(A) ↔ 성숙(B)</div>
    <div class="items">${TYPE_ITEMS.filter((i) => i.group === 'age').map(itemHtml).join('')}</div>
    <div class="group-title">곡선(C) ↔ 직선(D)</div>
    <div class="items">${TYPE_ITEMS.filter((i) => i.group === 'line').map(itemHtml).join('')}</div>`;

  $('typeBody').querySelectorAll('.choice2 button').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.id;
    const prev = state.answers[id];
    state.answers[id] = { v: b.dataset.v, src: 'manual', val: prev?.val };
    renderType();
  }));
  $('typeBody').querySelector('[data-reset="type"]')?.addEventListener('click', () => {
    for (const k of Object.keys(state.answers)) if (state.answers[k].src === 'manual') delete state.answers[k];
    analyze();
  });
  $('typeBody').querySelector('select[data-final="type"]').addEventListener('change', (e) => { state.finalType = e.target.value; renderType(); });
}

// ───────── 레포트 ─────────
$('reportCss').textContent = REPORT_CSS;
// 로고는 저장한 레포트 파일 안에도 들어가도록 데이터로 읽어 둠
let logoData = null;
fetch('./colorm-logo.png').then((r) => r.blob()).then((b) => new Promise((ok) => {
  const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(b);
})).then((u) => { logoData = u; }).catch(() => {});
// 레포트 하단 QR (네이버 리뷰 · 퍼스널컬러 자가진단 · 인스타그램). 저장 파일에도 들어가도록 데이터로 읽어 둠
const qrData = {};
for (const k of ['place', 'selfcheck', 'instagram']) {
  fetch(`./qr-${k}.png`).then((r) => (r.ok ? r.blob() : Promise.reject())).then((b) => new Promise((ok) => {
    const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(b);
  })).then((u) => { qrData[k] = u; }).catch(() => {});
}
{
  const d = new Date();
  $('rpDate').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// 캔버스(측정선 포함)를 레포트용 이미지로. box(이미지 좌표)가 있으면 그 부분만 잘라냄
function snapshot(cv, box, maxW = 1000) {
  const b = box || { x: 0, y: 0, w: cv.width, h: cv.height };
  const k = Math.min(1, maxW / b.w);
  const t = document.createElement('canvas');
  t.width = Math.round(b.w * k); t.height = Math.round(b.h * k);
  t.getContext('2d').drawImage(cv, b.x, b.y, b.w, b.h, 0, 0, t.width, t.height);
  return t.toDataURL('image/jpeg', 0.9);
}
// 사진 안으로 잘라낼 영역 맞추기 (세로:가로 = 5:4 정도로)
function fitBox(cx, top, bottom, minW, cv) {
  let h = bottom - top, w = Math.max(minW, h * 0.8);
  let x = cx - w / 2, y = top;
  w = Math.min(w, cv.width); h = Math.min(h, cv.height);
  x = Math.max(0, Math.min(cv.width - w, x)); y = Math.max(0, Math.min(cv.height - h, y));
  return { x, y, w, h };
}
// 화면에서 확대해 둔 상태면 그 보이는 부분, 아니면 얼굴 중심으로 자름
function zoomedView(cv) {
  try { return cv.dataset.view ? JSON.parse(cv.dataset.view) : null; } catch { return null; }
}
function frontBox() {
  const v = zoomedView(canvas);
  if (v) return v;
  const hl = state.m.hairlineImg, chin = handlePos(152), L = handlePos(234), R = handlePos(454);
  const fh = chin.y - hl.y, wc = Math.abs(R.x - L.x);
  return fitBox((L.x + R.x) / 2, hl.y - 0.35 * fh, chin.y + 0.2 * fh, wc * 1.7, canvas);
}
function profileBox() {
  const pc = $('pCanvas');
  const v = zoomedView(pc);
  if (v) return v;
  const pts = profileApi.points();
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const ph = y1 - y0;
  return fitBox((x0 + x1) / 2, y0 - 0.25 * ph, y1 + 0.2 * ph, (x1 - x0) * 1.4, pc);
}
function reportData() {
  const m = state.m, s = state.shapeResult, t = state.typeResult;
  const shapeName = state.finalShape || s.first;
  const typeName = state.finalType || t.first;
  const th = m.thirds, info = TYPES[typeName];
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  const qLabel = { high: '좋음', mid: '보통', low: '낮음' }[state.q.level];
  return {
    logo: logoData,
    qr: Object.keys(qrData).length ? qrData : null,
    customer: $('rpName').value.trim(),
    date: $('rpDate').value,
    consultant: $('rpConsultant').value.trim(),
    memo: $('rpMemo').value.trim(),
    frontImg: snapshot(canvas, frontBox()),
    profileImg: !$('pCanvas').hidden && state.pm ? snapshot($('pCanvas'), profileBox()) : null,
    quality: qLabel, // 고객용 레포트에는 등급만 (상세 사유·조작 안내는 상담사 화면에만)
    shape: {
      name: shapeName, en: shapeName ? SHAPES[shapeName].en : '', fixed: !!state.finalShape,
      candidate: state.finalShape ? (s.first && s.first !== state.finalShape ? `자동 판정 ${s.first}` : '') : s.candidate,
      rank1: s.rank1, rank2: s.rank2, score1: s.score1, score2: s.score2,
      confidence: state.finalShape ? '상담사 확인' : s.confidence,
      reasons: s.reasons.map((x) => `${x.label} (${x.val})`),
      thirds: [['상안부', th.upper], ['중안부', th.middle], ['하안부', th.lower]],
      measures: [
        [`세로 ÷ 가로 (사진 보통 ${CONFIG_R})`, m.R.toFixed(2)],
        ['이마 폭 ÷ 광대 폭', m.f.toFixed(2)],
        ['턱 모서리 폭 ÷ 광대 폭', m.j.toFixed(2)],
        ['턱 모서리 각도 (정면)', `${Math.round(m.Aj)}°`],
        ['광대~턱 윤곽 곡선도', m.jawRms != null ? (m.jawRms * 100).toFixed(1) : '-'],
        ['협부 패임', pct(m.In)],
        ...(m.profJawAngle != null ? [['턱각 (옆모습)', `${Math.round(m.profJawAngle)}°`]] : []),
      ],
      tip: shapeName ? SHAPES[shapeName].tip : '',
    },
    type: {
      name: typeName, axis: info.axis, mood: info.mood, point: info.point, taste: info.taste,
      fixed: !!state.finalType, cnt: t.cnt,
      candidate: state.finalType ? (t.first !== state.finalType ? `자동 판정 ${t.first}` : '') : t.candidate,
      rank1: t.first, rank2: t.second,
      confidence: state.finalType ? '상담사 확인' : t.confidence,
    },
    profile: state.pm ? describeProfile(state.pm) : null,
  };
}
function makeReport() {
  if (!state.m || !state.shapeResult) return null;
  const d = reportData();
  $('rpPreview').innerHTML = reportHTML(d);
  $('rpPrint').disabled = $('rpPdf').disabled = $('rpImg').disabled = false;
  $('rpStatus').textContent = '아래 미리보기를 확인하고 인쇄하거나 저장하세요. 결과나 메모를 바꿨다면 "레포트 만들기"를 다시 누르세요.';
  return d;
}
$('rpMake').addEventListener('click', () => { makeReport(); $('rpPreview').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
$('rpPrint').addEventListener('click', () => { if (makeReport()) window.print(); });

// ── 이미지(PNG) · PDF 바로 저장: 레포트 화면을 그림으로 만든 뒤 파일로 내려받음 ──
const LIBS = {
  html2canvas: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
};
const loaded = {};
function loadLib(name) {
  return (loaded[name] ||= new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = LIBS[name]; s.onload = ok; s.onerror = () => { delete loaded[name]; fail(new Error(name)); };
    document.head.appendChild(s);
  }));
}
const fileBase = (d) => `진단레포트_${(d.customer || '고객').replace(/[\\/:*?"<>|\s]/g, '')}_${d.date}`;
function download(blobOrUrl, name) {
  const a = document.createElement('a');
  a.href = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  if (typeof blobOrUrl !== 'string') setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
async function reportCanvas() {
  const d = makeReport();
  if (!d) return null;
  await loadLib('html2canvas');
  const el = $('rpPreview').querySelector('.rpt');
  const keep = el.getAttribute('style') || '';
  el.style.boxShadow = 'none'; el.style.margin = '0'; // 종이 그림자·바깥 여백은 빼고 종이만
  try {
    const cv = await window.html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
    return { cv, d };
  } finally { el.setAttribute('style', keep); }
}
async function saveAs(kind) {
  const btns = [$('rpImg'), $('rpPdf')];
  btns.forEach((b) => { b.disabled = true; });
  $('rpStatus').textContent = kind === 'pdf' ? 'PDF를 만드는 중…' : '이미지를 만드는 중…';
  try {
    const r = await reportCanvas();
    if (!r) return;
    if (kind === 'png') {
      const blob = await new Promise((ok) => r.cv.toBlob(ok, 'image/png'));
      download(blob, `${fileBase(r.d)}.png`);
      $('rpStatus').textContent = '이미지(PNG)로 저장했어요. 다운로드 폴더를 확인하세요.';
    } else {
      await loadLib('jspdf');
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      // A4(210×297mm)에 맞춰 넣기 (넘치면 비율대로 줄임)
      let w = 210, h = (r.cv.height / r.cv.width) * 210;
      if (h > 297) { w = (297 / h) * 210; h = 297; }
      pdf.addImage(r.cv.toDataURL('image/jpeg', 0.92), 'JPEG', (210 - w) / 2, 0, w, h);
      pdf.save(`${fileBase(r.d)}.pdf`);
      $('rpStatus').textContent = 'PDF로 저장했어요. 다운로드 폴더를 확인하세요.';
    }
  } catch (e) {
    console.error(e);
    $('rpStatus').textContent = '저장 도구를 불러오지 못했어요. 인터넷 연결을 확인하거나 "인쇄"에서 PDF로 저장해 주세요.';
  } finally {
    btns.forEach((b) => { b.disabled = false; });
  }
}
$('rpImg').addEventListener('click', () => saveAs('png'));
$('rpPdf').addEventListener('click', () => saveAs('pdf'));

setupZoom(document.querySelector('.photo-box'), canvas, $('btnZoom'));
setupZoom($('profileBox'), $('pCanvas'), $('pBtnZoom'));
const profileApi = initProfile({
  getLandmarker: () => landmarker,
  // 정면 사진 분석 전이면 옆모습 값만 저장해 두고, 정면 분석 때 함께 반영
  onChange: (pm) => { state.pm = pm; if (state.m) scheduleAnalyze(); },
});
init();
