import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';

export interface Heading { id: string; depth: number; label: string; from: number; to: number; sectionEnd: number; parentId: string | null }
type Node = { type: string; lang?: string; depth?: number; value?: string; alt?: string; url?: string; children?: Node[]; position?: { start: { offset: number }; end: { offset: number } } };
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ['yaml', 'toml']);
const plain = (n: Node): string => n.value ?? n.alt ?? n.children?.map(plain).join('') ?? '';
export const normalize = (text: string) => text.replace(/\r\n?/g, '\n');

export function codeBlocks(text: string) {
  const blocks: { language: string; value: string; from: number; to: number; bodyFrom: number }[] = [];
  function visit(node: Node) {
    if (node.type === 'code' && node.position) {
      const from = node.position.start.offset;
      const newline = text.indexOf('\n', from);
      let bodyFrom = newline < 0 ? from : newline + 1;
      // Strip container prefixes on the first content line (blockquote/list fences).
      const end = text.indexOf('\n', bodyFrom);
      const line = text.slice(bodyFrom, end < 0 ? text.length : end);
      const first = (node.value ?? '').split('\n')[0];
      if (first && line.endsWith(first)) bodyFrom += line.length - first.length;
      blocks.push({ language: node.lang ?? '', value: node.value ?? '', from, to: node.position.end.offset, bodyFrom });
    }
    node.children?.forEach(visit);
  }
  visit(parser.parse(text) as unknown as Node); return blocks;
}

export function analyze(text: string): { headings: Heading[]; protectedReason: string | null; images: string[] } {
  const tree = parser.parse(text) as unknown as Node;
  const headings: Heading[] = [];
  const images: string[] = [];
  const parents: Heading[] = [];
  for (const n of tree.children ?? []) {
    if (n.type !== 'heading' || !n.position) continue;
    while (parents.length && parents.at(-1)!.depth >= n.depth!) parents.pop();
    const h: Heading = { id: `h-${n.position.start.offset}`, depth: n.depth!, label: plain(n), from: n.position.start.offset, to: n.position.end.offset, sectionEnd: text.length, parentId: parents.at(-1)?.id ?? null };
    parents.push(h); headings.push(h);
  }
  headings.forEach((h, i) => { h.sectionEnd = headings.slice(i + 1).find(next => next.depth <= h.depth)?.from ?? text.length; });
  let protectedReason: string | null = /^(---|\+\+\+)\n/.test(text) ? '메타데이터' : null;
  const visit = (n: Node) => {
    if (n.type === 'image' && n.url) images.push(n.url);
    if (['html', 'definition', 'linkReference', 'imageReference', 'footnoteDefinition', 'footnoteReference'].includes(n.type)) protectedReason ??= 'HTML 또는 참조 문법';
    n.children?.forEach(visit);
  };
  visit(tree);
  return { headings, protectedReason, images };
}

export interface Snapshot { text: string; cursor: number }
export class DocumentModel {
  text = '';
  savedText = '';
  revision = 0;
  cursor = 0;
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];
  private groupTime = 0;
  private groupOrigin = '';
  get dirty() { return this.text !== this.savedText; }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  load(text: string, dirty = false) {
    this.text = normalize(text); this.savedText = dirty ? '\0' : this.text;
    this.revision++; this.cursor = 0; this.past = []; this.future = []; this.breakGroup();
  }
  change(text: string, origin: string, cursor = this.cursor, now = Date.now()) {
    text = normalize(text);
    if (text === this.text) { this.cursor = cursor; return false; }
    if (origin !== this.groupOrigin || now - this.groupTime > 650) {
      this.past.push({ text: this.text, cursor: this.cursor });
      let characters = this.past.reduce((sum, state) => sum + state.text.length, 0);
      while (this.past.length > 1 && (this.past.length > 150 || characters > 8_000_000)) characters -= this.past.shift()!.text.length;
    }
    this.future = []; this.text = text; this.cursor = cursor; this.revision++;
    this.groupTime = now; this.groupOrigin = origin; return true;
  }
  breakGroup() { this.groupOrigin = ''; this.groupTime = 0; }
  undo() {
    const state = this.past.pop(); if (!state) return false;
    this.future.push({ text: this.text, cursor: this.cursor }); this.restore(state); return true;
  }
  redo() {
    const state = this.future.pop(); if (!state) return false;
    this.past.push({ text: this.text, cursor: this.cursor }); this.restore(state); return true;
  }
  private restore(state: Snapshot) { this.text = state.text; this.cursor = state.cursor; this.revision++; this.breakGroup(); }
  markSaved(text: string) { this.savedText = normalize(text); }
}
