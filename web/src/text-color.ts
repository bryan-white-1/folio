import { $markSchema } from '@milkdown/kit/utils';
import { AllSelection, TextSelection, type Command, type EditorState } from '@milkdown/kit/prose/state';
import { CellSelection } from '@milkdown/kit/prose/tables';
import type { Handle } from 'mdast-util-to-markdown';
import { colorOpen, normalizeColor, type ColorStatus } from './text-color-markdown';

export const textColor = $markSchema('folio_text_color', () => ({
  attrs: { color: { default: null } }, inclusive: false,
  parseDOM: [{ style: 'color', getAttrs: value => { const color = normalizeColor(value); return color ? { color } : false; } }],
  toDOM: mark => ['span', { style: `color:${normalizeColor(mark.attrs.color) ?? 'inherit'}` }, 0],
  parseMarkdown: {
    match: node => node.type === 'folioColor',
    runner: (state, node, type) => { state.openMark(type, { color: node.color }); state.next(node.children); state.closeMark(type); },
  },
  toMarkdown: {
    match: mark => mark.type.name === 'folio_text_color',
    runner: (state, mark) => { state.withMark(mark, 'folioColor', undefined, { color: normalizeColor(mark.attrs.color) }); },
  },
}));
export const colorHandler: Handle = (node, _parent, state, info) => {
  const color = normalizeColor((node as unknown as { color: string }).color);
  const open = color ? colorOpen(color) : '', close = color ? '</span>' : '';
  const tracker = state.createTracker(info); tracker.move(open);
  const body = state.containerPhrasing(node, { ...tracker.current(), before: open || info.before, after: close || info.after });
  return body.split('\n').map(line => line ? open + line + close : '').join('\n');
};
function ranges(state: EditorState) {
  const result: { from: number; to: number; color: string | null }[] = [];
  if (!(state.selection instanceof TextSelection || state.selection instanceof AllSelection || state.selection instanceof CellSelection)) return result;
  for (const { $from, $to } of state.selection.ranges) state.doc.nodesBetween($from.pos, $to.pos, (node, pos, parent) => {
    if (node.type.spec.code || node.type.name === 'folio_raw_block') return false;
    if (!node.isText || parent?.type.spec.code || node.marks.some(mark => mark.type.spec.code)) return;
    result.push({ from: Math.max($from.pos, pos), to: Math.min($to.pos, pos + node.nodeSize), color: node.marks.find(mark => mark.type.name === 'folio_text_color')?.attrs.color ?? null });
  });
  return result.filter(r => r.to > r.from);
}
export function renderedColorStatus(state: EditorState): ColorStatus {
  const selected = ranges(state), colors = new Set(selected.map(r => r.color));
  return { enabled: selected.length > 0, color: selected[0]?.color ?? null, mixed: colors.size > 1 };
}
export const setTextColor = (color: string | null): Command => (state, dispatch) => {
  if (color !== null && !normalizeColor(color)) return false;
  color = normalizeColor(color);
  const selected = ranges(state), type = state.schema.marks.folio_text_color;
  if (!selected.length || !type) return false;
  const tr = state.tr;
  for (const range of selected) if (range.color !== color) {
    tr.removeMark(range.from, range.to, type);
    if (color) tr.addMark(range.from, range.to, type.create({ color }));
  }
  if (tr.docChanged) dispatch?.(tr);
  return true;
};
