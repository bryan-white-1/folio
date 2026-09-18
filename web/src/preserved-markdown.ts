import { $nodeSchema, $remark } from '@milkdown/kit/utils';
import remarkFrontmatter from 'remark-frontmatter';
import { readLayoutMetadata } from './layout-metadata';

// Convert unsupported syntax before commonmark's normalizers can discard or expand it.
// Raw tokens are inert document atoms, never executable HTML.
type Ast = { type: string; value?: string; children?: Ast[]; position?: { start: { offset?: number }; end: { offset?: number } } };
export const frontmatter = $remark('folio-frontmatter', () => remarkFrontmatter, ['yaml', 'toml']);
export const preserveSyntax = $remark('folio-preserve-syntax', () => () => (tree, file) => {
  readLayoutMetadata(tree);
  const source = String(file.value);
  function visit(parent: Ast) {
    parent.children = parent.children?.map(node => {
      if (['html', 'definition', 'linkReference', 'imageReference', 'footnoteDefinition', 'footnoteReference', 'yaml', 'toml'].includes(node.type)) {
        const start = node.position?.start.offset; const end = node.position?.end.offset;
        const raw = start !== undefined && end !== undefined ? source.slice(start, end) : node.value ?? '';
        const block = ['root', 'blockquote', 'listItem'].includes(parent.type);
        // Milkdown writes an empty editable paragraph as <br />. Restore that paragraph.
        if (block && node.type === 'html' && /^<br\s*\/?\s*>$/i.test(raw.trim())) return { type: 'paragraph', children: [] };
        return { type: block ? 'folioRawBlock' : 'folioRawInline', value: raw };
      }
      visit(node); return node;
    });
  }
  visit(tree as Ast);
});

const attrs = { raw: { default: '' } };
export const rawInline = $nodeSchema('folio_raw_inline', () => ({
  inline: true, group: 'inline', atom: true, attrs,
  parseDOM: [{ tag: 'span[data-folio-raw]', getAttrs: dom => ({ raw: dom.getAttribute('data-folio-raw') ?? '' }) }],
  toDOM: node => /^<br\s*\/?\s*>$/i.test(node.attrs.raw) ? ['br', { 'data-folio-raw': node.attrs.raw }] : ['span', { 'data-folio-raw': node.attrs.raw, class: 'raw-inline', title: '원문을 보존한 구간' }, node.attrs.raw],
  parseMarkdown: { match: node => node.type === 'folioRawInline', runner: (state, node, type) => { state.addNode(type, { raw: node.value }); } },
  toMarkdown: { match: node => node.type.name === 'folio_raw_inline', runner: (state, node) => { state.addNode('html', undefined, node.attrs.raw); } },
}));
export const rawBlock = $nodeSchema('folio_raw_block', () => ({
  group: 'block', atom: true, attrs,
  parseDOM: [{ tag: 'div[data-folio-raw]', getAttrs: dom => ({ raw: dom.getAttribute('data-folio-raw') ?? '' }) }],
  toDOM: node => /^<br\s*\/?\s*>$/i.test(node.attrs.raw.trim())
    ? ['div', { 'data-folio-raw': node.attrs.raw, class: 'raw-break', 'aria-label': '빈 줄' }]
    : ['div', { 'data-folio-raw': node.attrs.raw, class: 'raw-block' }, ['span', { class: 'raw-label' }, '원문 보존 구간'], ['pre', {}, node.attrs.raw]],
  parseMarkdown: { match: node => node.type === 'folioRawBlock', runner: (state, node, type) => { state.addNode(type, { raw: node.value }); } },
  toMarkdown: { match: node => node.type.name === 'folio_raw_block', runner: (state, node) => { state.addNode('html', undefined, node.attrs.raw); } },
}));
