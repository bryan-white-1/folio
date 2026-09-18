import { diagramSvg, type Diagram } from './mermaid-renderer';

let closeViewer: (() => void) | undefined;
export function dismissDiagramViewer() { closeViewer?.(); }
export function showDiagramViewer(diagram: Diagram, trigger: HTMLElement) {
  dismissDiagramViewer();
  const dialog = document.createElement('dialog'); dialog.className = 'mermaid-viewer';
  dialog.setAttribute('aria-label', 'Mermaid 확대 보기');
  const header = document.createElement('div'); header.className = 'mermaid-viewer-bar';
  const title = document.createElement('strong'); title.textContent = 'Mermaid';
  const percent = document.createElement('output'); percent.setAttribute('aria-label', '확대율');
  const viewport = document.createElement('div'); viewport.className = 'mermaid-viewport'; viewport.tabIndex = 0;
  viewport.setAttribute('aria-label', '다이어그램 스크롤 영역');
  const canvas = document.createElement('div'); canvas.className = 'mermaid-canvas';
  const shadow = canvas.attachShadow({ mode: 'open' }); const svg = diagramSvg(diagram); shadow.append(svg);
  viewport.append(canvas);
  let zoom = 1, fit = true;
  const setZoom = (value: number, fitting = false) => {
    fit = fitting; zoom = fitting ? Math.min(1, Math.max(0.01, (viewport.clientWidth - 64) / diagram.width)) : Math.max(0.25, Math.min(3, value));
    canvas.style.width = `${diagram.width * zoom}px`; canvas.style.height = `${diagram.height * zoom}px`;
    svg.style.width = '100%'; svg.style.height = '100%'; percent.textContent = `${Math.round(zoom * 100)}%`;
  };
  function button(label: string, action: () => void) {
    const el = document.createElement('button'); el.type = 'button'; el.textContent = label; el.onclick = action; header.append(el); return el;
  }
  header.append(title);
  button('축소', () => setZoom(zoom - 0.25)); header.append(percent);
  button('확대', () => setZoom(zoom + 0.25)); button('폭 맞춤', () => setZoom(1, true)); button('100%', () => setZoom(1));
  const close = button('닫기', () => dialog.close());
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
