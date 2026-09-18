import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import type { NodeView } from '@milkdown/kit/prose/view';
import { NodeSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { DiagramError, diagramEvents, diagramMessage, diagramSvg, diagramTheme, renderDiagram, type Diagram } from './mermaid-renderer';
import { dismissDiagramViewer, showDiagramViewer } from './mermaid-viewer';

export const isMermaid = (node: ProseNode) => node.type.name === 'code_block' && String(node.attrs.language).toLowerCase() === 'mermaid';

export function codeBlockView(initial: ProseNode, view: EditorView, getPos: () => number | undefined, edit: (pos: number) => Promise<void>): NodeView {
  let node = initial;
  if (!isMermaid(node)) {
    const dom = document.createElement('pre'), contentDOM = document.createElement('code');
    dom.dataset.language = node.attrs.language; dom.append(contentDOM);
    return { dom, contentDOM, update(next) {
      if (next.type !== node.type || isMermaid(next)) return false;
      node = next; dom.dataset.language = next.attrs.language; return true;
    } };
  }
  const dom = document.createElement('div'); dom.className = 'mermaid-card'; dom.contentEditable = 'false';
  dom.setAttribute('role', 'group'); dom.setAttribute('aria-label', 'Mermaid 다이어그램 블록');
  const bar = document.createElement('div'); bar.className = 'mermaid-card-bar';
  const badge = document.createElement('span'); badge.className = 'mermaid-badge'; badge.textContent = '◇ Mermaid';
  const status = document.createElement('span'); status.className = 'mermaid-status'; status.setAttribute('role', 'status');
  const editButton = document.createElement('button'); editButton.type = 'button'; editButton.textContent = '원문 수정';
  editButton.onclick = () => { const pos = getPos(); if (pos !== undefined) void edit(pos); };
  const expand = document.createElement('button'); expand.type = 'button'; expand.textContent = '확대'; expand.disabled = true;
  const body = document.createElement('div'); body.className = 'mermaid-diagram';
  const shadow = body.attachShadow({ mode: 'open' });
  const fallback = document.createElement('pre'); fallback.className = 'mermaid-fallback'; fallback.hidden = true;
  bar.append(badge, status, editButton, expand); dom.append(bar, body, fallback);
  let generation = 0, destroyed = false, visible = false, pending = true;
  let diagram: Diagram | undefined;
  expand.onclick = () => { if (diagram) showDiagramViewer(diagram, expand); };
  function state(kind: string, message: string) { dom.dataset.state = kind; status.textContent = message; }
  state('waiting', '표시 대기');
  async function render() {
    if (!visible || destroyed || !pending) return;
    pending = false; const version = ++generation; const text = node.textContent;
    const current = () => !destroyed && version === generation;
    diagram = undefined; expand.disabled = true; fallback.hidden = true;
    state('rendering', '렌더링 중…');
    try {
      const result = await renderDiagram(text, diagramTheme(), current);
      if (!current()) return;
      diagram = result; shadow.replaceChildren(diagramSvg(result));
      expand.disabled = false; state('ready', '');
    } catch (error) {
      if (!current() || (error instanceof DiagramError && error.kind === 'cancelled')) return;
      shadow.replaceChildren(); fallback.textContent = text; fallback.hidden = false;
      state(error instanceof DiagramError ? error.kind : 'error', diagramMessage(error));
    }
  }
  const observer = new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting; if (visible) void render();
  }, { rootMargin: '400px' }); observer.observe(dom);
  const invalidate = () => { generation++; pending = true; dismissDiagramViewer(); void render(); };
  diagramEvents.addEventListener('theme', invalidate);
  diagramEvents.addEventListener('reset', invalidate);
  dom.addEventListener('mousedown', event => {
    if ((event.target as Element).closest('button')) { event.preventDefault(); return; }
    const pos = getPos(); if (pos === undefined) return;
    event.preventDefault(); view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos))); view.focus();
  });
  return {
    dom,
    update(next) {
      if (next.type !== node.type || !isMermaid(next)) return false;
      const changed = next.textContent !== node.textContent; node = next;
      if (changed) invalidate(); return true;
    },
    selectNode() { dom.classList.add('ProseMirror-selectednode'); },
    deselectNode() { dom.classList.remove('ProseMirror-selectednode'); },
    stopEvent(event) { return event.type !== 'keydown' && event.type !== 'keyup'; },
    ignoreMutation: () => true,
    destroy() {
      destroyed = true; generation++; observer.disconnect();
      diagramEvents.removeEventListener('theme', invalidate); diagramEvents.removeEventListener('reset', invalidate);
    },
  };
}
