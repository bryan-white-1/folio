import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import { AllSelection, TextSelection, type EditorState, type Command } from '@milkdown/kit/prose/state';
import { wrapRangeInList, splitListItem } from '@milkdown/kit/prose/schema-list';
import type { Node } from '@milkdown/kit/prose/model';

export interface TaskStatus { enabled: boolean; active: boolean; reason: string }
const reason = '일반 문단·목록을 선택하세요. 표·제목·코드·보존 구간은 변환할 수 없습니다.';
const status = (enabled: boolean, active: boolean): TaskStatus => ({ enabled, active, reason: enabled ? '' : reason });
type Ast = { type: string; children?: Ast[]; position?: { start: { offset: number }; end: { offset: number } } };
type SourceTarget = { from: number; to: number; active: boolean; list: boolean };
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ['yaml', 'toml']);
let cachedText: string | undefined, cachedAst: Ast;

function sourceTargets(text: string, from: number, to: number) {
  if (cachedText !== text) { cachedText = text; cachedAst = parser.parse(text) as unknown as Ast; }
  const lineStart = (pos: number) => text.lastIndexOf('\n', pos - 1) + 1;
  const start = lineStart(from), last = lineStart(to > from ? to - 1 : to);
  const end = text.indexOf('\n', last);
  const limit = end < 0 ? text.length : end;
  const targets = new Map<number, SourceTarget>();
  let blocked = false;
  const overlaps = (node: Ast) => !!node.position && node.position.start.offset <= limit && node.position.end.offset >= start;
  function visit(node: Ast, item?: Ast) {
    if (node.type !== 'root' && !overlaps(node)) return;
    if (['root', 'blockquote', 'list', 'listItem'].includes(node.type)) {
      node.children?.forEach(child => visit(child, node.type === 'listItem' ? node : item)); return;
    }
    if (node.type !== 'paragraph') { blocked = true; return; }
    if (item) {
      const pos = item.position!.start.offset;
      const marker = /^(?:[-+*]|\d+[.)])[ \t]+(?:\[([ xX])\](?:[ \t]+|$))?/.exec(text.slice(pos, text.indexOf('\n', pos) < 0 ? text.length : text.indexOf('\n', pos)));
      if (!marker) { blocked = true; return; }
      const prefix = /^(?:[-+*]|\d+[.)])[ \t]+/.exec(marker[0])![0];
      targets.set(pos, { from: pos + prefix.length, to: pos + marker[0].length, active: marker[1] !== undefined, list: true });
      return;
    }
    const nodeStart = node.position!.start.offset, nodeEnd = node.position!.end.offset;
    for (let line = lineStart(nodeStart); line <= last && line < nodeEnd;) {
      const next = text.indexOf('\n', line), lineEnd = next < 0 ? text.length : next;
      if (line >= start) {
        const prefix = /^(?:[ \t]*>[ \t]?)*[ \t]*/.exec(text.slice(line, lineEnd))![0];
        const pos = line === lineStart(nodeStart) ? nodeStart : line + prefix.length;
        if (text.slice(pos, lineEnd).trim()) targets.set(pos, { from: pos, to: pos, active: false, list: false });
      }
      if (next < 0) break;
      line = next + 1;
    }
  }
  visit(cachedAst);
  if (!blocked && !targets.size && from === to && !text.slice(start, limit).trim()) {
    targets.set(from, { from, to: from, active: false, list: false });
  }
  return { targets: [...targets.values()].sort((a, b) => a.from - b.from), blocked };
}

export function sourceTaskStatus(text: string, from: number, to: number): TaskStatus {
  const { targets, blocked } = sourceTargets(text, from, to);
  return status(!blocked && !!targets.length, !!targets.length && targets.every(t => t.active));
}
export function sourceTaskChanges(text: string, from: number, to: number) {
  const { targets, blocked } = sourceTargets(text, from, to);
  if (blocked || !targets.length) return [];
  const remove = targets.every(t => t.active);
  return targets.filter(t => remove || !t.active).map(t => ({ from: t.from, to: t.to, insert: remove ? '' : t.list ? '[ ] ' : '- [ ] ' }));
}

function renderedTargets(state: EditorState) {
  const targets: { pos: number; node: Node; item: number | null; parent: Node }[] = [];
  let blocked = !(state.selection instanceof TextSelection || state.selection instanceof AllSelection);
  const { from, to } = state.selection;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.spec.tableRole || node.type.name === 'folio_raw_block') { blocked = true; return false; }
    if (!node.isTextblock) return;
    if (node.type.name !== 'paragraph') { blocked = true; return false; }
    const $pos = state.doc.resolve(pos + 1);
    let item: number | null = null;
    for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type.name === 'list_item') { item = $pos.before(d); break; }
    targets.push({ pos, node, item, parent: state.doc.resolve(pos).parent });
    return false;
  });
  return { targets, blocked };
}
export function renderedTaskStatus(state: EditorState): TaskStatus {
  const { targets, blocked } = renderedTargets(state);
  return status(!blocked && !!targets.length, !!targets.length && targets.every(t => t.item !== null && state.doc.nodeAt(t.item)!.attrs.checked != null));
}
export const toggleTaskList: Command = (state, dispatch) => {
  const { targets, blocked } = renderedTargets(state);
  if (blocked || !targets.length) return false;
  const remove = renderedTaskStatus(state).active;
  const tr = state.tr;
  const groups: typeof targets[] = [];
  for (const target of targets.filter(t => t.item === null)) {
    const group = groups.at(-1), previous = group?.at(-1);
    if (previous && previous.parent === target.parent && previous.pos + previous.node.nodeSize === target.pos) group!.push(target);
    else groups.push([target]);
  }
  for (const group of groups.reverse()) {
    const first = group[0], last = group.at(-1)!;
    const $from = tr.doc.resolve(tr.mapping.map(first.pos + 1));
    const $to = tr.doc.resolve(tr.mapping.map(last.pos + last.node.nodeSize - 1));
    const range = $from.blockRange($to);
    if (!range || !wrapRangeInList(tr, range, state.schema.nodes.bullet_list)) return false;
  }
  const items = new Set<number>();
  for (const target of targets) {
    const $pos = tr.doc.resolve(tr.mapping.map(target.pos + 1));
    for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type.name === 'list_item') { items.add($pos.before(d)); break; }
  }
  for (const pos of items) {
    const node = tr.doc.nodeAt(pos)!;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: remove ? null : node.attrs.checked ?? false });
  }
  tr.setSelection(state.selection.map(tr.doc, tr.mapping));
  dispatch?.(tr.scrollIntoView()); return true;
};

export const splitTaskItem: Command = (state, dispatch, view) => {
  const { $from, empty } = state.selection;
  if (!empty || !$from.parent.content.size || $from.depth < 2) return false;
  const item = $from.node(-1);
  if (item.type.name !== 'list_item' || item.attrs.checked == null) return false;
  return splitListItem(item.type, { ...item.attrs, checked: false })(state, dispatch ? tr => {
    const $next = tr.selection.$from;
    const nextItem = $next.node(-1);
    tr.setNodeMarkup($next.before($next.depth - 1), undefined, { ...nextItem.attrs, checked: false });
    dispatch(tr);
  } : undefined, view);
};
