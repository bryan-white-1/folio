import { t } from './i18n';
import { diagramSvg, type Diagram } from './mermaid-renderer';

let closeViewer: (() => void) | undefined;
export function dismissDiagramViewer() { closeViewer?.(); }
export function showDiagramViewer(diagram: Diagram, trigger: HTMLElement) {
  dismissDiagramViewer();
  const dialog = document.createElement('dialog'); dialog.className = 'mermaid-viewer';
  dialog.setAttribute('aria-label', t('Mermaid 확대 보기'));
  const header = document.createElement('div'); header.className = 'mermaid-viewer-bar';
  const title = document.createElement('strong'); title.textContent = 'Mermaid';
  const percent = document.createElement('output'); percent.setAttribute('aria-label', t('확대율'));
  const viewport = document.createElement('div'); viewport.className = 'mermaid-viewport'; viewport.tabIndex = 0;
  viewport.setAttribute('aria-label', t('다이어그램 스크롤 영역'));
  const canvas = document.createElement('div'); canvas.className = 'mermaid-canvas';
  const shadow = canvas.attachShadow({ mode: 'open' }); const svg = diagramSvg(diagram); shadow.append(svg);
  const stage = document.createElement('div'); stage.className = 'mermaid-viewer-stage';
  stage.append(canvas); viewport.append(stage);
  let zoom = 1, fit = true;
  const setZoom = (value: number, fitting = false) => {
    fit = fitting; zoom = fitting ? Math.min(1, Math.max(0.01, (viewport.clientWidth - 64) / diagram.width)) : Math.max(0.25, Math.min(3, value));
    canvas.style.width = `${diagram.width * zoom}px`; canvas.style.height = `${diagram.height * zoom}px`;
    svg.style.width = '100%'; svg.style.height = '100%'; percent.textContent = `${Math.round(zoom * 100)}%`;
    if (fitting) viewport.scrollTo(viewport.clientWidth, viewport.clientHeight);
  };
  viewport.addEventListener('wheel', event => {
    if (!event.ctrlKey || !event.deltaY) return;
    event.preventDefault();
    if (event.deltaY > 0 && zoom <= 0.25) return;
    const before = canvas.getBoundingClientRect();
    const x = (event.clientX - before.left) / before.width;
    const y = (event.clientY - before.top) / before.height;
    setZoom(zoom + (event.deltaY < 0 ? 0.25 : -0.25));
    const after = canvas.getBoundingClientRect();
    viewport.scrollBy(after.left + x * after.width - event.clientX, after.top + y * after.height - event.clientY);
  }, { passive: false });

  let drag: { id: number; x: number; y: number; left: number; top: number } | undefined;
  viewport.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add('dragging');
  });
  viewport.addEventListener('pointermove', event => {
    if (drag && drag.id === event.pointerId) {
      viewport.scrollTo(drag.left + drag.x - event.clientX, drag.top + drag.y - event.clientY);
    }
  });
  viewport.addEventListener('lostpointercapture', () => {
    drag = undefined;
    viewport.classList.remove('dragging');
  });
  function button(label: string, action: () => void) {
    const el = document.createElement('button'); el.type = 'button'; el.textContent = label; el.onclick = action; header.append(el); return el;
  }
  header.append(title);
  button(t('축소'), () => setZoom(zoom - 0.25)); header.append(percent);
  button(t('확대'), () => setZoom(zoom + 0.25)); button(t('폭 맞춤'), () => setZoom(1, true)); button('100%', () => setZoom(1));
  const close = button(t('닫기'), () => dialog.close());
  dialog.append(header, viewport); document.body.append(dialog);
  const resize = new ResizeObserver(() => { if (fit) setZoom(1, true); }); resize.observe(viewport);
  let closed = false;
  const dispose = () => {
    if (closed) return; closed = true; resize.disconnect(); dialog.remove(); closeViewer = undefined;
    if (trigger.isConnected) trigger.focus({ preventScroll: true });
  };
  closeViewer = () => { dialog.close(); dispose(); };
  dialog.addEventListener('close', dispose, { once: true });
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.showModal(); setZoom(1, true); close.focus();
}
