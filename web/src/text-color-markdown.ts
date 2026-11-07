import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';

export type ColorAst = { type: string; value?: string; children?: ColorAst[]; color?: string; position?: { start: { offset?: number }; end: { offset?: number } } };
export type ColorStatus = { enabled: boolean; color: string | null; mixed: boolean };
const names: Record<string, string> = { black: '#000000', white: '#FFFFFF', red: '#FF0000', green: '#008000', blue: '#0000FF', yellow: '#FFFF00', orange: '#FFA500', purple: '#800080', gray: '#808080', grey: '#808080', silver: '#C0C0C0', maroon: '#800000', olive: '#808000', lime: '#00FF00', aqua: '#00FFFF', teal: '#008080', navy: '#000080', fuchsia: '#FF00FF' };
export function normalizeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (/^#[\da-f]{6}$/i.test(v)) return v.toUpperCase();
  if (/^#[\da-f]{3}$/i.test(v)) return '#' + [...v.slice(1)].map(c => c + c).join('').toUpperCase();
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(v);
  if (rgb && rgb.slice(1).every(n => Number(n) <= 255)) return '#' + rgb.slice(1).map(n => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
  return Object.hasOwn(names, v.toLowerCase()) ? names[v.toLowerCase()] : null;
}
export const colorOpen = (color: string) => `<span style="color:${color}">`;
function openingColor(value: string) {
  if (value.length > 128) return null;
  const match = /^<span\s+style\s*=\s*(["'])\s*color\s*:\s*([^"';]+)\s*;?\s*\1\s*>$/i.exec(value);
  return match ? normalizeColor(match[2]) : null;
}

// Match only balanced inline spans within the same Markdown parent. Unknown HTML
// remains inert in the existing preservation pipeline; never parse it as DOM.
export function inspectTextColors(root: ColorAst) {
  const tags = new Set<ColorAst>();
  const leaves = new Map<ColorAst, string | null>();
  function visit(parent: ColorAst, inherited: string | null) {
    if (['definition', 'linkReference', 'imageReference', 'footnoteDefinition', 'footnoteReference'].includes(parent.type)) return;
    if (parent.type === 'text') { leaves.set(parent, inherited); return; }
    const children = parent.children ?? [];
    const stack: { index: number; color: string | null }[] = [];
    const pairs = new Map<number, { end: number; color: string }>();
    children.forEach((node, index) => {
      if (node.type !== 'html') return;
      const value = node.value ?? '';
      if (/^<span(?:\s|>)/i.test(value)) stack.push({ index, color: openingColor(value) });
      else if (/^<\/span\s*>$/i.test(value)) {
        const open = stack.pop();
        if (open?.color) { pairs.set(open.index, { end: index, color: open.color }); tags.add(children[open.index]); tags.add(node); }
      }
    });
    const active: { end: number; color: string }[] = [];
    children.forEach((node, index) => {
      while (active.length && active.at(-1)!.end <= index) active.pop();
      const pair = pairs.get(index);
      if (pair) active.push(pair);
      if (!tags.has(node)) visit(node, active.at(-1)?.color ?? inherited);
    });
  }
  visit(root, null);
  return { tags, leaves };
}
export function readTextColors(root: ColorAst) {
  const { tags, leaves } = inspectTextColors(root);
  function visit(parent: ColorAst) {
    parent.children = parent.children?.filter(node => !tags.has(node)).map(node => {
      const color = leaves.get(node);
      if (color) return { type: 'folioColor', color, children: [node], position: node.position };
      visit(node); return node;
    });
  }
  visit(root);
}

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ['yaml', 'toml']);
let cachedText: string | undefined;
let cachedBlocks: { node: ColorAst; tags: Set<ColorAst>; leaves: Map<ColorAst, string | null> }[] = [];
function blocks(text: string) {
  if (cachedText === text) return cachedBlocks;
  cachedText = text; cachedBlocks = [];
  function visit(node: ColorAst) {
    if (['paragraph', 'heading', 'tableCell'].includes(node.type)) { cachedBlocks.push({ node, ...inspectTextColors(node) }); return; }
    node.children?.forEach(visit);
  }
  visit(parser.parse(text) as ColorAst);
  return cachedBlocks;
}
const start = (node: ColorAst) => node.position?.start.offset ?? 0;
const end = (node: ColorAst) => node.position?.end.offset ?? 0;
const overlaps = (node: ColorAst, from: number, to: number) => start(node) < to && end(node) > from;
export function sourceColorStatus(text: string, from: number, to: number): ColorStatus {
  const colors = blocks(text).flatMap(b => [...b.leaves].filter(([node]) => overlaps(node, from, to)).map(([, color]) => color));
  return { enabled: to > from && colors.length > 0, color: colors[0] ?? null, mixed: new Set(colors).size > 1 };
}

// Protect escape sequences, entities and UTF-16 surrogate pairs at selection edges.
function boundaries(raw: string, from: number, to: number) {
  for (const match of raw.matchAll(/\\[!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~]|&(?:#[xX][\da-fA-F]+|#\d+|[a-zA-Z][\da-zA-Z]*);|[\uD800-\uDBFF][\uDC00-\uDFFF]/g)) {
    const a = match.index!, b = a + match[0].length;
    if (from > a && from < b) from = a;
    if (to > a && to < b) to = b;
  }
  return [from, to];
}
export function sourceColorChanges(text: string, from: number, to: number, color: string | null) {
  if (from >= to) return [];
  if (color !== null && !normalizeColor(color)) return [];
  color = normalizeColor(color);
  const changes: { from: number; to: number; insert: string }[] = [];
  function wrap(a: number, b: number, value: string | null) {
    if (!value || a >= b) return;
    let offset = a;
    text.slice(a, b).split('\n').forEach((line, i) => {
      // Preserve literal text offsets so source selections survive formatting.
      const prefix = i ? /^(?:[ \t]*>[ \t]?)*[ \t]*/.exec(line)![0].length : 0;
      if (line.length > prefix) {
        changes.push({ from: offset + prefix, to: offset + prefix, insert: colorOpen(value) });
        changes.push({ from: offset + line.length, to: offset + line.length, insert: '</span>' });
      }
      offset += line.length + 1;
    });
  }
  for (const block of blocks(text)) {
    if (![...block.leaves].some(([node, previous]) => overlaps(node, from, to) && previous !== color)) continue;
    // Rebuild this inline block's color runs while retaining all original Markdown.
    for (const tag of block.tags) changes.push({ from: start(tag), to: end(tag), insert: '' });
    for (const [node, previous] of block.leaves) {
      const a = start(node), b = end(node), raw = text.slice(a, b);
      if (previous !== color && overlaps(node, from, to)) {
        const [left, right] = boundaries(raw, Math.max(0, from - a), Math.min(raw.length, to - a));
        wrap(a, a + left, previous); wrap(a + left, a + right, color); wrap(a + right, b, previous);
      } else wrap(a, b, previous);
    }
  }
  return changes.sort((a, b) => a.from - b.from);
}
export function stripTextColors(text: string) {
  const { tags } = inspectTextColors(parser.parse(text) as ColorAst);
  const pieces: string[] = []; let offset = 0;
  for (const node of [...tags].sort((a, b) => start(a) - start(b))) { pieces.push(text.slice(offset, start(node))); offset = end(node); }
  pieces.push(text.slice(offset)); return pieces.join('');
}
