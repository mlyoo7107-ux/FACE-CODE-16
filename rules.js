// 얼굴형·얼굴무드(구 얼굴타입) 진단 규칙
// - 얼굴형: FACE CODE 16 의 9종 (외곽 윤곽만 사용)
// - 얼굴무드(구 얼굴타입): 매트릭스 8가지 + 얼굴진단차트 판정 규칙
// 두 판정은 서로의 결과를 쓰지 않는다.
//
// ⚠ CONFIG 의 기준값은 보정 전 가정값이다.
//   실제 진단해 둔 고객 사진으로 맞춰 보면서 조정해야 한다.

export const CONFIG = {
  // 얼굴형 기준: [보통 값, 이만큼 벗어나면 '뚜렷함'(1단위)].
  // (책의 '가로×1.4 = 세로' 기준은 줄자 측정용. 사진 측정에서는 같은 균형점이 약 1.32로 나옴)
  // FACE CODE 16 책의 얼굴형 예시 9장(피부 윤곽 + 자동 헤어라인으로 측정)의 평균과 차이로 맞춘 값.
  // 9장 중 8장이 해당 얼굴형으로 판정됨(육각형 예시는 계란형으로 나옴).
  // 세로 비율은 헤어라인 위치에 민감해서 일부러 폭을 넓혀 둠(헤어라인 10px 이동의 영향을 25% 줄임).
  shapeBase: {
    R: [1.32, 0.06],     // 세로(헤어라인~턱끝) ÷ 가로(광대폭)
    f: [0.892, 0.03],    // 이마폭 ÷ 광대폭
    j: [0.752, 0.03],    // 턱 모서리 폭 ÷ 광대폭 (턱 모서리 = 윤곽선이 실제로 꺾이는 곳)
    chin: [0.529, 0.025],// 턱끝 쪽 폭 ÷ 턱 모서리 폭
    Aj: [138.7, 4.5],    // 정면 턱각(도): 턱 모서리에서 광대와 턱끝을 잇는 각. 작을수록 각짐
    In: [-0.0196, 0.006],// 협부 패임 (광대폭 대비, + 이면 패임)
    rms: [0.0393, 0.0025],// 광대~턱끝 윤곽이 두 직선에서 벗어난 정도. 작을수록 직선 + 뚜렷한 모서리
    profJaw: [125, 5],   // 옆모습 턱각(도). 작을수록 옆턱 발달 (일반 범위로 정한 가정값, 사진 보정 전)
  },
  A0: 138.7,             // 얼굴무드 '골격감' 참고용 정면 턱각 (이보다 6° 이상 작으면 골격이 느껴짐)
  hairlineEstimate: 0.95, // 헤어라인 미지정 시: 상안부 ≈ 중안부 × 0.95 로 추정
  type: {
    chinLen: 0.43,  // (아랫입술~턱끝) ÷ (코밑~턱끝) 보다 작으면 턱이 짧다
    eyeGap: 1.40,   // 눈 사이 ÷ 눈 폭 이상이면 넓다 (랜드마크 눈꼬리점이 안쪽이라 실측보다 큼)
    eyeSize: 0.205, // 눈 폭 ÷ 광대폭 이상이면 크다
    noseW: 1.25,    // 콧방울 폭 ÷ 눈 폭 미만이면 작다
    mouth: 0.35,    // 입 폭 ÷ 광대폭 이상이면 크다
    eyeOpen: 0.36,  // 눈 세로 ÷ 눈 가로 이상이면 둥글다
    eyeTilt: 6,     // 눈꼬리 각도(도) 이상이면 올라감
    lips: 0.50,     // 입술 두께(윗+아랫) ÷ 입 폭 이상이면 두껍다
    browArch: 0.15, // 눈썹 아치 높이 ÷ 눈썹 길이 미만이면 직선적
  },
  profile: {        // 옆모습 (모두 가정값)
    noseProj: 0.28,   // 코끝 돌출 ÷ 코 길이(코뿌리~코밑) 이상이면 콧대가 높다
    depth: 0.20,      // 코끝 돌출 ÷ 얼굴 길이(코뿌리~턱끝), 이마~턱끝 선 기준. 이상이면 입체적
    dorsumStraight: 0.03, // 콧등이 코뿌리~코끝 직선에서 벗어난 정도. 이하면 곧은 콧날
    foreheadRound: 0.05,  // 이마 볼록 ÷ 이마 길이 이상이면 둥근 이마
    jawAngle: [120, 130], // 옆모습 턱각(도): 120 미만 각진 편, 130 초과 완만한 편 (일반적인 성인 범위 기준, 사진 보정 전)
  },
};

const clamp = (v) => Math.max(0, Math.min(1, v));
const ramp = (v, lo, hi) => clamp((v - lo) / (hi - lo));
const rampDown = (v, hi, lo) => clamp((hi - v) / (hi - lo));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const r2 = (v) => Math.round(v * 100) / 100;

// ───────────────────────── 측정 ─────────────────────────
// lm: MediaPipe 정규화 랜드마크(478), w/h: 이미지 크기, hairline: 이미지 좌표 {x,y} 또는 null
// overrides: 상담사가 끌어서 옮긴 점 { 랜드마크번호: {x,y} } (이미지 좌표)
// contour: facecontour.js 결과(실제 피부 윤곽선). 있으면 협부 패임·턱각을 실제 윤곽으로 계산
export function measure(lm, w, h, hairline, overrides = {}, contour = null) {
  const raw = (i) => overrides[i] || { x: lm[i].x * w, y: lm[i].y * h };
  const eyeL = raw(33), eyeR = raw(263);
  const roll = Math.atan2(eyeR.y - eyeL.y, eyeR.x - eyeL.x);
  const c = { x: (eyeL.x + eyeR.x) / 2, y: (eyeL.y + eyeR.y) / 2 };
  const cos = Math.cos(-roll), sin = Math.sin(-roll);
  const rot = (q) => ({
    x: c.x + (q.x - c.x) * cos - (q.y - c.y) * sin,
    y: c.y + (q.x - c.x) * sin + (q.y - c.y) * cos,
  });
  const P = (i) => rot(raw(i));
  // 윤곽 모양(협부 패임·턱각)은 옮긴 점이 아닌 원래 윤곽선으로 계산
  const P0 = (i) => rot({ x: lm[i].x * w, y: lm[i].y * h });
  // 윤곽점: 실제 피부 윤곽선이 있으면 그 위의 점, 없으면 메시 점
  const CP = (i, side) => {
    if (contour) {
      const y = lm[i].y * h, x = contour.at(side, y, true);
      if (x != null) return rot({ x, y });
    }
    return P0(i);
  };
  const wd = (a, b) => Math.abs(P(a).x - P(b).x);

  const top = P(10), glabella = P(9), chin = P(152), subnasale = P(2);
  let hl, hairlineEstimated = false;
  if (hairline) hl = rot(hairline);
  else {
    hl = { x: top.x, y: glabella.y - (subnasale.y - glabella.y) * CONFIG.hairlineEstimate };
    hairlineEstimated = true;
  }

  const Wf = wd(54, 284), Wc = wd(234, 454), Wj = wd(172, 397), Wchin = wd(149, 378);
  const H = chin.y - hl.y;

  // 협부 패임: 광대점→턱각점 직선보다 안쪽으로 들어간 정도
  const inward = (a, b, pts, leftSide) => {
    const side = leftSide ? 'L' : 'R';
    const A = CP(a, side), B = CP(b, side);
    let m = -Infinity;
    for (const i of pts) {
      const q = CP(i, side);
      const xl = A.x + ((B.x - A.x) * (q.y - A.y)) / (B.y - A.y);
      m = Math.max(m, leftSide ? q.x - xl : xl - q.x);
    }
    return m;
  };
  const In = (inward(234, 172, [93, 132, 58], true) + inward(454, 397, [323, 361, 288], false)) / 2 / Wc;

  // 정면 턱각: 턱 모서리 점에서 광대 점과 턱끝을 바라본 각도 (작을수록 모서리가 뚜렷하게 꺾임)
  //  턱 모서리 점(172/397)은 윤곽선에서 자동으로 찾은 위치이고, 상담사가 끌어서 고칠 수 있음
  const angP = (o, a, b) => {
    const O = P(o), A = P(a), B = P(b);
    const v1 = { x: A.x - O.x, y: A.y - O.y }, v2 = { x: B.x - O.x, y: B.y - O.y };
    const cs = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y));
    return (Math.acos(Math.max(-1, Math.min(1, cs))) * 180) / Math.PI;
  };
  const Aj = (angP(172, 234, 152) + angP(397, 454, 152)) / 2;
  // 턱 아래 V: 턱 모서리와 턱끝 중간 높이의 얼굴 폭 ÷ 턱 모서리 폭 (작을수록 V로 급하게 좁아짐)
  let vTaper;
  if (contour) {
    const cy = lm[152].y * h;
    const yl = (raw(172).y + cy) / 2, yr = (raw(397).y + cy) / 2;
    const xl = contour.at('L', yl), xr = contour.at('R', yr);
    vTaper = xl != null && xr != null ? Math.abs(xr - xl) / Math.abs(raw(397).x - raw(172).x) : null;
  }
  if (vTaper == null) vTaper = wd(150, 379) / wd(172, 397);
  // 광대~턱끝 윤곽이 두 직선(모서리 있음)에 얼마나 가까운지. 작을수록 직선적·각진 윤곽
  const js = [contour?.jaw?.L?.rms, contour?.jaw?.R?.rms].filter((v) => v != null);
  const jawRms = js.length ? js.reduce((a, b) => a + b, 0) / js.length : null;

  // 눈
  const eyeW = (dist(P(33), P(133)) + dist(P(263), P(362))) / 2;
  const eyeH = (dist(P(159), P(145)) + dist(P(386), P(374))) / 2;
  const tiltOf = (outer, inner) => {
    const o = P(outer), n = P(inner);
    return (Math.atan2(n.y - o.y, Math.abs(o.x - n.x)) * 180) / Math.PI; // + : 눈꼬리가 높음
  };
  const eyeTilt = (tiltOf(33, 133) + tiltOf(263, 362)) / 2;

  // 눈썹 아치
  const archOf = (ends, mids) => {
    const A = P(ends[0]), B = P(ends[1]);
    const L = dist(A, B);
    let m = 0;
    for (const i of mids) {
      const q = P(i);
      const d = Math.abs((B.x - A.x) * (A.y - q.y) - (A.x - q.x) * (B.y - A.y)) / L;
      m = Math.max(m, d);
    }
    return m / L;
  };
  const browArch = (archOf([70, 107], [63, 105, 66]) + archOf([300, 336], [293, 334, 296])) / 2;

  // 상·중·하안부
  const upper = glabella.y - hl.y, middle = subnasale.y - glabella.y, lower = chin.y - subnasale.y;
  const thirdsSum = upper + middle + lower;

  // 사진 품질
  const nose = P(1);
  const yaw = Math.abs(Math.abs(nose.x - P(234).x) - Math.abs(P(454).x - nose.x)) / Wc;
  const rollDeg = Math.abs((roll * 180) / Math.PI);

  return {
    roll, rollDeg, yaw, faceWidthPx: Wc, hairlineEstimated,
    hairlineImg: hairline || unrot(hl, c, roll),
    R: H / Wc, f: Wf / Wc, j: Wj / Wc, chinRatio: Wchin / Wj, In, Aj, vTaper, jawRms,
    eyeW, eyeH, eyeOpen: eyeH / eyeW, eyeTilt, browArch,
    eyeGap: dist(P(133), P(362)) / eyeW,
    eyeSize: eyeW / Wc,
    noseW: dist(P(64), P(294)) / eyeW,
    mouth: dist(P(61), P(291)) / Wc,
    lips: dist(P(0), P(17)) / dist(P(61), P(291)),
    chinLen: dist(P(17), chin) / dist(subnasale, chin),
    thirds: { upper: upper / thirdsSum, middle: middle / thirdsSum, lower: lower / thirdsSum },
  };
}

function unrot(q, c, roll) {
  const cos = Math.cos(roll), sin = Math.sin(roll);
  return {
    x: c.x + (q.x - c.x) * cos - (q.y - c.y) * sin,
    y: c.y + (q.x - c.x) * sin + (q.y - c.y) * cos,
  };
}

// ───────────────────────── 옆모습 측정 ─────────────────────────
export const PROFILE_POINTS = [
  { key: 'hair', label: '헤어라인' },
  { key: 'forehead', label: '이마' },
  { key: 'nasion', label: '코뿌리' },
  { key: 'dorsum', label: '콧등' },
  { key: 'tip', label: '코끝' },
  { key: 'subnasale', label: '코밑' },
  { key: 'lip', label: '입술' },
  { key: 'chin', label: '턱끝' },
];

// pts: { key: {x,y} } 이미지 좌표
export function measureProfile(pts) {
  const p = pts;
  const dir = Math.sign(p.tip.x - (p.nasion.x + p.chin.x) / 2) || -1; // 얼굴이 향한 쪽(+1 오른쪽, -1 왼쪽)
  // 직선 A→B 에서 점 P 가 얼굴 앞쪽으로 나온 거리 (+ 앞, - 뒤)
  const front = (P, A, B) => {
    const len = Math.hypot(B.x - A.x, B.y - A.y);
    return (((B.y - A.y) * (P.x - A.x) - (B.x - A.x) * (P.y - A.y)) / len) * dir;
  };
  const L = dist(p.nasion, p.chin);
  const noseLen = dist(p.nasion, p.subnasale);
  // 점이 겹쳐 길이가 0에 가까우면 나눗셈이 깨지므로 측정하지 않음
  if ([L, noseLen, dist(p.nasion, p.tip), dist(p.hair, p.nasion)].some((v) => v < 2)) return null;
  return {
    dir,
    noseProj: front(p.tip, p.nasion, p.subnasale) / noseLen,
    depth: front(p.tip, p.forehead, p.chin) / L,
    dorsumDev: front(p.dorsum, p.nasion, p.tip) / dist(p.nasion, p.tip),
    foreheadRound: front(p.forehead, p.hair, p.nasion) / dist(p.hair, p.nasion),
    eLine: front(p.lip, p.tip, p.chin) / L,
  };
}

export function describeProfile(pm) {
  const P = CONFIG.profile;
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  return [
    { label: '콧대 높이', val: `코끝 돌출 ${pct(pm.noseProj)}`, text: pm.noseProj >= P.noseProj ? '높은 편' : '낮은 편' },
    { label: '얼굴 입체감', val: `이마~턱끝 선에서 코끝 ${pct(pm.depth)}`, text: pm.depth >= P.depth ? '입체적 (가운데가 높음)' : '평면적' },
    { label: '콧날', val: `콧등 휨 ${pct(pm.dorsumDev)}`,
      text: Math.abs(pm.dorsumDev) <= P.dorsumStraight ? '곧게 선 콧날' : pm.dorsumDev > 0 ? '콧등이 볼록 (매부리 쪽)' : '콧등이 오목하고 둥근 편' },
    { label: '이마 곡선', val: `이마 볼록 ${pct(pm.foreheadRound)}`, text: pm.foreheadRound >= P.foreheadRound ? '동그스름함' : '평평한 편' },
    { label: '입술 E라인', val: `코끝~턱끝 선 기준 ${pct(pm.eLine)}`, text: pm.eLine > 0 ? '입술이 선보다 앞 (돌출)' : '입술이 선 안쪽' },
    pm.jawAngle != null
      ? { label: '턱각 (옆모습)', val: `턱 뒷선과 턱 아래 선 사이 ${Math.round(pm.jawAngle)}°`,
          text: pm.jawAngle < P.jawAngle[0] ? '각진 편 (옆턱 발달)' : pm.jawAngle > P.jawAngle[1] ? '완만한 편' : '보통' }
      : { label: '턱각 (옆모습)', val: '네모 점 3개를 귀 아래 턱 뒷선 · 턱 모서리 · 턱 아래 선에 맞추면 계산돼요', text: '—' },
  ];
}

// ───────────────────────── 1) 사진 품질 Q ─────────────────────────
export function quality(m, extra = {}) {
  const reasons = [];
  const smiling = (extra.smile ?? 0) > 0.35;
  if (smiling) reasons.push('웃는 표정 — 볼과 턱선 윤곽이 실제와 다르게 보일 수 있음 (무표정 권장)');
  if (extra.edited) reasons.push(`상담사가 측정점 ${extra.edited}개를 직접 보정함`);
  if (m.yaw > 0.12) reasons.push(`고개가 옆으로 돌아감 (좌우 차이 ${Math.round(m.yaw * 100)}%)`);
  else if (m.yaw > 0.06) reasons.push(`고개가 약간 돌아감 (좌우 차이 ${Math.round(m.yaw * 100)}%)`);
  if (m.rollDeg > 8) reasons.push(`얼굴이 기울어짐 (${m.rollDeg.toFixed(1)}°, 보정함)`);
  if (m.faceWidthPx < 180) reasons.push(`얼굴이 작게 찍힘 (얼굴 폭 ${Math.round(m.faceWidthPx)}px, 300px 이상 권장)`);
  if (m.hairlineEstimated) reasons.push('헤어라인을 찾지 못해 세로 길이와 상안부는 추정값 — 헤어라인 점을 직접 옮겨 주세요');
  else if (m.hairlineAuto) reasons.push('헤어라인은 이마 피부 경계로 자동 인식 — 앞머리가 덮고 있으면 점을 실제 헤어라인으로 옮겨 주세요');

  let level = 'high';
  if (m.yaw > 0.12 || m.faceWidthPx < 100) level = 'low';
  else if (m.yaw > 0.06 || m.rollDeg > 8 || m.faceWidthPx < 180 || m.hairlineEstimated || smiling) level = 'mid';
  if (!reasons.length) reasons.push('정면, 윤곽이 잘 보이고 왜곡이 적음');
  return { level, reasons };
}

// ───────────────────────── 2) 얼굴형 (FACE CODE 16) ─────────────────────────
export const SHAPES = {
  계란형: { en: 'Oval', tip: '가운데 가르마나 얇은 시스루 앞머리, 세미 레이어. 지금의 균형을 흐트러뜨리지 않는 방향.' },
  긴형: { en: 'Long', tip: '시스루·사이드 스윕 앞머리로 이마를 분절, 중간 길이에 S웨이브로 가로 흐름. 아주 긴 생머리는 피하기.' },
  각진형: { en: 'Angular', tip: '사선·곡선 프린지와 6:4 가르마, 턱선을 감싸는 보브·롱보브에 C컬·S컬.' },
  땅콩형: { en: 'Peanut', tip: '광대를 감싸는 사이드뱅, 6:4·7:3 가르마. 광대·턱선 볼륨은 줄이고 턱 아래 V라인에 C컬.' },
  육각형: { en: 'Hexagon', tip: '광대를 감싸는 사이드뱅, 6:4·7:3 가르마(5:5 피하기). 광대·턱선 볼륨 절제, 턱 아래 웨이브.' },
  마름모형: { en: 'Diamond', tip: '커튼뱅·사이드뱅으로 옆광대 아래 커버, 이마·턱에 볼륨을 나누고 광대 옆 볼륨은 낮추기.' },
  둥근형: { en: 'Round', tip: '시스루·사이드 앞머리, 정수리 볼륨으로 세로 길이 확보, 쇄골 기장 레이어드. 무거운 앞머리는 피하기.' },
  역삼각형: { en: 'Inverted Triangle', tip: '사이드 스윕·커튼뱅, 6:4 이상 가르마. 위는 가볍게, 턱선 부근에 볼륨과 C컬.' },
  하트형: { en: 'Heart', tip: '커튼뱅으로 이마와 옆광대를 함께 연결, 턱선 부근에 볼륨. 광대 높이의 볼륨은 피하기.' },
};


// 측정값만으로 만든 기본 특징값 (0~1)
// extra.profJawAngle: 옆모습 턱각(상담사가 점을 맞춘 경우에만 값이 있음)
function baseShapeValues(m, extra = {}) {
  const B = CONFIG.shapeBase;
  const pa = extra.profJawAngle;
  const zp = pa != null ? (pa - B.profJaw[0]) / B.profJaw[1] : null;
  // 보통 값에서 몇 단위 벗어났는지 (z)
  const z = (key, v) => (v - B[key][0]) / B[key][1];
  const zR = z('R', m.R), zf = z('f', m.f), zj = z('j', m.j), zc = z('chin', m.chinRatio), zA = z('Aj', m.Aj), zI = z('In', m.In);
  const zs = m.jawRms != null ? z('rms', m.jawRms) : 0;
  const pos = (v) => ramp(v, 0.4, 1.4), neg = (v) => ramp(-v, 0.4, 1.4);
  return {
    vertical: ramp(zR, -0.3, 0.5),
    long: pos(zR),
    short: neg(zR),
    fWide: pos(zf),
    fMax: ramp(zf, 1.0, 1.8),
    fNarrow: neg(zf),
    jWide: pos(zj),
    jNarrow: neg(zj),
    cheekProm: Math.min(ramp(-zf, 0.3, 1.2), ramp(-zj, 0.3, 1.2)),
    angular: ramp(-zA, 0.3, 1.5),
    hollow: pos(zI),
    round: neg(zI),           // 광대~턱 윤곽이 바깥으로 둥글게 부풂
    chinV: neg(zc),
    straight: neg(zs),        // 광대~턱끝이 직선 + 뚜렷한 모서리 (육각형·각진형의 다각적 윤곽)
    even: 1 - Math.max(pos(zf), neg(zf), pos(zj), neg(zj)),
    // 옆모습 턱각 (없으면 null → 판정 규칙에서 빠짐)
    profJaw: zp == null ? null : neg(zp),   // 턱각이 작음 = 옆턱(골격) 발달
    profRound: zp == null ? null : pos(zp), // 턱각이 큼 = 턱선이 완만
  };
}

// ── 얼굴형 체크 항목 (FACE CODE 16 판별 흐름). 상담사가 고르면 해당 특징값을 덮어씀 ──
export const SHAPE_ITEMS = [
  { id: 'length', q: '① 길이감 (얼굴 세로와 가로 비교)',
    options: [['short', '가로 폭이 넓거나 짧음'], ['vertical', '세로가 더 김'], ['long', '세로가 뚜렷하게 김 (긴형)']],
    auto: (b, m) => ({ v: b.long >= 0.5 ? 'long' : b.vertical >= 0.5 ? 'vertical' : 'short', val: `세로÷가로 ${r2(m.R)}` }),
    apply: { short: { short: 1, vertical: 0, long: 0 }, vertical: { short: 0, vertical: 1, long: 0 }, long: { short: 0, vertical: 1, long: 1 } } },
  { id: 'widest', q: '② 가장 넓어 보이는 부위',
    options: [['forehead', '이마'], ['cheek', '광대'], ['jaw', '턱'], ['none', '특징 없음']],
    auto: (b, m) => {
      const v = b.fMax >= 0.5 ? 'forehead' : b.cheekProm >= 0.5 ? 'cheek' : b.jWide >= 0.5 ? 'jaw' : 'none';
      return { v, val: `이마÷광대 ${r2(m.f)}, 턱÷광대 ${r2(m.j)}` };
    },
    apply: { forehead: { fMax: 1, fWide: 1, cheekProm: 0 }, cheek: { cheekProm: 1, fMax: 0 }, jaw: { jWide: 1, jNarrow: 0, fMax: 0, cheekProm: 0 }, none: { fMax: 0, cheekProm: 0, jWide: 0, even: 1 } } },
  { id: 'cheek', q: '③ 옆광대가 도드라지나요?',
    options: [['yes', '도드라짐'], ['no', '도드라지지 않음']],
    auto: (b) => ({ v: b.cheekProm >= 0.5 ? 'yes' : 'no', val: `광대 돌출 점수 ${Math.round(b.cheekProm * 100)}` }),
    apply: { yes: { cheekProm: 1 }, no: { cheekProm: 0 } } },
  { id: 'jaw', q: '④ 옆턱이 발달했나요? (턱각이 분명)',
    options: [['yes', '발달함 · 각이 분명'], ['no', '완만함']],
    // 옆모습 턱각이 있으면 정면(턱 모서리 각도·폭)과 옆모습 턱각을 함께 봄
    auto: (b, m) => {
      const front = (b.angular + b.jWide) / 2;
      const score = b.profJaw != null ? (front + b.profJaw) / 2 : front;
      const side = m.profJawAngle != null ? `, 옆모습 턱각 ${Math.round(m.profJawAngle)}°` : '';
      return { v: score >= 0.5 ? 'yes' : 'no', val: `정면 턱 모서리 ${Math.round(m.Aj)}°, 턱÷광대 ${r2(m.j)}${side}` };
    },
    apply: { yes: { angular: 1, jWide: 1, jNarrow: 0, profJaw: 1, profRound: 0 }, no: { angular: 0, jWide: 0, profJaw: 0, profRound: 1 } } },
  { id: 'taper', q: '⑤ 턱으로 갈수록 급격히 좁아지나요?',
    options: [['yes', '급격히 좁아짐 (V)'], ['no', '완만하게 좁아짐']],
    auto: (b, m) => ({ v: (b.jNarrow + b.chinV) / 2 >= 0.5 ? 'yes' : 'no', val: `턱끝÷턱 ${r2(m.chinRatio)}` }),
    apply: { yes: { jNarrow: 1, chinV: 1 }, no: { jNarrow: 0, chinV: 0 } } },
  { id: 'hollow', q: '⑥ 광대 아래(협부)가 움푹 들어갔나요?',
    options: [['yes', '들어감 (땅콩형 가능성)'], ['no', '들어가지 않음']],
    auto: (b, m) => ({ v: b.hollow >= 0.5 ? 'yes' : 'no', val: `협부 패임 ${(m.In * 100).toFixed(1)}%` }),
    apply: { yes: { hollow: 1 }, no: { hollow: 0 } } },
];

export function autoShapeAnswers(m) {
  const b = baseShapeValues(m, { profJawAngle: m.profJawAngle });
  return Object.fromEntries(SHAPE_ITEMS.map((it) => [it.id, it.auto(b, m)]));
}

// 상담사가 직접 고른 항목(manual)만 특징값에 반영
function describeShapeFeatures(m, base, answers) {
  const b = { ...base };
  const touched = new Set();
  for (const it of SHAPE_ITEMS) {
    const a = answers[it.id];
    if (a?.src !== 'manual') continue;
    for (const [k, v] of Object.entries(it.apply[a.v] || {})) { b[k] = v; touched.add(k); }
  }
  const { vertical, long, short, fWide, fMax, fNarrow, jWide, jNarrow, cheekProm, angular, hollow, round, chinV, straight, even, profJaw, profRound } = b;
  const PA = m.profJawAngle != null ? Math.round(m.profJawAngle) : null;
  const balanced = 1 - Math.max(cheekProm, fWide, jWide, hollow, long, short, angular, jNarrow, fNarrow, straight);
  const RMS = m.jawRms != null ? (m.jawRms * 100).toFixed(1) : '-';
  const f = (v, label, val, keys) => ({ v, label, val: keys.some((k) => touched.has(k)) ? '상담사 체크' : val });
  // 옆모습 턱각을 실제로 잰 경우에만 (상담사 체크만으로는 옆모습 항목을 만들지 않음)
  const prof = base.profJaw == null ? {} : {
    profJaw: f(profJaw, '옆모습 턱각이 작음 (옆턱 골격 발달)', `옆모습 턱각 ${PA}°`, ['profJaw']),
    notProfJaw: f(1 - profJaw, '옆모습 턱각이 크거나 보통 (옆턱이 두드러지지 않음)', `옆모습 턱각 ${PA}°`, ['profJaw']),
    profRound: f(profRound, '옆모습 턱선이 완만함', `옆모습 턱각 ${PA}°`, ['profJaw']),
  };

  const R = r2(m.R), F = r2(m.f), J = r2(m.j), A = Math.round(m.Aj), I = (m.In * 100).toFixed(1), CH = r2(m.chinRatio);
  return {
    vertical: f(vertical, '세로가 평균보다 김 (세로형)', `세로÷가로 ${R}`, ['vertical']),
    notLong: f(1 - long, '세로 길이가 지나치게 길지 않음', `세로÷가로 ${R}`, ['long']),
    long: f(long, '세로 비율이 뚜렷하게 김', `세로÷가로 ${R}`, ['long']),
    short: f(short, '세로가 평균보다 짧음 (가로형)', `세로÷가로 ${R}`, ['short']),
    fWide: f(fWide, '이마 폭이 넓은 편', `이마÷광대 ${F}`, ['fWide']),
    fMax: f(fMax, '이마가 가장 넓음', `이마÷광대 ${F}`, ['fMax']),
    notFMax: f(1 - fMax, '이마가 광대보다 넓지는 않음', `이마÷광대 ${F}`, ['fMax']),
    fNarrow: f(fNarrow, '이마가 상대적으로 좁음', `이마÷광대 ${F}`, ['fNarrow']),
    jWide: f(jWide, '옆턱 폭이 넓음', `턱÷광대 ${J}`, ['jWide']),
    jNarrow: f(jNarrow, '턱으로 갈수록 좁아짐', `턱÷광대 ${J}`, ['jNarrow']),
    notJNarrow: f(1 - jNarrow, '아래 외곽에 존재감이 있음', `턱÷광대 ${J}`, ['jNarrow']),
    cheekProm: f(cheekProm, '옆광대가 가장 넓게 도드라짐', `이마÷광대 ${F}, 턱÷광대 ${J}`, ['cheekProm']),
    notCheekProm: f(1 - cheekProm, '광대가 특별히 도드라지지 않음', `이마÷광대 ${F}, 턱÷광대 ${J}`, ['cheekProm']),
    angular: f(angular, '턱각이 분명함', `턱각 ${A}°`, ['angular']),
    soft: f(1 - angular, '턱선이 완만하게 이어짐', `턱각 ${A}°`, ['angular']),
    hollow: f(hollow, '광대 아래(협부)가 안쪽으로 들어감', `협부 패임 ${I}%`, ['hollow']),
    flatSide: f(1 - hollow, '협부 꺼짐이 없음', `협부 패임 ${I}%`, ['hollow']),
    chinV: f(chinV, '턱 끝이 V자로 좁게 떨어짐', `턱끝÷턱 ${CH}`, ['chinV']),
    notChinV: f(1 - chinV, '턱 끝이 뾰족하지 않음', `턱끝÷턱 ${CH}`, ['chinV']),
    round: f(round, '광대~턱 윤곽이 둥글게 부풂', `협부 ${I}%`, ['hollow']),
    straight: f(straight, '광대~턱 윤곽이 직선적이고 모서리가 뚜렷함', `곡선도 ${RMS}`, ['straight']),
    notStraight: f(1 - straight, '광대~턱 윤곽이 곡선으로 이어짐', `곡선도 ${RMS}`, ['straight']),
    even: f(even, '이마·광대·턱 폭 차이가 작음', `이마÷광대 ${F}, 턱÷광대 ${J}`, ['even']),
    balanced: f(balanced, '특정 부위가 두드러지지 않음', `폭 변화 완만`, ['cheekProm', 'fWide', 'jWide', 'hollow', 'long', 'short', 'angular', 'jNarrow', 'fNarrow', 'straight']),
    ...prof,
  };
}

const SHAPE_RULES = {
  계란형: [['vertical', 1], ['notLong', 1], ['soft', 1], ['balanced', 2], ['notChinV', 1], ['notStraight', 0.6]],
  긴형: [['long', 3], ['flatSide', 0.5]],
  둥근형: [['short', 1.5], ['round', 1.5], ['soft', 1], ['even', 1], ['notStraight', 0.5]],
  각진형: [['angular', 2.5], ['jWide', 1.5], ['flatSide', 0.5], ['straight', 0.5]],
  땅콩형: [['hollow', 3], ['notJNarrow', 0.5]],
  // 육각형: 직선적이고 모서리가 여럿인 윤곽 + 턱 아래 V + 옆턱 존재 + 위로 좁아지는 이마
  육각형: [['straight', 2], ['chinV', 1], ['notJNarrow', 0.8], ['fNarrow', 0.5], ['flatSide', 0.5], ['soft', 0.3]],
  마름모형: [['cheekProm', 2.5], ['jNarrow', 1], ['fNarrow', 1], ['soft', 0.5]],
  역삼각형: [['fMax', 2], ['fWide', 1], ['jNarrow', 1], ['notCheekProm', 0.5]],
  하트형: [['jNarrow', 1.5], ['notFMax', 0.8], ['soft', 0.8], ['notCheekProm', 0.5], ['flatSide', 0.4], ['notStraight', 0.8]],
};

// 옆모습 턱각이 있을 때만 더하는 항목 (옆턱 골격: 각진형·육각형은 턱각이 작고, 계란·둥근·하트 등은 완만)
const PROFILE_RULES = {
  각진형: [['profJaw', 1.2]],
  육각형: [['profJaw', 1.0]],
  땅콩형: [['profJaw', 0.3]],
  계란형: [['notProfJaw', 0.6]],
  둥근형: [['profRound', 0.8]],
  하트형: [['notProfJaw', 0.4]],
  마름모형: [['notProfJaw', 0.3]],
  역삼각형: [['notProfJaw', 0.3]],
};

export function classifyShape(m, q, shapeAnswers = {}) {
  const F = describeShapeFeatures(m, baseShapeValues(m, { profJawAngle: m.profJawAngle }), shapeAnswers);
  const scores = Object.entries(SHAPE_RULES).map(([name, base]) => {
    const rule = F.profJaw ? [...base, ...(PROFILE_RULES[name] || [])] : base;
    const tw = rule.reduce((s, [, w]) => s + w, 0);
    const score = rule.reduce((s, [k, w]) => s + F[k].v * w, 0) / tw;
    const reasons = rule
      .map(([k, w]) => ({ ...F[k], c: F[k].v * w }))
      .sort((a, b) => b.c - a.c)
      .slice(0, 3);
    return { name, score, reasons };
  }).sort((a, b) => b.score - a.score);

  const [first, second] = scores;
  const gap = first.score - second.score;
  let conf = gap >= 0.15 ? '높음' : gap >= 0.07 ? '보통' : '낮음';
  if (q.level === 'mid' && conf === '높음') conf = '보통';
  const boundary = gap < 0.07;
  const decided = q.level !== 'low';
  if (!decided) conf = '낮음';

  return {
    first: decided ? first.name : null,
    candidates: [first.name, second.name],
    candidate: boundary || !decided ? second.name : null,
    confidence: conf,
    boundary,
    reasons: first.reasons,
    scores,
    features: F,
  };
}

// ───────────────────────── 3) 얼굴무드 (매트릭스 8가지) ─────────────────────────
// group age: a=동안, b=성숙 / group line: c=곡선, d=직선
export const TYPE_ITEMS = [
  { id: 'shapeRatio', group: 'age', q: '얼굴 세로·가로 비율', a: '세로가 짧은 편', b: '세로가 긴 편',
    // 책의 '가로×1.4' 기준은 줄자 측정 기준. 사진(피부 윤곽·헤어라인) 측정에서는 평균이 1.32 라서 그 값을 기준으로 씀
    auto: (m) => ({ v: m.R < CONFIG.shapeBase.R[0] ? 'a' : 'b', val: `세로÷가로 ${r2(m.R)} (사진 측정 평균 ${CONFIG.shapeBase.R[0]})` }) },
  { id: 'chinLen', group: 'age', q: '턱 길이 (아랫입술 아래 끝 ~ 턱 끝)', a: '턱이 짧다', b: '턱이 길다',
    auto: (m) => ({ v: m.chinLen < CONFIG.type.chinLen ? 'a' : 'b', val: `하안부(코 밑~턱 끝) 중 턱 길이 ${Math.round(m.chinLen * 100)}%` }) },
  { id: 'eyeGap', group: 'age', q: '눈 위치', a: '눈과 눈 사이가 넓다', b: '눈과 눈 사이가 좁다',
    auto: (m) => ({ v: m.eyeGap >= CONFIG.type.eyeGap ? 'a' : 'b', val: `눈 사이÷눈 폭 ${r2(m.eyeGap)}` }) },
  { id: 'noseBridge', group: 'age', q: '콧대', a: '코가 낮다', b: '코가 높다', manual: '옆모습 사진을 넣으면 자동으로 재요',
    profile: (pm) => ({ v: pm.noseProj >= CONFIG.profile.noseProj ? 'b' : 'a', val: `옆모습 · 코끝 돌출 ${(pm.noseProj * 100).toFixed(1)}%` }) },
  { id: 'depth', group: 'age', q: '얼굴 전체의 입체감', a: '평면적', b: '입체적', manual: '옆모습 사진을 넣으면 자동으로 재요',
    profile: (pm) => ({ v: pm.depth >= CONFIG.profile.depth ? 'b' : 'a', val: `옆모습 · 코끝 돌출 ${(pm.depth * 100).toFixed(1)}% (이마~턱끝 기준)` }) },
  { id: 'eyeSize', group: 'age', q: '눈 크기 (얼굴 면적 대비)', a: '눈이 작다', b: '눈이 크다',
    auto: (m) => ({ v: m.eyeSize >= CONFIG.type.eyeSize ? 'b' : 'a', val: `눈 폭÷광대폭 ${r2(m.eyeSize)}` }) },
  { id: 'noseWidth', group: 'age', q: '콧방울 크기', a: '콧방울 폭이 한쪽 눈보다 작다', b: '콧방울 폭이 한쪽 눈보다 크다',
    auto: (m) => ({ v: m.noseW < CONFIG.type.noseW ? 'a' : 'b', val: `콧방울÷눈 폭 ${r2(m.noseW)}` }) },
  { id: 'mouth', group: 'age', q: '입 크기', a: '입이 작다', b: '입이 크다',
    auto: (m) => ({ v: m.mouth >= CONFIG.type.mouth ? 'b' : 'a', val: `입 폭÷광대폭 ${r2(m.mouth)}` }) },

  { id: 'bone', group: 'line', q: '얼굴 전체 형상', c: '골격이 느껴지지 않는다', d: '골격이 느껴진다', hint: true,
    auto: (m) => ({ v: m.Aj <= CONFIG.A0 - 6 ? 'd' : 'c', val: `턱각 ${Math.round(m.Aj)}° (참고)` }) },
  { id: 'cheek', group: 'line', q: '볼살', c: '볼이 둥글게 나와 있다', d: '볼이 별로 둥글지 않다', manual: '볼의 볼륨감은 눈으로 확인해 주세요' },
  { id: 'eyeShape', group: 'line', q: '눈 모양', c: '둥글고 세로 폭이 있다', d: '가늘고 길다',
    auto: (m) => ({ v: m.eyeOpen >= CONFIG.type.eyeOpen ? 'c' : 'd', val: `눈 세로÷가로 ${r2(m.eyeOpen)}` }) },
  { id: 'eyelid', group: 'line', q: '눈꺼풀', c: '쌍꺼풀 폭이 넓다', d: '외꺼풀 혹은 속쌍꺼풀', manual: '쌍꺼풀은 눈으로 확인해 주세요' },
  { id: 'eyeTail', group: 'line', q: '눈꼬리', c: '눈꼬리가 처져 있다', d: '눈꼬리가 올라가 있다',
    auto: (m) => ({ v: m.eyeTilt >= CONFIG.type.eyeTilt ? 'd' : 'c', val: `눈꼬리 각도 ${m.eyeTilt.toFixed(1)}°` }) },
  { id: 'brow', group: 'line', q: '눈썹 모양', c: '눈썹산이 없고 아치형', d: '눈썹산이 각지거나 직선적', hint: true,
    auto: (m) => ({ v: m.browArch < CONFIG.type.browArch ? 'd' : 'c', val: `아치 높이 ${Math.round(m.browArch * 100)}% (참고)` }) },
  { id: 'noseShape', group: 'line', q: '코 형태', c: '콧방울이 둥글다', d: '콧날이 서 있다', manual: '옆모습 사진을 넣으면 참고값을 채워요', profileHint: true,
    profile: (pm) => ({
      v: Math.abs(pm.dorsumDev) <= CONFIG.profile.dorsumStraight && pm.noseProj >= CONFIG.profile.noseProj ? 'd' : 'c',
      val: `옆모습 · 콧등 휨 ${(pm.dorsumDev * 100).toFixed(1)}%, 코끝 돌출 ${(pm.noseProj * 100).toFixed(1)}% (참고)` }) },
  { id: 'lips', group: 'line', q: '입술 두께', c: '입술이 두꺼운 편', d: '입술이 얇은 편',
    auto: (m) => ({ v: m.lips >= CONFIG.type.lips ? 'c' : 'd', val: `입술÷입 폭 ${r2(m.lips)}` }) },
];

export const TYPES = {
  큐트: { axis: '동안 × 곡선', mood: '귀엽다, 생기 있다, 친근하다, 부드럽다', point: '둥근 곡선을 이용하면 매력적', taste: '큐트, 캐주얼, 걸리, 스위트, 페미닌' },
  액티브큐트: { axis: '동안 × 곡선', mood: '활기차다, 발랄하다, 친근하다, 파워풀하다', point: '어딘가에 임팩트가 있는 캐주얼', taste: '캐주얼, 큐트, 팝, 액티브' },
  프레시: { axis: '동안 × 직선·곡선 믹스', mood: '상쾌하다, 신선하다, 깨끗한 느낌', point: '꾸밈없는 심플 캐주얼', taste: '프레시, 캐주얼, 소프트엘리건트, 보이시, 청초' },
  쿨캐주얼: { axis: '동안 × 직선', mood: '쿨, 보이시, 멋지다, 씩씩하다', point: '캐주얼 베이스에 재미를 플러스', taste: '쿨캐주얼, 보이시, 모드, 스포티' },
  페미닌: { axis: '성숙 × 곡선', mood: '여성스럽다, 우아하다, 화려하다, 성숙하다', point: '눈에 띄는 화려함, 여성스러움', taste: '페미닌, 엘리건트, 섹시' },
  소프트엘리건트: { axis: '성숙 × 직선·곡선 믹스', mood: '소프트, 섬세하다, 기품 있다, 상냥하다', point: '절제된 여성스러움, 기품 있고 깔끔한 스타일', taste: '소프트엘리건트, 노블, 트래디셔널' },
  엘리건트: { axis: '성숙 × 직선·곡선 믹스', mood: '우아하다, 기품 있다, 세련되다, 화려하다', point: '화려함을 살린 패션', taste: '엘리건트, 컨서버티브, 트래디셔널' },
  쿨: { axis: '성숙 × 직선', mood: '쿨하다, 늠름하다, 성숙하다, 도회적이다', point: '한눈에 들어오는 쿨 & 엘리건트', taste: '쿨, 매니시, 모던, 엘리건트' },
};

function typeOf(age, line, bigEye) {
  if (age === '동안') {
    if (line === '곡선') return bigEye ? '액티브큐트' : '큐트';
    if (line === '믹스') return '프레시';
    return '쿨캐주얼';
  }
  if (line === '곡선') return '페미닌';
  if (line === '믹스') return bigEye ? '엘리건트' : '소프트엘리건트';
  return '쿨';
}

// 차트 규칙: 곡선(C) 7~8개 → 곡선 / 직선(D) 2~6개 → 믹스 / D 7~8개 → 직선
function lineBand(d) {
  if (d <= 1) return '곡선';
  if (d <= 6) return '믹스';
  return '직선';
}

export function classifyType(answers) {
  const cnt = { a: 0, b: 0, c: 0, d: 0 };
  let missing = 0;
  for (const it of TYPE_ITEMS) {
    const v = answers[it.id]?.v;
    if (v) cnt[v]++;
    else missing++;
  }
  const ageMargin = Math.abs(cnt.a - cnt.b);
  const lineMargin = Math.abs(cnt.c - cnt.d);
  const bigEye = answers.eyeSize?.v === 'b';

  // 동점이면 얼굴 길이(세로÷가로)로 결정: 세로가 긴 얼굴은 성숙 쪽이 1순위, 다른 쪽은 후보
  const tieByLength = answers.shapeRatio?.v === 'b' ? ['성숙', '동안'] : ['동안', '성숙'];
  const ages = cnt.a > cnt.b ? ['동안'] : cnt.b > cnt.a ? ['성숙'] : tieByLength;
  // 미응답 직선 문항은 반반으로 가정하지 않고, 현재 응답 비율로 8문항을 환산
  const lineAnswered = cnt.c + cnt.d;
  const dScaled = lineAnswered ? Math.round((cnt.d / lineAnswered) * 8) : 4;
  const band = lineBand(dScaled);
  const nearBand = dScaled === 1 ? '믹스' : dScaled === 2 ? '곡선' : dScaled === 6 ? '직선' : dScaled === 7 ? '믹스' : null;

  const first = typeOf(ages[0], band, bigEye);
  let candidate = null;
  if (ages.length === 2) candidate = typeOf(ages[1], band, bigEye);
  else if (nearBand) candidate = typeOf(ages[0], nearBand, bigEye);

  let conf = ageMargin >= 2 && !nearBand ? '높음' : ageMargin >= 1 ? '보통' : '낮음';
  if (missing > 0 && conf === '높음') conf = '보통';

  const reasons = [
    `동안 요소 ${cnt.a}개 · 성숙 요소 ${cnt.b}개 → ${ages.length === 2 ? `동안/성숙 경계 (얼굴 세로가 ${ages[0] === '성숙' ? '긴' : '짧은'} 편이라 ${ages[0]} 우선)` : ages[0] + '형'}`,
    `곡선 ${cnt.c}개 · 직선 ${cnt.d}개 → ${band === '믹스' ? '직선·곡선 믹스' : band + '형'} (직선 2~6개 = 믹스 기준)`,
  ];
  if (['큐트', '액티브큐트', '소프트엘리건트', '엘리건트'].includes(first)) {
    reasons.push(`눈 크기 ${bigEye ? '큰 편' : '작은 편~보통'} → ${first}`);
  } else {
    reasons.push(`${TYPES[first].axis} 조합`);
  }

  return {
    first, candidate, confidence: conf, cnt,
    ageMargin, lineMargin, missing,
    boundary: ages.length === 2 || !!nearBand,
    reasons,
  };
}
