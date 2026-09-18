import { Editor, rootCtx, defaultValueCtx, editorViewCtx, editorViewOptionsCtx } from '@milkdown/kit/core';
import { commonmark, toggleStrongCommand, toggleEmphasisCommand, wrapInBulletListCommand, wrapInBlockquoteCommand, createCodeBlockCommand } from '@milkdown/kit/preset/commonmark';
import { gfm, toggleStrikethroughCommand, insertTableCommand } from '@milkdown/kit/preset/gfm';
import { $prose, callCommand, getMarkdown, replaceAll, insert } from '@milkdown/kit/utils';
import { AllSelection, Plugin, TextSelection, type Selection, type Command } from '@milkdown/kit/prose/state';
import { Fragment, Slice, type Node as ProseNode } from '@milkdown/kit/prose/model';
import type { EditorView as ProseEditorView } from '@milkdown/kit/prose/view';
import { columnResizing, columnResizingPluginKey, CellSelection, goToNextCell } from '@milkdown/kit/prose/tables';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { search, searchKeymap, openSearchPanel } from '@codemirror/search';
import { analyze, codeBlocks, DocumentModel, type Heading } from './document';
import { codeBlockView } from './mermaid-node-view';
import { refreshDiagrams } from './mermaid-renderer';
import { dismissDiagramViewer } from './mermaid-viewer';
import { welcome } from './welcome';
import { frontmatter, preserveSyntax, rawInline, rawBlock } from './preserved-markdown';
import { configureLayout, layoutConstraints } from './layout-schema';
import { imageNodeView } from './image-node-view';
import './style.css';
import './layout.css';
import './mermaid.css';
import { renderedHeadingStatus, sourceHeadingStatus, sourceHeadingChanges, sourceTableInsertionAllowed, setHeading } from './heading-commands';
import { tableContext, tableCommand, nextTableCell, emptyTableMarkdown, validTableSize, type TableAction } from './table-commands';
import { FormatToolbar } from './format-toolbar';
import { tableClipboard, serializeTableSelection } from './table-clipboard';
import { sourceTaskStatus, sourceTaskChanges, renderedTaskStatus, toggleTaskList, splitTaskItem } from './task-commands';
import { removeCodeBlocks, selectedCodeBlocks, sourceCodeBlocks, sourceCodeRemoval } from './code-commands';
import { installImageClipboard } from './image-clipboard';
import { RenderedSearch, renderedSearchPlugin } from './rendered-search';

type HostPacket = { type: string; [key: string]: any };
type WebViewBridge = { postMessage(data: unknown): void; addEventListener(type: string, cb: (event: MessageEvent<HostPacket>) => void): void };
declare global { interface Window { chrome?: { webview?: WebViewBridge }; folio: { receive(packet: HostPacket): Promise<void>; snapshot(): object } } }
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const bridge = window.chrome?.webview;
document.documentElement.dataset.host = bridge ? 'windows' : 'browser';
const model = new DocumentModel();
let documentId = 'welcome';
let mode: 'rendered' | 'source' = 'rendered';
let editor: Editor;
let renderedSearch: RenderedSearch | undefined;
type FormatTarget = { documentId: string; mode: 'source' | 'rendered'; text: string; from: number; to: number; doc?: ProseNode; selection?: Selection };
let pendingImage: { requestId: string; target: FormatTarget } | null = null;
let formatToolbar: FormatToolbar<FormatTarget> | undefined;
let baseline: ProseNode | null = null;
let syncing = false;
let composing = false;
let headings: Heading[] = [];
let updateTimer: ReturnType<typeof setTimeout>;
let lastHeadingId: string | null = null;
let cachedRevision = -1;
let cachedAnalysis: ReturnType<typeof analyze>;
function analysis() { if (cachedRevision !== model.revision) { cachedAnalysis = analyze(model.text); cachedRevision = model.revision; } return cachedAnalysis; }
const send = (packet: HostPacket) => bridge?.postMessage({ ...packet, documentId });
const snapshot = () => ({ text: model.text, revision: model.revision, dirty: model.dirty, documentId, images: analysis().images });

const source = new EditorView({
  parent: $('source-editor'),
  state: EditorState.create({ extensions: [
    lineNumbers(), highlightActiveLine(), drawSelection(), markdown(), syntaxHighlighting(defaultHighlightStyle), search(),
    keymap.of([...defaultKeymap, indentWithTab, ...searchKeymap]), EditorView.lineWrapping,
    EditorView.contentAttributes.of({ 'aria-label': 'Markdown 원문', spellcheck: 'false' }),
    EditorView.updateListener.of(update => {
      if (syncing) return;
      if (update.docChanged) { model.change(update.state.doc.toString(), 'source', update.state.selection.main.head); schedulePublish(); }
      if (update.selectionSet) { model.cursor = update.state.selection.main.head; selectHeading(model.cursor); }
      formatToolbar?.update(); updateCommandButtons();
    }),
  ] }),
});

function schedulePublish() { clearTimeout(updateTimer); updateChrome(); updateTimer = setTimeout(publish, 140); }
function updateChrome() {
  $('dirty-dot').classList.toggle('visible', model.dirty);
  ($('undo') as HTMLButtonElement).disabled = !model.canUndo;
  ($('redo') as HTMLButtonElement).disabled = !model.canRedo;
  $('stats').textContent = `${model.text.length.toLocaleString()}자 · ${model.text.split('\n').length.toLocaleString()}줄`;
  formatToolbar?.update();
  updateCommandButtons();
}
function publish() {
  ({ headings } = analysis());
  updateChrome();
  send({ type: 'changed', ...snapshot(), headings });
  selectHeading(model.cursor);
}
function selectHeading(position: number) {
  const current = headings.findLast(h => h.from <= position);
  $('breadcrumb').textContent = current?.label ?? '문서';
  if (lastHeadingId !== (current?.id ?? null)) {
    lastHeadingId = current?.id ?? null; send({ type: 'cursor', headingId: lastHeadingId });
  }
}
function renderedCursor() {
  const view = editor.action(ctx => ctx.get(editorViewCtx));
  let index = -1;
  view.state.doc.forEach((node, offset) => { if (node.type.name === 'heading' && offset <= view.state.selection.from) index++; });
  return headings[index]?.from ?? 0;
}
function flushRendered() {
  if (!editor || syncing || mode !== 'rendered' || composing) return;
  const doc = editor.action(ctx => ctx.get(editorViewCtx).state.doc);
  if (baseline?.eq(doc)) return;
  const text = editor.action(getMarkdown());
  model.change(text, 'rendered', renderedCursor()); baseline = doc; schedulePublish();
}
function refreshRendered() {
  syncing = true;
  try {
    editor.action(replaceAll(model.text));
    baseline = editor.action(ctx => ctx.get(editorViewCtx).state.doc);
  } finally { syncing = false; }
  $('notice').hidden = true;
  formatToolbar?.update(); updateCommandButtons();
}
function refreshSource() {
  syncing = true;
  source.dispatch({ changes: { from: 0, to: source.state.doc.length, insert: model.text }, selection: { anchor: Math.min(model.cursor, model.text.length) } });
  syncing = false;
  updateCommandButtons();
}
async function settleComposition() {
  if (!composing) return;
  (document.activeElement as HTMLElement | null)?.blur();
  await new Promise<void>(resolve => {
    if (!composing) return resolve();
    document.addEventListener('compositionend', () => setTimeout(resolve, 0), { once: true });
  });
}
async function switchMode(next: typeof mode) {
  if (mode === next) return;
  renderedSearch?.close(false);
  formatToolbar?.close();
  await settleComposition(); flushRendered(); model.breakGroup();
  dismissDiagramViewer();
  if (mode === 'rendered') model.cursor = renderedCursor();
  mode = next;
  $('rendered-editor').hidden = mode !== 'rendered'; $('source-editor').hidden = mode !== 'source';
  $('rendered-mode').setAttribute('aria-selected', String(mode === 'rendered'));
  $('source-mode').setAttribute('aria-selected', String(mode === 'source'));
  $('mode-hint').textContent = mode === 'source' ? 'Markdown 문법으로 정교하게' : '문서 위에서 바로 편집하세요';
  if (mode === 'source') { refreshSource(); source.focus(); source.dispatch({ effects: EditorView.scrollIntoView(model.cursor, { y: 'center' }) }); $('notice').hidden = true; }
  else { refreshRendered(); focusRenderedAt(model.cursor); }
  formatToolbar?.update();
  publish();
}
async function editDiagram(pos: number) {
  await settleComposition(); flushRendered();
  const view = editor.action(ctx => ctx.get(editorViewCtx));
  let ordinal = -1, targetIndex = -1;
  view.state.doc.descendants((node, offset) => {
    if (node.type.name === 'code_block') { ordinal++; if (offset === pos) targetIndex = ordinal; }
  });
  const block = codeBlocks(model.text)[targetIndex];
  const target = view.state.doc.nodeAt(pos);
  const from = block && block.value === target?.textContent ? block.bodyFrom : undefined;
  await switchMode('source');
  if (from === undefined) { toast('블록 위치를 찾지 못했습니다. 원문에서 확인해주세요.'); return; }
  model.cursor = from;
  source.dispatch({ selection: { anchor: from }, effects: EditorView.scrollIntoView(from, { y: 'center' }) }); source.focus();
}
function focusRenderedAt(from: number) {
  const index = headings.findLastIndex(h => h.from <= from);
  editor.action(ctx => {
    const view = ctx.get(editorViewCtx); let count = -1; let target = 0;
    view.state.doc.forEach((node, pos) => { if (node.type.name === 'heading' && ++count === index) target = pos + 1; });
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(Math.min(target, view.state.doc.content.size)))).scrollIntoView());
    view.focus();
  });
}
async function jump(id: string) {
  await settleComposition(); flushRendered();
  const h = headings.find(h => h.id === id); if (!h) return;
  model.cursor = h.from;
  if (mode === 'source') { source.dispatch({ selection: { anchor: h.from }, effects: EditorView.scrollIntoView(h.from, { y: 'start', yMargin: 32 }) }); source.focus(); }
  else focusRenderedAt(h.from);
  selectHeading(h.from);
}
async function history(redo = false) {
  formatToolbar?.close();
  await settleComposition(); flushRendered();
  if (!(redo ? model.redo() : model.undo())) return;
  publish();
  if (mode === 'source') { refreshSource(); source.focus(); }
  else { refreshRendered(); focusRenderedAt(model.cursor); }
}
function insertSource(before: string, after = '') {
  const range = source.state.selection.main; const text = source.state.sliceDoc(range.from, range.to) || '텍스트';
  source.dispatch({ changes: { from: range.from, to: range.to, insert: before + text + after }, selection: { anchor: range.from + before.length, head: range.from + before.length + text.length } }); source.focus();
}
async function command(name: string) {
  if (name === 'table') { await formatToolbar?.open('insert', document.querySelector<HTMLElement>('[data-command="table"]')!); return; }
  await settleComposition();
  if (name === 'image') {
    const requestId = await beginImageRequest();
    if (requestId) send({ type: 'command', name: 'image', requestId });
    return;
  }
  if (name === 'code') { await toggleCode(); return; }
  if (name === 'task') { await toggleTasks(); return; }
  if (mode === 'source') {
    const pairs: Record<string, [string, string]> = { bold: ['**','**'], italic: ['*','*'], strike: ['~~','~~'], bullet: ['- ', ''], quote: ['> ', ''] };
    if (pairs[name]) { insertSource(...pairs[name]); return; }
  }
  if (name === 'link') { ($('link-dialog') as HTMLDialogElement).showModal(); return; }
  editor.action(ctx => ctx.get(editorViewCtx).focus());
  switch (name) {
    case 'bold': editor.action(callCommand(toggleStrongCommand.key)); break;
    case 'italic': editor.action(callCommand(toggleEmphasisCommand.key)); break;
    case 'strike': editor.action(callCommand(toggleStrikethroughCommand.key)); break;
    case 'bullet': editor.action(callCommand(wrapInBulletListCommand.key)); break;
    case 'quote': editor.action(callCommand(wrapInBlockquoteCommand.key)); break;
  }
  flushRendered();
}
function toast(message: string) { $('toast').textContent = message; $('toast').hidden = false; setTimeout(() => $('toast').hidden = true, 3200); }

function updateCommandButtons() {
  if (!editor) return;
  const range = source.state.selection.main;
  const active = mode === 'source' ? sourceCodeBlocks(model.text, range.from, range.to).length > 0 : editor.action(ctx => selectedCodeBlocks(ctx.get(editorViewCtx).state).length > 0);
  const button = document.querySelector<HTMLButtonElement>('[data-command="code"]')!;
  button.setAttribute('aria-pressed', String(active));
  button.title = active ? '코드 블록 해제 (Ctrl+Alt+C)' : '코드 블록 (Ctrl+Alt+C)';
  button.setAttribute('aria-label', button.title);
  const taskStatus = mode === 'source' ? sourceTaskStatus(model.text, range.from, range.to) : editor.action(ctx => renderedTaskStatus(ctx.get(editorViewCtx).state));
  const taskButton = document.querySelector<HTMLButtonElement>('[data-command="task"]')!;
  taskButton.disabled = !taskStatus.enabled;
  taskButton.setAttribute('aria-pressed', String(taskStatus.active));
  taskButton.title = taskStatus.reason || (taskStatus.active ? '체크리스트 해제' : '체크리스트');
}
async function toggleTasks() {
  await prepareFormat(); model.breakGroup();
  if (mode === 'source') {
    const range = source.state.selection.main;
    const changes = sourceTaskChanges(model.text, range.from, range.to);
    if (changes.length) {
      const changeSet = source.state.changes(changes);
      source.dispatch({ changes: changeSet, selection: { anchor: changeSet.mapPos(range.from, 1), head: changeSet.mapPos(range.to, 1) } });
    }
  } else editor.action(ctx => {
    const view = ctx.get(editorViewCtx); syncRenderedTextSelection(view);
    toggleTaskList(view.state, view.dispatch, view);
  });
  flushRendered(); model.breakGroup(); publish(); focusFormat();
}
async function toggleCode() {
  await prepareFormat(); model.breakGroup();
  if (mode === 'source') {
    const range = source.state.selection.main;
    const changes = sourceCodeRemoval(model.text, range.from, range.to);
    if (changes.length) {
      const changeSet = source.state.changes(changes);
      source.dispatch({ changes: changeSet, selection: { anchor: changeSet.mapPos(range.from, 1), head: changeSet.mapPos(range.to, 1) } });
    } else {
      const selected = source.state.sliceDoc(range.from, range.to);
      const fence = '`'.repeat(Math.max(3, ...Array.from(selected.matchAll(/`+/g), m => m[0].length + 1)));
      insertSource('\n' + fence + '\n', '\n' + fence + '\n');
    }
  } else editor.action(ctx => {
    const view = ctx.get(editorViewCtx);
    if (!removeCodeBlocks(view.state, view.dispatch)) editor.action(callCommand(createCodeBlockCommand.key));
  });
  flushRendered(); model.breakGroup(); publish(); updateCommandButtons(); focusFormat();
}

async function prepareFormat() { await settleComposition(); flushRendered(); }
function syncRenderedTextSelection(view: ProseEditorView) {
  const selection = window.getSelection();
  if ((view.state.selection instanceof TextSelection || view.state.selection instanceof AllSelection) && selection?.anchorNode && selection.focusNode &&
      view.dom.contains(selection.anchorNode) && view.dom.contains(selection.focusNode)) {
    const anchor = view.posAtDOM(selection.anchorNode, selection.anchorOffset);
    const head = view.posAtDOM(selection.focusNode, selection.focusOffset);
    const next = TextSelection.between(view.state.doc.resolve(anchor), view.state.doc.resolve(head));
    if (!next.eq(view.state.selection)) view.dispatch(view.state.tr.setSelection(next));
  }
}
async function beginImageRequest() {
  if (!bridge) { toast('이미지 파일 삽입은 Windows 앱에서 사용할 수 있습니다'); return; }
  if (pendingImage) { toast('이미지 삽입이 끝난 뒤 다시 시도하세요.'); return; }
  await prepareFormat();
  if (mode === 'rendered') editor.action(ctx => syncRenderedTextSelection(ctx.get(editorViewCtx)));
  const state = editor.action(ctx => ctx.get(editorViewCtx).state);
  if (mode === 'rendered' && (state.selection instanceof CellSelection || !state.selection.$from.parent.inlineContent || state.selection.$from.parent.type.spec.code)) {
    toast('이미지를 넣을 본문이나 표 셀 안에 커서를 놓으세요.'); return;
  }
  const requestId = crypto.randomUUID();
  pendingImage = { requestId, target: captureFormat() };
  return requestId;
}
function captureFormat(): FormatTarget {
  const range = source.state.selection.main;
  if (mode === 'source') return { documentId, mode, text: model.text, from: range.from, to: range.to };
  const state = editor.action(ctx => ctx.get(editorViewCtx).state);
  return { documentId, mode, text: model.text, from: state.selection.from, to: state.selection.to, doc: state.doc, selection: state.selection };
}
function restoreFormat(target: FormatTarget) {
  if (target.documentId !== documentId || target.mode !== mode || (mode === 'source' ? model.text !== target.text : editor.action(ctx => ctx.get(editorViewCtx).state.doc) !== target.doc)) {
    toast('문서가 변경되었습니다. 편집할 위치를 다시 선택하세요.'); return false;
  }
  if (mode === 'source') source.dispatch({ selection: { anchor: target.from, head: target.to } });
  else editor.action(ctx => { const view = ctx.get(editorViewCtx); view.dispatch(view.state.tr.setSelection(target.selection!)); });
  return true;
}
function focusFormat() { if (mode === 'source') source.focus(); else editor.action(ctx => ctx.get(editorViewCtx).focus()); }
function formatStatus() {
  const state = editor.action(ctx => ctx.get(editorViewCtx).state);
  const range = source.state.selection.main;
  const heading = mode === 'source' ? sourceHeadingStatus(model.text, range.from, range.to) : renderedHeadingStatus(state);
  return { heading, table: mode === 'rendered' && tableContext(state) ? state : null,
    canInsert: mode === 'source' ? sourceTableInsertionAllowed(model.text, range.from, range.to) : heading.enabled && state.selection.$from.depth >= 1 && state.selection.$from.node(-1).canReplaceWith(state.selection.$from.index(-1), state.selection.$from.indexAfter(-1), state.schema.nodes.table) };
}
async function applyHeading(level: number, target?: FormatTarget) {
  await prepareFormat();
  if (target && !restoreFormat(target)) return;
  model.breakGroup();
  if (mode === 'source') {
    const range = source.state.selection.main;
    const changes = sourceHeadingChanges(model.text, range.from, range.to, level);
    if (changes.length) {
      const changeSet = source.state.changes(changes);
      source.dispatch({ changes: changeSet, selection: { anchor: changeSet.mapPos(range.from, 1), head: changeSet.mapPos(range.to, 1) } });
    }
  } else editor.action(ctx => { const view = ctx.get(editorViewCtx); setHeading(level)(view.state, view.dispatch, view); });
  flushRendered(); model.breakGroup(); publish(); focusFormat();
}
async function applyTable(action: TableAction | Command, target?: FormatTarget) {
  await prepareFormat();
  if (mode !== 'rendered' || (target && !restoreFormat(target))) return;
  model.breakGroup();
  editor.action(ctx => { const view = ctx.get(editorViewCtx); (typeof action === 'string' ? tableCommand(action) : action)(view.state, view.dispatch, view); });
  flushRendered(); model.breakGroup(); publish(); focusFormat();
}
async function copyTable(target: FormatTarget) {
  await prepareFormat();
  if (mode !== 'rendered' || !restoreFormat(target)) return;
  const data = editor.action(ctx => serializeTableSelection(ctx.get(editorViewCtx).state));
  focusFormat();
  if (!data) return;
  if (data.text.length + data.html.length > 10_000_000) { toast('복사할 표의 크기는 최대 10MB입니다. 범위를 줄여주세요.'); return; }
  if (bridge) { send({ type: 'copyTable', ...data }); return; }
  try {
    await navigator.clipboard.write([new ClipboardItem({
      'text/plain': new Blob([data.text], { type: 'text/plain' }),
      'text/html': new Blob([data.html], { type: 'text/html' }),
    })]);
    toast('선택한 셀을 복사했습니다');
  } catch { toast('클립보드를 사용할 수 없습니다. 잠시 후 다시 복사하세요.'); }
}
async function insertSizedTable(rows: number, cols: number, target: FormatTarget) {
  await prepareFormat();
  if (!validTableSize(rows, cols) || !restoreFormat(target) || !formatStatus().canInsert) return;
  model.breakGroup();
  if (mode === 'source') {
    const { from, to } = source.state.selection.main;
    const before = from && !model.text.slice(0, from).endsWith('\n\n') ? (model.text[from - 1] === '\n' ? '\n' : '\n\n') : '';
    const after = model.text.slice(to).startsWith('\n\n') ? '' : model.text[to] === '\n' ? '\n' : '\n\n';
    source.dispatch({ changes: { from, to, insert: before + emptyTableMarkdown(rows, cols) + after }, selection: { anchor: from + before.length + 2 } });
  } else editor.action(callCommand(insertTableCommand.key, { row: rows, col: cols }));
  flushRendered(); model.breakGroup(); publish(); focusFormat();
}

const syncPlugin = $prose(() => new Plugin({
  props: {
    handleKeyDown(view, event) {
      if (!event.isComposing && !composing && event.key === 'F10' && event.shiftKey) {
        // A click's selectionchange can arrive after the key event. Read the caret
        // before menu focus leaves the editor, preserving explicit cell ranges.
        syncRenderedTextSelection(view);
        if (tableContext(view.state)) { event.preventDefault(); void formatToolbar?.open('context'); return true; }
      }
      return false;
    },
    nodeViews: {
    code_block(node, view, getPos) { return codeBlockView(node, view, getPos, editDiagram); },
    image: (node, view, getPos) => imageNodeView(node, view, getPos, () => documentId, change => {
      flushRendered(); model.breakGroup(); change(); flushRendered(); model.breakGroup();
    }),
    list_item(node, view, getPos) {
    const li = document.createElement('li');
    if (node.attrs.checked == null) return { dom: li, contentDOM: li };
    li.dataset.itemType = 'task'; li.dataset.checked = String(node.attrs.checked);
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = node.attrs.checked;
    checkbox.contentEditable = 'false'; checkbox.setAttribute('aria-label', '할 일 완료');
    const body = document.createElement('div'); li.append(checkbox, body);
    checkbox.addEventListener('change', () => {
      const pos = getPos(); if (pos === undefined) return;
      const current = view.state.doc.nodeAt(pos); if (!current) return;
      view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, checked: checkbox.checked }));
    });
    return { dom: li, contentDOM: body,
      update(next) { if (next.type !== node.type || next.attrs.checked == null) return false; node = next; checkbox.checked = next.attrs.checked; li.dataset.checked = String(next.attrs.checked); return true; },
      stopEvent(event) { return event.target === checkbox; },
      ignoreMutation(mutation) { return mutation.type !== 'selection' && (mutation.target === checkbox || mutation.target === li); },
    };
  } } },
  view: () => ({ update(view, previous) {
    if (syncing) return;
    const wasDragging = !!columnResizingPluginKey.getState(previous)?.dragging;
    const isDragging = !!columnResizingPluginKey.getState(view.state)?.dragging;
    if (isDragging && !wasDragging) { flushRendered(); model.breakGroup(); }
    if (wasDragging && !isDragging) { flushRendered(); model.breakGroup(); }
    if (!view.state.doc.eq(previous.doc)) queueMicrotask(flushRendered);
    if (!view.state.selection.eq(previous.selection)) { model.cursor = renderedCursor(); selectHeading(model.cursor); }
    formatToolbar?.update(); updateCommandButtons();
  } }),
}));

async function receive(packet: HostPacket) {
  switch (packet.type) {
    case 'load':
      pendingImage = null;
      renderedSearch?.close(false, true);
      formatToolbar?.close();
      await settleComposition();
      dismissDiagramViewer(); refreshDiagrams(true);
      documentId = packet.documentId; model.load(packet.text, packet.dirty); $('document-name').textContent = packet.name;
      lastHeadingId = null; publish(); refreshSource(); refreshRendered(); $('editor-scroll').scrollTop = 0; break;
    case 'saved':
      if (packet.documentId !== documentId) return;
      model.markSaved(packet.text); $('document-name').textContent = packet.name; publish(); toast('문서를 저장했습니다'); break;
    case 'snapshot':
      await settleComposition(); flushRendered(); publish(); send({ type: 'snapshot', requestId: packet.requestId, ...snapshot() }); break;
    case 'jump': await jump(packet.id); break;
    case 'theme': document.documentElement.dataset.theme = packet.value; refreshDiagrams(); break;
    case 'configuration': {
      const ratio = typeof packet.bodyLineHeight === 'number' && Number.isFinite(packet.bodyLineHeight) ? Math.max(1, Math.min(3, packet.bodyLineHeight)) : 1.95;
      document.documentElement.style.setProperty('--body-line-height', String(ratio));
      document.documentElement.dataset.documentAlignment = packet.documentAlignment === 'left' ? 'left' : 'center';
      break;
    }
    case 'toggleMode': await switchMode(mode === 'rendered' ? 'source' : 'rendered'); break;
    case 'undo': await history(); break;
    case 'redo': await history(true); break;
    case 'find':
      formatToolbar?.close();
      await settleComposition(); flushRendered();
      if (mode === 'source') openSearchPanel(source); else renderedSearch?.open();
      break;
    case 'toast': toast(packet.message); break;
    case 'requestImage': await command('image'); break;
    case 'insertImages': {
      if (!pendingImage || packet.requestId !== pendingImage.requestId || packet.documentId !== documentId) return;
      const target = pendingImage.target; pendingImage = null;
      if (packet.error) { toast(packet.error); break; }
      const paths = packet.paths as unknown;
      if (!Array.isArray(paths) || !paths.length || paths.length > 16 || !paths.every(path => typeof path === 'string' && /^assets\/[a-zA-Z0-9_-]+\.(png|jpe?g|gif|webp|bmp)$/.test(path))) break;
      await prepareFormat();
      if (!restoreFormat(target)) break;
      model.breakGroup();
      if (mode === 'source') {
        const range = source.state.selection.main;
        const text = paths.map(path => `![이미지](${path})`).join('\n');
        source.dispatch({ changes: { from: range.from, to: range.to, insert: text }, selection: { anchor: range.from + text.length } });
      } else editor.action(ctx => {
        const view = ctx.get(editorViewCtx);
        const images = paths.map(src => view.state.schema.nodes.image.create({ src, alt: '이미지' }));
        view.dispatch(view.state.tr.replaceSelection(new Slice(Fragment.fromArray(images), 0, 0)).scrollIntoView());
      });
      flushRendered(); model.breakGroup(); publish(); focusFormat();
      break;
    }
    case 'renameHeading': {
      await settleComposition(); flushRendered(); publish();
      const h = headings.find(h => h.id === packet.id); if (!h) return;
      const title = String(packet.title).replace(/[\r\n]/g, ' ').replace(/([\\`*_{}\[\]<>])/g, '\\$1');
      model.breakGroup(); model.change(model.text.slice(0, h.from) + '#'.repeat(h.depth) + ' ' + title + model.text.slice(h.to), 'tree', h.from);
      publish(); refreshSource(); refreshRendered(); break;
    }
  }
}

async function start() {
  model.load(welcome);
  editor = await Editor.make().config(ctx => {
    configureLayout(ctx);
    ctx.set(rootCtx, $('rendered-editor')); ctx.set(defaultValueCtx, model.text);
    ctx.update(editorViewOptionsCtx, options => ({ ...options, editable: () => true, attributes: { 'aria-label': 'Markdown 렌더링 편집', spellcheck: 'false' } }));
  }).use([...frontmatter, ...preserveSyntax]).use(commonmark).use($prose(() => tableClipboard((view, tr) => {
    flushRendered(); model.breakGroup(); view.dispatch(tr); flushRendered(); model.breakGroup(); publish();
  }, toast))).use($prose(() => columnResizing({ cellMinWidth: 40, defaultCellMinWidth: 100, handleWidth: 7 }))).use(gfm).use([...rawInline, ...rawBlock]).use(layoutConstraints).use($prose(() => renderedSearchPlugin(() => renderedSearch?.update()))).use(syncPlugin).create();
  renderedSearch = new RenderedSearch(() => editor.action(ctx => ctx.get(editorViewCtx)));
  baseline = editor.action(ctx => ctx.get(editorViewCtx).state.doc); refreshSource(); publish();
  formatToolbar = new FormatToolbar<FormatTarget>({ prepare: prepareFormat, capture: captureFormat, status: formatStatus, focus: focusFormat,
    heading: applyHeading, table: applyTable, copy: copyTable, insert: insertSizedTable,
    tableCellElement: () => editor.action(ctx => {
      const view = ctx.get(editorViewCtx), c = tableContext(view.state);
      return c ? view.nodeDOM(c.tableStart + c.map.map[c.top * c.map.width + c.left]) as HTMLElement : null;
    }),
  });
  formatToolbar.update();
  bridge?.addEventListener('message', event => { void receive(event.data).catch(error => { console.error(error); toast('요청을 처리하지 못했습니다. 원문을 확인해주세요.'); }); });
  window.folio = { receive, snapshot: () => { flushRendered(); return snapshot(); } };
  send({ type: 'ready' });
}

document.addEventListener('compositionstart', () => composing = true);
installImageClipboard({ begin: beginImageRequest,
  send: (requestId, images) => { if (pendingImage?.requestId === requestId) send({ type: 'importImages', requestId, images }); },
  cancel: requestId => { if (pendingImage?.requestId === requestId) pendingImage = null; }, notify: toast,
});
document.addEventListener('compositionend', () => { composing = false; setTimeout(flushRendered, 0); });
$('rendered-mode').onclick = () => void switchMode('rendered');
$('source-mode').onclick = () => void switchMode('source');
$('undo').onclick = () => void history(); $('redo').onclick = () => void history(true);
$('find').onclick = () => void receive({ type: 'find' });
document.querySelectorAll<HTMLButtonElement>('[data-command]').forEach(b => { b.onmousedown = e => e.preventDefault(); b.onclick = () => void command(b.dataset.command!); });
$('link-dialog').addEventListener('close', () => {
  const dialog = $('link-dialog') as HTMLDialogElement; if (dialog.returnValue !== 'insert') return;
  const form = dialog.querySelector('form')!; const data = new FormData(form);
  const url = String(data.get('url')); if (!/^https?:\/\//i.test(url)) { toast('http 또는 https 주소를 입력해주세요'); return; }
  const label = String(data.get('label')).replace(/[\[\]\\]/g, '\\$&');
  if (mode === 'source') {
    const range = source.state.selection.main; source.dispatch({ changes: { from: range.from, to: range.to, insert: `[${label}](${url.replace(/[()]/g, c => encodeURIComponent(c) === c ? `%${c.charCodeAt(0).toString(16)}` : encodeURIComponent(c))})` } }); source.focus();
  } else { editor.action(insert(`[${label}](<${url.replace(/[<>\n]/g, '')}>)`, true)); flushRendered(); }
});
document.addEventListener('click', e => {
  const link = (e.target as HTMLElement).closest('a');
  if (link) { e.preventDefault(); if (e.ctrlKey) send({ type: 'command', name: 'externalLink', url: link.href }); }
});
document.addEventListener('keydown', e => {
  if (e.target instanceof Element && e.target.closest('.mermaid-viewer')) return;
  if (e.isComposing || composing) return;
  if (mode === 'rendered' && renderedSearch?.handleKeydown(e)) return;
  if (e.target instanceof Element && e.target.closest('#rendered-search') && e.key.toLowerCase() !== 'f') return;
  const inEditor = e.target instanceof Element && !!e.target.closest('.ProseMirror, .cm-editor');
  if (inEditor && mode === 'rendered') {
    const view = editor.action(ctx => ctx.get(editorViewCtx));
    if (e.key === 'Enter') syncRenderedTextSelection(view);
    const state = view.state;
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && splitTaskItem(state)) {
      e.preventDefault(); e.stopImmediatePropagation();
      flushRendered(); model.breakGroup();
      editor.action(ctx => { const view = ctx.get(editorViewCtx); splitTaskItem(view.state, view.dispatch, view); });
      flushRendered(); model.breakGroup(); publish(); return;
    }
    const c = tableContext(state);
    if (c && e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.shiftKey && !goToNextCell(-1)(state)) $('heading-picker').focus();
      else void applyTable(e.shiftKey ? goToNextCell(-1) : nextTableCell);
      return;
    }
    if (c && state.selection instanceof CellSelection && ['Delete', 'Backspace'].includes(e.key)) {
      e.preventDefault(); e.stopImmediatePropagation(); void applyTable('clear'); return;
    }
  }
  if (!(e.ctrlKey || e.metaKey)) return;
  if (inEditor && e.altKey && /^[0-6]$/.test(e.key)) { e.preventDefault(); e.stopImmediatePropagation(); void applyHeading(Number(e.key)); return; }
  if (e.target instanceof Element && e.target.closest('.format-popover')) return;
  const key = e.key.toLowerCase();
  if (inEditor && e.altKey && key === 'c') { e.preventDefault(); e.stopImmediatePropagation(); void command('code'); return; }
  const native: Record<string, string> = { s: e.shiftKey ? 'saveAs' : 'save', o: e.shiftKey ? 'recent' : 'open', n: 'new' };
  if (native[key]) { e.preventDefault(); e.stopImmediatePropagation(); send({ type: 'command', name: native[key] }); if (!bridge) toast('파일 열기·저장은 Windows 앱에서 사용할 수 있습니다'); }
  else if (key === 'z' || key === 'y') { e.preventDefault(); e.stopImmediatePropagation(); void history(key === 'y' || e.shiftKey); }
  else if (key === 'm' && e.shiftKey) { e.preventDefault(); void switchMode(mode === 'source' ? 'rendered' : 'source'); }
  else if (key === 'f') { e.preventDefault(); e.stopImmediatePropagation(); void receive({ type: 'find' }); }
  else if (['b', 'i'].includes(key)) { e.preventDefault(); e.stopImmediatePropagation(); void command(key === 'b' ? 'bold' : 'italic'); }
}, true);
function selectContextCell(event: MouseEvent) {
  if (mode !== 'rendered' || !(event.target instanceof Element)) return false;
  const cell = event.target.closest('td, th');
  if (!cell || !cell.closest('.ProseMirror')) return false;
  return editor.action(ctx => {
    const view = ctx.get(editorViewCtx), pos = view.posAtDOM(cell, 0), $pos = view.state.doc.resolve(pos);
    let cellPos = pos;
    for (let d = $pos.depth; d > 0; d--) if (['cell', 'header_cell'].includes($pos.node(d).type.spec.tableRole ?? '')) { cellPos = $pos.before(d); break; }
    let selected = false;
    if (view.state.selection instanceof CellSelection) view.state.selection.forEachCell((_node, p) => { if (p === cellPos) selected = true; });
    if (!selected) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(cellPos + 2))));
    return true;
  });
}
document.addEventListener('mousedown', e => {
  if (e.button === 2 && selectContextCell(e)) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);
document.addEventListener('contextmenu', e => {
  if (selectContextCell(e)) { e.preventDefault(); void formatToolbar?.open('context', undefined, { x: e.clientX, y: e.clientY }); }
});
void start().catch(error => { console.error(error); $('notice').hidden = false; $('notice').textContent = `편집기 초기화 실패: ${error.message}`; });
