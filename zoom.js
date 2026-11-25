// 사진 확대: 칸 안에서 바로 확대/축소(버튼·마우스 휠) + '크게 보기'로 화면 가득 펼치기.
// 캔버스 요소를 그대로 쓰므로 확대한 상태에서도 점을 끌어서 옮길 수 있음.
const INLINE_MAX_H = 560; // 칸 안에서 사진이 차지하는 최대 높이(px)

export function setupZoom(panel, canvas, btn) {
  let zoom = 1, open = false;
  const stage = document.createElement('div');
  stage.className = 'stage';
  canvas.parentNode.insertBefore(stage, canvas);
  stage.appendChild(canvas);

  const bar = document.createElement('div');
  bar.className = 'zoom-bar';
  bar.innerHTML = `<button data-z="-" title="축소">－</button><span class="zv">100%</span><button data-z="+" title="확대">＋</button>
    <button data-z="fit">맞춤</button><span class="muted hint">휠로 확대 · 빈 곳을 끌면 사진 이동 · 점은 그대로 끌기</span>
    <button data-z="close" class="primary close-btn">닫기 (Esc)</button>`;
  panel.insertBefore(bar, stage);
  const closeBtn = bar.querySelector('.close-btn');

  // 사진이 있을 때만 확대 막대 표시
  const syncBar = () => { bar.hidden = canvas.hidden; closeBtn.hidden = !open; };
  new MutationObserver(syncBar).observe(canvas, { attributes: true, attributeFilter: ['hidden'] });
  syncBar();

  function fitSize() {
    const ratio = canvas.width / canvas.height;
    const availW = stage.clientWidth - (open ? 8 : 0);
    const availH = open ? stage.clientHeight - 8 : INLINE_MAX_H;
    let h = Math.min(availH, availW / ratio);
    return { h, ratio };
  }
  function apply(focus) {
    stage.classList.toggle('zoomed', zoom > 1 || open);
    stage.style.overflow = open && zoom === 1 ? 'hidden' : '';
    bar.querySelector('.zv').textContent = `${Math.round(zoom * 100)}%`;
    if (!open && zoom === 1) { canvas.style.width = ''; canvas.style.height = ''; saveView(); return; }
    const { h, ratio } = fitSize();
    const oldW = canvas.clientWidth || 1, oldH = canvas.clientHeight || 1;
    const fxp = focus ? focus.x : stage.clientWidth / 2, fyp = focus ? focus.y : stage.clientHeight / 2;
    const fx = (stage.scrollLeft + fxp) / oldW, fy = (stage.scrollTop + fyp) / oldH;
    canvas.style.height = `${h * zoom}px`;
    canvas.style.width = `${h * zoom * ratio}px`;
    stage.scrollLeft = fx * canvas.clientWidth - fxp;
    stage.scrollTop = fy * canvas.clientHeight - fyp;
    saveView();
  }
  // 확대해서 보고 있는 부분(이미지 좌표)을 캔버스에 기록 → 레포트 사진이 화면에 보이는 그대로 나옴
  function saveView() {
    if (zoom <= 1 || !canvas.clientWidth) { delete canvas.dataset.view; return; }
    const k = canvas.width / canvas.clientWidth;
    const x = Math.max(0, stage.scrollLeft * k), y = Math.max(0, stage.scrollTop * k);
    const w = Math.min(canvas.width - x, stage.clientWidth * k), h = Math.min(canvas.height - y, stage.clientHeight * k);
    canvas.dataset.view = JSON.stringify({ x, y, w, h });
  }
  stage.addEventListener('scroll', saveView);
  function setOpen(o) {
    open = o; zoom = 1;
    panel.classList.toggle('expanded', o);
    document.body.classList.toggle('noscroll', o);
    btn.textContent = o ? '크게 보기 닫기' : '크게 보기';
    syncBar();
    apply();
  }
  const setZoom = (z, focus) => { zoom = Math.min(8, Math.max(1, z)); apply(focus); };

  btn.addEventListener('click', () => setOpen(!open));
  bar.addEventListener('click', (e) => {
    const z = e.target.closest('button')?.dataset.z;
    if (z === 'close') setOpen(false);
    else if (z === 'fit') { stage.scrollTo(0, 0); setZoom(1); }
    else if (z === '+') setZoom(zoom * 1.25);
    else if (z === '-') setZoom(zoom / 1.25);
  });
  stage.addEventListener('wheel', (e) => {
    if (canvas.hidden) return;
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), { x: e.clientX - r.left, y: e.clientY - r.top });
  }, { passive: false });
  // 확대된 사진을 끌어서 이동 (점을 잡은 경우는 점 이동이 우선 — 점 처리 쪽에서 preventDefault 함)
  let pan = null;
  const canPan = () => stage.scrollWidth > stage.clientWidth + 1 || stage.scrollHeight > stage.clientHeight + 1;
  stage.addEventListener('pointerdown', (e) => {
    if (e.defaultPrevented || canvas.hidden || !canPan()) return;
    pan = { x: e.clientX, y: e.clientY, sl: stage.scrollLeft, st: stage.scrollTop };
    try { stage.setPointerCapture(e.pointerId); } catch {}
    stage.classList.add('panning');
    e.preventDefault();
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pan) return;
    stage.scrollLeft = pan.sl - (e.clientX - pan.x);
    stage.scrollTop = pan.st - (e.clientY - pan.y);
  });
  const endPan = () => { pan = null; stage.classList.remove('panning'); };
  stage.addEventListener('pointerup', endPan);
  stage.addEventListener('pointercancel', endPan);

  // ── 휴대폰·태블릿: 두 손가락으로 벌리고 오므려 확대·축소, 두 손가락을 함께 끌어 이동 ──
  // (캡처 단계에서 먼저 받아서, 두 번째 손가락이 닿으면 점 끌기·한 손가락 이동을 멈추고 핀치로 전환)
  const touches = new Map();
  let pinch = null;
  const mid = () => { const [a, b] = [...touches.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
  const gap = () => { const [a, b] = [...touches.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || canvas.hidden) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size !== 2) return;
    e.stopPropagation(); e.preventDefault();
    // 첫 손가락으로 시작한 점 끌기·사진 이동은 취소
    for (const id of touches.keys()) {
      if (id === e.pointerId) continue;
      const ev = new PointerEvent('pointercancel', { pointerId: id, pointerType: 'touch', bubbles: true });
      ev.__pinchCancel = true;
      canvas.dispatchEvent(ev);
    }
    endPan();
    pinch = { d: gap(), z: zoom, m: mid() };
  }, true);
  stage.addEventListener('pointermove', (e) => {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!pinch || touches.size < 2) return;
    e.stopPropagation(); e.preventDefault();
    const r = stage.getBoundingClientRect(), m = mid();
    setZoom(pinch.z * (gap() / pinch.d), { x: m.x - r.left, y: m.y - r.top });
    // 두 손가락 가운데가 움직인 만큼 사진도 따라 이동
    stage.scrollLeft -= m.x - pinch.m.x;
    stage.scrollTop -= m.y - pinch.m.y;
    pinch.m = m;
  }, true);
  const endTouch = (e) => {
    if (e.__pinchCancel) return; // 위에서 점 끌기를 취소하려고 보낸 신호는 손가락을 뗀 것이 아님
    if (!touches.delete(e.pointerId)) return;
    if (touches.size < 2) pinch = null;
  };
  stage.addEventListener('pointerup', endTouch, true);
  stage.addEventListener('pointercancel', endTouch, true);

  document.addEventListener('keydown', (e) => { if (open && e.key === 'Escape') setOpen(false); });
  window.addEventListener('resize', () => apply());
  // 새 사진을 올리면 확대 초기화
  new MutationObserver(() => { zoom = 1; stage.scrollTo(0, 0); apply(); })
    .observe(canvas, { attributes: true, attributeFilter: ['width', 'height'] });
}
