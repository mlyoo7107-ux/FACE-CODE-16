// 고객 전달용 진단 레포트 (A4 한 장). 화면 미리보기·인쇄·파일 저장에 같은 HTML을 씀.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const REPORT_CSS = `
.rpt { --ac:#5b3f8c; --soft:#eee8f7; --line:#e7e1ec; --mut:#6f6878; --ink:#17131d;
  font-family: Pretendard, "Noto Sans KR", "Malgun Gothic", sans-serif; color:var(--ink); background:#fff;
  width:210mm; min-height:297mm; margin:0 auto; padding:15mm; font-size:9.3pt; line-height:1.4; box-sizing:border-box; }
/* 화면에서는 A4 종이처럼 보이게 */
@media screen { .rpt { box-shadow:0 2px 14px rgba(23,19,29,.12); margin:6mm auto; } }
.rpt * { box-sizing:border-box; }
.rpt .r-head { display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2.5px solid var(--ac); padding-bottom:2.5mm; margin-bottom:3mm; }
.rpt .r-logo { display:flex; align-items:center; gap:3mm; }
.rpt .r-logo img { height:11mm; width:auto; display:block; mix-blend-mode:multiply; }
.rpt .r-logo span { font-size:8pt; font-weight:800; letter-spacing:.08em; color:var(--ac); border-left:1px solid var(--line); padding-left:3mm; }
.rpt .r-brand { font-size:9pt; font-weight:800; letter-spacing:.08em; color:var(--ac); }
.rpt h1 { font-size:15pt; margin:1mm 0 0; }
.rpt .r-meta { text-align:right; font-size:9.5pt; color:var(--mut); }
.rpt .r-meta b { color:var(--ink); }
.rpt .r-photos { display:grid; grid-template-columns:1fr 1fr; gap:3mm; margin-bottom:3mm; }
.rpt .r-photos.one { grid-template-columns:1fr; }
.rpt .r-photo { border:1px solid var(--line); border-radius:3mm; overflow:hidden; text-align:center; background:#faf9fb; }
.rpt .r-photo img { display:block; width:100%; height:55mm; object-fit:contain; background:#faf9fb; }
.rpt .r-photo div { font-size:8.5pt; color:var(--mut); padding:1mm 0; }
.rpt .r-two { display:grid; grid-template-columns:1fr 1fr; gap:3mm; }
.rpt .r-card { border:1px solid var(--line); border-radius:3mm; padding:2.5mm 3mm; margin-bottom:3mm; break-inside:avoid; }
.rpt .r-card h2 { font-size:10pt; color:var(--ac); margin:0 0 2mm; display:flex; gap:2mm; align-items:center; }
.rpt .r-card h2 .n { width:5.5mm; height:5.5mm; border-radius:50%; background:var(--ac); color:#fff; display:inline-grid; place-items:center; font-size:8.5pt; }
.rpt .r-big { background:var(--soft); border-radius:2.5mm; padding:2mm 3mm; margin-bottom:2mm; }
.rpt .r-big .lab { font-size:8pt; color:var(--ac); font-weight:800; }
.rpt .r-big .name { font-size:15pt; font-weight:800; line-height:1.2; }
.rpt .r-big .name small { font-size:10pt; color:var(--mut); font-weight:600; margin-left:2mm; }
.rpt .r-big .sub { font-size:9pt; color:var(--mut); margin-top:1mm; }
.rpt table { width:100%; border-collapse:collapse; font-size:8.5pt; }
.rpt td { padding:.6mm 0.5mm; border-bottom:1px solid var(--line); vertical-align:top; }
.rpt td:last-child { text-align:right; font-weight:700; white-space:nowrap; }
.rpt ol, .rpt ul { margin:0; padding-left:5mm; font-size:8.8pt; }
.rpt .r-tip { background:#faf9fb; border:1px solid var(--line); border-radius:2mm; padding:1.5mm 2.5mm; font-size:8.8pt; margin-top:1.5mm; }
.rpt .r-sub { font-size:8pt; font-weight:800; color:var(--ac); margin:1.8mm 0 .6mm; }
.rpt .r-bars .row { display:grid; grid-template-columns:14mm 1fr 10mm; gap:2mm; align-items:center; font-size:8.5pt; }
.rpt .r-bars .bar { height:2mm; background:#efebf3; border-radius:9px; overflow:hidden; }
.rpt .r-bars .bar div { height:100%; background:var(--ac); }
.rpt .r-matrix { display:grid; grid-template-columns:9mm repeat(3,1fr); gap:1mm; font-size:7.5pt; text-align:center; margin:2mm 0; }
.rpt .r-matrix div { padding:1.2mm .5mm; border-radius:1.5mm; background:#faf9fb; border:1px solid var(--line); }
.rpt .r-matrix .h { background:none; border:none; color:var(--mut); font-weight:700; }
.rpt .r-matrix .on { background:var(--ac); color:#fff; border-color:var(--ac); font-weight:800; }
.rpt .r-memo { white-space:pre-wrap; font-size:9.5pt; min-height:12mm; }
.rpt .r-big .sub b { color:var(--ink); }
.rpt .r-note { font-size:7.8pt; color:var(--mut); margin-top:.8mm; line-height:1.35; }
.rpt .r-qr { display:flex; align-items:center; gap:5mm; border:1px solid var(--line); background:var(--soft); border-radius:3mm; padding:3mm 4mm; margin-bottom:3mm; break-inside:avoid; }
.rpt .r-qr-msg { flex:1; font-size:9pt; color:var(--mut); line-height:1.5; }
.rpt .r-qr-msg b { color:var(--ac); font-size:10.5pt; }
.rpt .r-qr-item { text-align:center; font-size:7.5pt; font-weight:700; color:var(--ac); }
.rpt .r-qr-item img { display:block; width:22mm; height:22mm; background:#fff; border-radius:1.5mm; padding:1mm; margin:0 auto 1mm; }
.rpt .r-foot { font-size:7.5pt; color:var(--mut); border-top:1px solid var(--line); padding-top:2mm; margin-top:1mm; }
`;

const MATRIX = [
  ['동안', ['쿨캐주얼', '프레시', '큐트 · 액티브큐트']],
  ['성숙', ['쿨', '소프트엘리건트 · 엘리건트', '페미닌']],
];

// 고객용 표기: 주(최종 결과) · 보조(가장 가까운 다른 하나). 점수·신뢰도는 상담사 화면에만 둠
function rankLine(x, kind) {
  const second = [x.rank1, x.rank2].find((n) => n && n !== x.name);
  return `주 ${kind} <b>${esc(x.name || x.rank1)}</b>${second ? ` · 보조 ${kind} <b>${esc(second)}</b>` : ''}`;
}

// d: app.js 의 reportData() 결과
export function reportHTML(d) {
  const shapeRows = d.shape.measures.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('');
  const profileRows = d.profile ? d.profile.map((r) => `<tr><td>${esc(r.label)}</td><td>${esc(r.text)}</td></tr>`).join('') : '';
  const cell = (txt) => `<div class="${txt.split(' · ').includes(d.type.name) ? 'on' : ''}">${esc(txt)}</div>`;
  return `<div class="rpt">
  <div class="r-head">
    <div>${d.logo ? `<div class="r-logo"><img src="${d.logo}" alt="COLOR·M"><span>FACE CODE 16</span></div>` : '<div class="r-brand">COLOR·M · FACE CODE 16</div>'}<h1>얼굴형 · 얼굴무드 진단 레포트</h1></div>
    <div class="r-meta">고객 <b>${esc(d.customer || '—')}</b><br>상담일 <b>${esc(d.date)}</b>${d.consultant ? `<br>상담사 <b>${esc(d.consultant)}</b>` : ''}</div>
  </div>

  <div class="r-photos ${d.profileImg ? '' : 'one'}">
    <div class="r-photo"><img src="${d.frontImg}" alt="정면 사진"><div>정면 · 측정선</div></div>
    ${d.profileImg ? `<div class="r-photo"><img src="${d.profileImg}" alt="옆모습 사진"><div>옆모습 · 측정선</div></div>` : ''}
  </div>

  <div class="r-two">
    <div class="r-card">
      <h2><span class="n">1</span>얼굴형</h2>
      <div class="r-big">
        <div class="lab">${d.shape.fixed ? '최종 판정 (상담사)' : '진단 결과'}</div>
        <div class="name">${esc(d.shape.name || '확정 보류')}${d.shape.en ? `<small>${esc(d.shape.en)}</small>` : ''}</div>
        <div class="sub">${rankLine(d.shape, '얼굴형')}</div>
        <div class="r-note">얼굴형은 체중 변화나 촬영 각도에 따라 달라질 수 있어, 가장 가까운 두 가지를 함께 안내해 드려요.</div>
      </div>
      <div class="r-sub">구조 근거</div>
      <ol>${d.shape.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ol>
      <div class="r-sub">상·중·하안부 비율</div>
      <div class="r-bars">${d.shape.thirds.map(([k, v]) => `<div class="row"><span>${k}</span><div class="bar"><div style="width:${Math.round(v * 250)}%"></div></div><b>${Math.round(v * 100)}%</b></div>`).join('')}</div>
      <div class="r-sub">주요 측정값</div>
      <table>${shapeRows}</table>
      ${d.shape.tip ? `<div class="r-tip"><b>헤어 보완 포인트</b><br>${esc(d.shape.tip)}</div>` : ''}
    </div>

    <div>
      <div class="r-card">
        <h2><span class="n">2</span>얼굴무드</h2>
        <div class="r-big">
          <div class="lab">${d.type.fixed ? '최종 판정 (상담사)' : '진단 결과'}</div>
          <div class="name">${esc(d.type.name)}<small>${esc(d.type.axis)}</small></div>
          <div class="sub">${rankLine(d.type, '무드')}</div>
          <div class="r-note">동안 ${d.type.cnt.a} · 성숙 ${d.type.cnt.b} / 곡선 ${d.type.cnt.c} · 직선 ${d.type.cnt.d} — 두 무드의 특징을 함께 활용하면 스타일 폭이 넓어져요.</div>
        </div>
        <div class="r-matrix"><div class="h"></div><div class="h">직선</div><div class="h">믹스</div><div class="h">곡선</div>
          ${MATRIX.map(([age, row]) => `<div class="h">${age}</div>${row.map(cell).join('')}`).join('')}</div>
        <table>
          <tr><td>인상</td><td style="white-space:normal">${esc(d.type.mood)}</td></tr>
          <tr><td>스타일 포인트</td><td style="white-space:normal">${esc(d.type.point)}</td></tr>
          <tr><td>어울리는 테이스트</td><td style="white-space:normal">${esc(d.type.taste)}</td></tr>
        </table>
      </div>
      ${d.profile ? `<div class="r-card"><h2><span class="n">3</span>옆모습</h2><table>${profileRows}</table></div>` : ''}
      <div class="r-card">
        <h2><span class="n">${d.profile ? 4 : 3}</span>상담 메모</h2>
        <div class="r-memo">${esc(d.memo || '')}</div>
      </div>
    </div>
  </div>

  ${d.qr ? `<div class="r-qr">
    <div class="r-qr-msg"><b>오늘 진단은 어떠셨나요?</b><br>네이버 리뷰 한 줄이 컬러엠에 큰 힘이 됩니다.<br>퍼스널컬러가 궁금하다면 무료 자가진단도 해 보세요.</div>
    ${[['place', '네이버 리뷰'], ['selfcheck', '퍼스널컬러 자가진단'], ['instagram', '인스타그램']]
      .filter(([k]) => d.qr[k]).map(([k, label]) => `<div class="r-qr-item"><img src="${d.qr[k]}" alt="${label} QR"><span>${label}</span></div>`).join('')}
  </div>` : ''}

  <div class="r-foot">사진 품질 ${esc(d.quality)} · 측정값은 사진을 기준으로 한 참고값이며, 촬영 거리·표정·각도에 따라 달라질 수 있습니다. 최종 판단은 상담사의 관찰을 함께 반영합니다.</div>
</div>`;
}

// 파일로 저장할 때 쓰는 완전한 HTML 문서
export function reportDocument(d) {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>진단 레포트 - ${esc(d.customer || '고객')} - ${esc(d.date)}</title>
<style>@page { size:A4; margin:0; } body { margin:0; background:#f6f4f8; } @media print { body { background:#fff; } .rpt { min-height:0; box-shadow:none; margin:0; } } ${REPORT_CSS}</style>
</head><body>${reportHTML(d)}</body></html>`;
}
