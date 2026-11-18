// 정면 사진에서 실제 얼굴 피부 영역의 좌우 윤곽선을 찾음.
// 얼굴 인식 메시(평균 얼굴 모양)에서 출발해, 피부 영역이 끝나는 지점으로 행마다 붙임.
import { FilesetResolver, ImageSegmenter } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';
const FACE_SKIN = 3; // 0 배경, 1 머리카락, 2 몸 피부, 3 얼굴 피부, 4 옷, 5 기타

// 메시 외곽선: 이마 꼭대기(10) → 턱 끝(152), 사진 왼쪽 / 오른쪽
export const OVAL_L = [10, 109, 67, 103, 54, 21, 162, 127, 234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152];
export const OVAL_R = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152];

let segPromise = null;
function getSegmenter() {
  if (!segPromise) {
    segPromise = FilesetResolver.forVisionTasks(WASM).then((fs) => ImageSegmenter.createFromOptions(fs, {
      baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' },
      runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false,
    }));
    segPromise.catch(() => { segPromise = null; });
  }
  return segPromise;
}

export async function faceContour(img, lm) {
  const W = img.naturalWidth, H = img.naturalHeight;
  const k = Math.min(1, 1024 / Math.max(W, H));
  const cv = document.createElement('canvas');
  cv.width = Math.round(W * k); cv.height = Math.round(H * k);
  const c2 = cv.getContext('2d', { willReadFrequently: true });
  c2.drawImage(img, 0, 0, cv.width, cv.height);
  const pix = c2.getImageData(0, 0, cv.width, cv.height).data;
  // 사진 밝기 (이미지 좌표 → 축소 캔버스 좌표)
  const lum = (x, y) => {
    const xi = Math.max(0, Math.min(cv.width - 1, Math.round(x * k))), yi = Math.max(0, Math.min(cv.height - 1, Math.round(y * k)));
    const i = (yi * cv.width + xi) * 4;
    return 0.299 * pix[i] + 0.587 * pix[i + 1] + 0.114 * pix[i + 2];
  };
  const seg = await getSegmenter();
  const res = seg.segment(cv);
  const mask = res.confidenceMasks[FACE_SKIN];
  const mw = mask.width, mh = mask.height;
  const conf = mask.getAsFloat32Array().slice();
  res.close?.();

  // 피부 확률 (이미지 좌표, 쌍선형 보간)
  const at = (x, y) => {
    const fx = (x / W) * mw - 0.5, fy = (y / H) * mh - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    if (x0 < 0 || y0 < 0 || x0 + 1 >= mw || y0 + 1 >= mh) return 0;
    const tx = fx - x0, ty = fy - y0, i = y0 * mw + x0;
    return conf[i] * (1 - tx) * (1 - ty) + conf[i + 1] * tx * (1 - ty) + conf[i + mw] * (1 - tx) * ty + conf[i + mw + 1] * tx * ty;
  };

  const P = (i) => ({ x: lm[i].x * W, y: lm[i].y * H });
  const Wc = Math.abs(P(454).x - P(234).x);
  const meshX = (ids, y) => {
    const pts = ids.map(P);
    for (let j = 0; j < pts.length - 1; j++) {
      const a = pts[j], b = pts[j + 1];
      if (b.y === a.y) continue;
      if (y >= Math.min(a.y, b.y) && y <= Math.max(a.y, b.y)) return a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y);
    }
    return null;
  };

  const hairline = findHairline();
  const step = Math.max(1, Math.round(H / 700));
  // 헤어라인 바로 아래부터 턱끝까지 실제 윤곽을 찾음 (헤어라인을 못 찾으면 이마 폭 높이부터)
  const y0 = Math.round(hairline ? hairline.y + (P(9).y - hairline.y) * 0.08 : P(54).y), y1 = Math.round(P(152).y);
  const rows = { L: new Map(), R: new Map() };
  const rowsRaw = { L: new Map(), R: new Map() }; // 밝기 보정 전 피부 경계 (협부 패임·턱각 측정용)
  const dx = Math.max(0.5, W / mw / 3);
  const gapMax = 0.012 * Wc;                // 이보다 짧은 피부 끊김(잔머리·그림자)만 건너뜀 (귀 앞 틈은 건너뛰지 않음)
  const refineR = Math.max(2, (1.5 * W) / mw);
  const foreheadY = P(54).y, midX = (P(9).x + P(10).x) / 2;
  const earTop = Math.min(P(127).y, P(356).y), earBottom = Math.max(P(132).y, P(361).y);
  for (let y = y0; y <= y1; y += step) {
    for (const side of ['L', 'R']) {
      const out = side === 'L' ? -1 : 1;
      // 이마 윗부분(이마 폭 점보다 위): 메시가 헤어라인까지 닿지 않으므로 이마 가운데에서 바깥으로 피부 끝을 찾음
      if (y < foreheadY - 3 * step) {     // (이마 폭 측정 높이는 기존 방식 유지)
        if (at(midX, y) < 0.5) continue;    // 가운데가 피부가 아님(앞머리 등)
        let x = midX, lastSkin = midX, edge = null;
        const end = midX + out * 0.7 * Wc;
        for (; out < 0 ? x >= end : x <= end; x += out * dx) {
          if (at(x, y) >= 0.5) { lastSkin = x; continue; }
          if (Math.abs(x - lastSkin) > gapMax) { edge = lastSkin; break; }
        }
        if (edge != null) rows[side].set(y, edge);
        continue;
      }
      const xm = meshX(side === 'L' ? OVAL_L : OVAL_R, y);
      if (xm == null) continue;
      // 메시 선보다 조금 안쪽 피부에서 출발 (눈꼬리를 피하려고 너무 안쪽에서는 시작하지 않음)
      let x = [0.06, 0.1, 0.14].map((o) => xm - out * o * Wc).find((sx) => at(sx, y) >= 0.5);
      if (x == null) continue;              // 안쪽도 피부가 아님(머리카락이 덮음) → 이 행은 메시 사용
      // 평균 얼굴선 조금 바깥까지만 (귀까지 가지 않게).
      // 귀 높이(눈썹 옆~귓불)에서는 귀가 얼굴 피부에 붙어 있어 피부가 귀 바깥까지 이어지므로 더 좁게 보고,
      // 그 안에서 피부가 안 끝나면(=귀에 붙음) 이 행은 버림 → 광대 점은 메시 외곽점을 씀
      const earBand = y >= earTop && y <= earBottom;
      const end = xm + out * (earBand ? 0.03 : 0.1) * Wc;
      let lastSkin = x, edge = null;
      for (; out < 0 ? x >= end : x <= end; x += out * dx) {
        if (at(x, y) >= 0.5) { lastSkin = x; continue; }
        if (Math.abs(x - lastSkin) > gapMax) { edge = lastSkin; break; }
      }
      if (edge == null) continue;
      // 사진의 밝기 경계로 정밀하게 맞춤 (피부 판정은 256px 해상도라 몇 px 뭉개짐)
      let best = edge, bg = -1;
      for (let xx = edge - refineR; xx <= edge + refineR; xx += 0.5) {
        const g = Math.abs(lum(xx + 1, y) - lum(xx - 1, y));
        if (g > bg) { bg = g; best = xx; }
      }
      rows[side].set(y, bg > 12 ? best : edge);
    }
    // 협부 패임·턱각용: 메시 안쪽 0.15에서 출발해 처음 피부가 끝나는 곳 (보정 기준값을 잡을 때 쓴 방식 그대로)
    for (const side of ['L', 'R']) {
      const xm = meshX(side === 'L' ? OVAL_L : OVAL_R, y);
      if (xm == null) continue;
      const out = side === 'L' ? -1 : 1;
      let x = xm - out * 0.15 * Wc;
      const end = xm + out * 0.15 * Wc;
      if (at(x, y) < 0.5) continue;
      for (; out < 0 ? x >= end : x <= end; x += out * dx) {
        if (at(x, y) < 0.5) { rowsRaw[side].set(y, x - (out * dx) / 2); break; }
      }
    }
  }
  // 튀는 값 정리 (중앙값)
  for (const r of [rows, rowsRaw]) for (const side of ['L', 'R']) {
    const ys = [...r[side].keys()];
    const xs = ys.map((y) => r[side].get(y));
    ys.forEach((y, i) => {
      const win = xs.slice(Math.max(0, i - 3), i + 4).sort((a, b) => a - b);
      r[side].set(y, win[win.length >> 1]);
    });
  }
  const coverage = (rows.L.size + rows.R.size) / (2 * ((y1 - y0) / step + 1));

  // 턱 모서리: 광대 높이~턱끝 사이 윤곽을 '두 직선'(광대→모서리, 모서리→턱끝)으로 가장 잘 맞추는 꺾임점
  //  rms = 윤곽이 두 직선에서 벗어난 정도(광대폭 대비). 작을수록 직선 + 뚜렷한 모서리(각진 턱)
  const segDist2 = (p, a, b) => {
    const vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2));
    const dx = p.x - (a.x + t * vx), dy = p.y - (a.y + t * vy);
    return dx * dx + dy * dy;
  };
  const jawCorner = (side) => {
    const cheekY = P(side === 'L' ? 234 : 454).y, chin = P(152);
    const pts = [...rows[side].entries()].filter(([y]) => y >= cheekY && y <= chin.y)
      .sort((a, b) => a[0] - b[0]).map(([y, x]) => ({ x, y }));
    if (pts.length < 12) return null;
    const A = pts[0];
    let best = null;
    for (let i = Math.floor(pts.length * 0.25); i < Math.floor(pts.length * 0.92); i++) {
      const C = pts[i];
      let err = 0;
      for (let j = 0; j < pts.length; j++) err += j <= i ? segDist2(pts[j], A, C) : segDist2(pts[j], C, chin);
      if (!best || err < best.err) best = { C, err };
    }
    return best && { x: best.C.x, y: best.C.y, rms: Math.sqrt(best.err / pts.length) / Wc };
  };
  const jaw = { L: jawCorner('L'), R: jawCorner('R') };

  return {
    coverage,
    rows,
    hairline,
    jaw,
    // side 'L'(사진 왼쪽) / 'R', y(이미지 좌표)에 해당하는 윤곽 x. 없으면 null
    // raw=true 면 밝기 보정 전 피부 경계
    at(side, y, raw = false) {
      const r = (raw ? rowsRaw : rows)[side];
      const yy = Math.round((y - y0) / step) * step + y0;
      for (let d = 0; d <= step * 2; d += step) {
        if (r.has(yy + d)) return r.get(yy + d);
        if (r.has(yy - d)) return r.get(yy - d);
      }
      return null;
    },
  };

  // 헤어라인: 미간에서 이마 가운데를 따라 위로 올라가며 얼굴 피부가 끝나는 곳 (가운데 근처 5줄의 중앙값)
  function findHairline() {
    let hairline = null;
    const g = P(9), top = P(10), sub = P(2);
    const middle = sub.y - g.y;
    const ys = [];
    for (const off of [-0.04, -0.02, 0, 0.02, 0.04]) {
      const x = g.x + (top.x - g.x) * 0.5 + off * Wc;
      // 눈썹(털)을 피하려고 미간보다 조금 위에서 시작, 피부를 한 번 확인한 뒤부터 경계를 찾음
      let y = g.y - middle * 0.2, miss = 0, found = null, seenSkin = false;
      for (; y > g.y - middle * 1.8; y -= 1) {
        const skin = at(x, y) >= 0.5;
        if (skin) { seenSkin = true; miss = 0; continue; }
        if (seenSkin && ++miss >= 3) { found = y + 3; break; }
      }
      if (found != null) ys.push(found);
    }
    if (ys.length >= 3) {
      ys.sort((a, b) => a - b);
      const y = ys[ys.length >> 1];
      const upper = g.y - y;
      // 상안부가 중안부의 0.55~1.5배 사이일 때만 믿음 (앞머리·모자 등으로 너무 낮거나 높으면 버림)
      if (upper > middle * 0.55 && upper < middle * 1.5) hairline = { x: g.x + (top.x - g.x) * ((g.y - y) / (g.y - top.y)), y };
    }
    return hairline;
  }
}
