import { t } from './i18n';
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
  let protectedReason: string | null = /^(---|\+\+\+)\n/.test(text) ? t('메타데이터') : null;
  const visit = (n: Node) => {
    if (n.type === 'image' && n.url) images.push(n.url);
    if (['html', 'definition', 'linkReference', 'imageReference', 'footnoteDefinition', 'footnoteReference'].includes(n.type)) protectedReason ??= t('HTML 또는 참조 문법');
    n.children?.forEach(visit);
  };
  visit(tree);
  return { headings, protectedReason, images };
}

export interface Snapshot { text: string; cursor: number; endings?: string[] }
export interface TextChange { from: number; to: number; insert: string }
export class DocumentModel {
  preserveEndings = false;
  endings: string[] = [];
  newline = '\n';
  text = '';
  savedText = '';
  private savedFileText = '';
  private fileCache: { revision: number; value: string } | undefined;
  revision = 0;
  cursor = 0;
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];
  private groupTime = 0;
  private groupOrigin = '';
  get dirty() { return this.preserveEndings ? this.fileText() !== this.savedFileText : this.text !== this.savedText; }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  load(text: string, dirty = false) {
    this.endings = text.match(/\r\n|\r|\n/g) ?? [];
    const counts = new Map<string, number>();
    for (const e of this.endings) counts.set(e, (counts.get(e) ?? 0) + 1);
    this.newline = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '\n';
    this.text = normalize(text); this.savedText = dirty ? '\0' : this.text; this.savedFileText = dirty ? '\0' : text;
    this.revision++; this.cursor = 0; this.past = []; this.future = []; this.breakGroup();
  }
  change(text: string, origin: string, cursor = this.cursor, now = Date.now(), changes?: TextChange[]) {
    text = normalize(text);
    if (text === this.text) { this.cursor = cursor; return false; }
    if (origin !== this.groupOrigin || now - this.groupTime > 650) {
      this.past.push({ text: this.text, cursor: this.cursor, endings: this.preserveEndings ? [...this.endings] : undefined });
      let characters = this.past.reduce((sum, state) => sum + state.text.length, 0);
      while (this.past.length > 1 && (this.past.length > 150 || characters > 8_000_000)) characters -= this.past.shift()!.text.length;
    }
    if (this.preserveEndings) {
      if (!changes) {
        let from = 0, oldEnd = this.text.length, newEnd = text.length;
        while (from < oldEnd && from < newEnd && this.text[from] === text[from]) from++;
        while (oldEnd > from && newEnd > from && this.text[oldEnd - 1] === text[newEnd - 1]) { oldEnd--; newEnd--; }
        changes = [{ from, to: oldEnd, insert: text.slice(from, newEnd) }];
      }
      // Changes use old-document coordinates; reverse order retains untouched newlines.
      for (const c of [...changes].sort((a, b) => b.from - a.from)) {
        const start = (this.text.slice(0, c.from).match(/\n/g) ?? []).length;
        const removed = (this.text.slice(c.from, c.to).match(/\n/g) ?? []).length;
        const added = (normalize(c.insert).match(/\n/g) ?? []).map(() => this.newline);
        this.endings = [...this.endings.slice(0, start), ...added, ...this.endings.slice(start + removed)];
      }
    }
    this.future = []; this.text = text; this.cursor = cursor; this.revision++;
    this.groupTime = now; this.groupOrigin = origin; return true;
  }
  breakGroup() { this.groupOrigin = ''; this.groupTime = 0; }
  undo() {
    const state = this.past.pop(); if (!state) return false;
    this.future.push({ text: this.text, cursor: this.cursor, endings: this.preserveEndings ? [...this.endings] : undefined }); this.restore(state); return true;
  }
  redo() {
    const state = this.future.pop(); if (!state) return false;
    this.past.push({ text: this.text, cursor: this.cursor, endings: this.preserveEndings ? [...this.endings] : undefined }); this.restore(state); return true;
  }
  private restore(state: Snapshot) { this.text = state.text; this.cursor = state.cursor; if (state.endings) this.endings = state.endings; this.revision++; this.breakGroup(); }
  fileText() { if (!this.preserveEndings) return this.text; if (this.fileCache?.revision === this.revision) return this.fileCache.value; let i = 0; const value = this.text.replace(/\n/g, () => this.endings[i++] ?? this.newline); this.fileCache = { revision: this.revision, value }; return value; }
  markSaved(text: string) { this.savedText = normalize(text); this.savedFileText = text; }
}
