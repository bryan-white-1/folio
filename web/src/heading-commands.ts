import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import type { EditorState, Command } from '@milkdown/kit/prose/state';
import { setBlockType } from '@milkdown/kit/prose/commands';

export interface HeadingStatus { enabled: boolean; level: number | null; reason: string }
type Ast = { type: string; depth?: number; children?: Ast[]; position?: { start: { offset: number }; end: { offset: number } } };
type Block = { from: number; to: number; level: number; content: string; enabled: boolean };
const reason = '일반 문단·제목을 선택하세요. 표·코드·보존 구간·강제 줄바꿈은 변환할 수 없습니다.';
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ['yaml', 'toml']);
let cachedText: string | undefined, cachedBlocks: Block[] = [];
const containsBreak = (node: Ast): boolean => ['break', 'html', 'linkReference', 'imageReference', 'footnoteReference'].includes(node.type) || !!node.children?.some(containsBreak);

function sourceBlocks(text: string) {
  if (text === cachedText) return cachedBlocks;
  cachedText = text; cachedBlocks = [];
  function visit(node: Ast) {
    if (['root', 'list', 'listItem', 'blockquote'].includes(node.type)) { node.children?.forEach(visit); return; }
    if (!node.position) return;
    const from = node.position.start.offset, to = node.position.end.offset;
    const inline = node.children ?? [];
    const start = inline[0]?.position?.start.offset ?? to;
    const end = inline.at(-1)?.position?.end.offset ?? to;
    const prefix = text.slice(text.lastIndexOf('\n', from - 1) + 1, from);
    const continuation = prefix.replace(/(?:[*+-]|\d+[.)])\s+/g, marker => ' '.repeat(marker.length));
    let safe = true;
    const content = text.slice(start, end).split('\n').map((line, i) => {
      if (!i || !continuation) return line.trim();
      if (line.startsWith(continuation)) return line.slice(continuation.length).trim();
      // Lazy continuation without a container prefix is valid Markdown.
      if (/^[ \t]*>/.test(line)) safe = false;
      return line.trim();
    }).join(' ');
    cachedBlocks.push({ from, to, level: node.depth ?? 0, content,
      enabled: ['paragraph', 'heading'].includes(node.type) && !containsBreak(node) && safe });
  }
  visit(parser.parse(text) as unknown as Ast);
  return cachedBlocks;
}

function selectedSourceBlocks(text: string, from: number, to: number) {
  const blocks = sourceBlocks(text);
  const selected = blocks.filter(b => from === to ? from >= b.from && from <= b.to : b.from < to && b.to > from);
  if (selected.length) return selected;
  const start = text.lastIndexOf('\n', from - 1) + 1;
  const end = text.indexOf('\n', from);
  const lineEnd = end < 0 ? text.length : end;
  if (from === to && !text.slice(start, lineEnd).trim()) return [{ from: start, to: lineEnd, level: 0, content: '', enabled: true }];
  return [];
}

export function sourceHeadingStatus(text: string, from: number, to: number): HeadingStatus {
  const blocks = selectedSourceBlocks(text, from, to);
  const enabled = !!blocks.length && blocks.every(b => b.enabled);
  return { enabled, level: blocks.length && blocks.every(b => b.level === blocks[0].level) ? blocks[0].level : null, reason: enabled ? '' : reason };
}

export function sourceHeadingChanges(text: string, from: number, to: number, level: number) {
  if (!Number.isInteger(level) || level < 0 || level > 6 || !sourceHeadingStatus(text, from, to).enabled) return [];
  const targets = selectedSourceBlocks(text, from, to).filter(b => b.level !== level);
  return targets.map(b => {
    // Heading text can begin with a block marker; keep it a paragraph when unwrapping.
    let body = b.content;
    if (!level && body) {
      const standalone = parser.parse(body) as unknown as Ast;
      if (standalone.children?.[0]?.type !== 'paragraph') body = body.replace(/^(\d+)([.)])/, '$1\\$2').replace(/^([#>*+\-_=~`\[<])/, '\\$1');
    }
    let insert = level ? '#'.repeat(level) + ' ' + body : body;
    if (!level) {
      const lineStart = text.lastIndexOf('\n', b.from - 1) + 1;
      const prefix = text.slice(lineStart, b.from);
      const continuation = prefix.replace(/(?:[*+-]|\d+[.)])\s+/g, marker => ' '.repeat(marker.length));
      const previous = sourceBlocks(text).find(block => block.to < b.from && text.slice(block.to, lineStart) === '\n');
      const next = sourceBlocks(text).find(block => block.from > b.to && text.slice(b.to, block.from) === '\n' + continuation);
      const previousPrefix = previous ? text.slice(text.lastIndexOf('\n', previous.from - 1) + 1, previous.from) : null;
      if (previous?.enabled && previous.level === 0 && prefix === continuation && previousPrefix === prefix) insert = '\n' + continuation + insert;
      if (next?.enabled && (next.level === 0 || targets.some(target => target.from === next.from))) insert += '\n' + continuation;
    }
    return { from: b.from, to: b.to, insert };
  });
}

export function sourceTableInsertionAllowed(text: string, from: number, to: number) {
  return sourceHeadingStatus(text, from, to).enabled && selectedSourceBlocks(text, from, to).every(b => {
    const lineStart = text.lastIndexOf('\n', b.from - 1) + 1;
    return !text.slice(lineStart, b.from).trim();
  });
}

export function renderedHeadingStatus(state: EditorState): HeadingStatus {
  const { from, to, $from } = state.selection;
  const levels: number[] = [];
  let enabled = true;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.spec.tableRole) enabled = false;
  state.doc.nodesBetween(from, to, node => {
    if (node.type.spec.tableRole || node.type.name === 'folio_raw_block') { enabled = false; return false; }
    if (!node.isTextblock) return;
    if (!['paragraph', 'heading'].includes(node.type.name)) enabled = false;
    node.descendants(child => { if ((child.type.name === 'hardbreak' && !child.attrs.isInline) || child.type.name === 'hard_break' || child.type.name === 'folio_raw_inline') enabled = false; });
    levels.push(node.type.name === 'heading' ? node.attrs.level : 0);
    return false;
  });
  enabled &&= levels.length > 0;
  return { enabled, level: levels.length && levels.every(l => l === levels[0]) ? levels[0] : null, reason: enabled ? '' : reason };
}

export function setHeading(level: number): Command {
  return (state, dispatch, view) => {
    const status = renderedHeadingStatus(state);
    if (!status.enabled || !Number.isInteger(level) || level < 0 || level > 6 || status.level === level) return false;
    return setBlockType(state.schema.nodes[level ? 'heading' : 'paragraph'], level ? { level } : undefined)(state, dispatch ? tr => {
      if (level) {
        const positions: number[] = [];
        tr.doc.nodesBetween(tr.selection.from, tr.selection.to, (node, pos) => {
          if (node.type.name === 'hardbreak' && node.attrs.isInline) positions.push(pos);
        });
        for (const pos of positions.reverse()) tr.replaceWith(pos, pos + 1, state.schema.text(' '));
      }
      dispatch(tr);
    } : undefined, view);
  };
}
