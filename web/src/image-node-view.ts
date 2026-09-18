import type { Node } from '@milkdown/kit/prose/model';
import { NodeSelection } from '@milkdown/kit/prose/state';
import type { EditorView, NodeView } from '@milkdown/kit/prose/view';
import { validWidth } from './layout-metadata';

export function imageNodeView(node: Node, view: EditorView, getPos: () => number | undefined, documentId: () => string, commit: (change: () => void) => void): NodeView {
  const dom = document.createElement('span'); dom.className = 'folio-image'; dom.contentEditable = 'false';
  const img = document.createElement('img'); img.draggable = false;
  const controls = document.createElement('span'); controls.className = 'image-controls';
  const input = document.createElement('input'); input.type = 'number'; input.min = '40'; input.max = '2400'; input.step = '1'; input.setAttribute('aria-label', '이미지 너비 (px)');
  const unit = document.createElement('span'); unit.textContent = 'px';
  const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = '원본'; reset.title = '이미지 원본 크기로 복원'; reset.setAttribute('aria-label', reset.title);
  const handle = document.createElement('button'); handle.type = 'button'; handle.className = 'image-resize-handle'; handle.title = '드래그로 크기 조절 · 방향키로 10px 조절'; handle.setAttribute('aria-label', '이미지 크기 조절');
  controls.append(input, unit, reset); dom.append(img, controls, handle);
  let drag: { x: number; width: number; value: number; pointer: number; moved: boolean } | null = null;
  const paint = (width: number | null) => {
    dom.style.width = validWidth(width) ? `${width}px` : '';
    input.value = validWidth(width) ? String(width) : '';
    input.placeholder = '자동';
  };
  const update = (next: Node) => {
    if (next.type.name !== 'image') return false;
    node = next;
    const src = String(node.attrs.src ?? '');
    let resolved = src;
    try {
      const url = new URL(src, 'https://document.local/');
      if (!/^[a-z][a-z0-9+.-]*:/i.test(src)) url.searchParams.set('__folio', documentId());
      resolved = url.href;
    } catch { /* A malformed source remains a broken image, not a broken editor. */ }
    if (img.getAttribute('src') !== resolved) img.src = resolved;
    img.alt = node.attrs.alt ?? ''; img.title = node.attrs.title ?? '';
    if (!drag) paint(node.attrs.width);
    return true;
  };
  const setWidth = (width: number | null) => {
    const pos = getPos(); if (pos === undefined || view.state.doc.nodeAt(pos)?.type !== node.type) return;
    if (node.attrs.width === width) { paint(width); return; }
    commit(() => view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, width })));
  };
  input.addEventListener('change', () => {
    const width = Number(input.value);
    if (input.value === '') setWidth(null);
    else if (validWidth(width)) setWidth(width);
    else { input.reportValidity(); paint(node.attrs.width); }
  });
  reset.addEventListener('click', () => setWidth(null));
  img.addEventListener('click', () => {
    const pos = getPos(); if (pos === undefined) return;
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos))); view.focus();
  });
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault(); handle.focus();
    const width = img.getBoundingClientRect().width;
    drag = { x: event.clientX, width, value: node.attrs.width ?? Math.round(width), pointer: event.pointerId, moved: false };
    handle.setPointerCapture(event.pointerId); dom.classList.add('resizing');
  });
  handle.addEventListener('pointermove', event => {
    if (!drag) return;
    drag.moved = drag.moved || event.clientX !== drag.x;
    drag.value = Math.max(40, Math.min(2400, Math.round(drag.width + event.clientX - drag.x)));
    paint(drag.value);
  });
  const finish = (save: boolean) => {
    if (!drag) return;
    const { value, pointer, moved } = drag; drag = null; dom.classList.remove('resizing');
    if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer);
    if (save && moved) setWidth(value); else paint(node.attrs.width);
  };
  handle.addEventListener('pointerup', () => finish(true));
  handle.addEventListener('pointercancel', () => finish(false));
  handle.addEventListener('lostpointercapture', () => finish(false));
  handle.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const step = ['ArrowLeft', 'ArrowDown'].includes(event.key) ? -10 : 10;
    setWidth(Math.max(40, Math.min(2400, Math.round((node.attrs.width ?? img.getBoundingClientRect().width) + step))));
  });
  update(node);
  return { dom, update, selectNode: () => dom.classList.add('ProseMirror-selectednode'), deselectNode: () => dom.classList.remove('ProseMirror-selectednode'),
    stopEvent: event => event.target !== img && event.target !== dom, ignoreMutation: () => true, destroy: () => finish(false) };
}
