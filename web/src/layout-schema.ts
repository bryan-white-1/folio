import type { Ctx } from '@milkdown/kit/ctx';
import { imageSchema } from '@milkdown/kit/preset/commonmark';
import { tableSchema, tableCellSchema, tableHeaderSchema } from '@milkdown/kit/preset/gfm';
import { validWidth } from './layout-metadata';
import { $prose } from '@milkdown/kit/utils';
import { Plugin } from '@milkdown/kit/prose/state';

// The table drag plugin emits pixel values without an upper bound (or rounding).
// Commit bounded integers so every visible size has a lossless stored equivalent.
export const layoutConstraints = $prose(() => new Plugin({
  appendTransaction: (transactions, _old, state) => {
    if (!transactions.some(tr => tr.docChanged)) return null;
    const tr = state.tr;
    state.doc.descendants((node, pos) => {
      if (!['table_cell', 'table_header'].includes(node.type.name) || !node.attrs.colwidth) return;
      const widths = (node.attrs.colwidth as number[]).map(w => w === 0 ? 0 : Math.max(40, Math.min(2400, Math.round(Number.isFinite(w) ? w : 100))));
      if (widths.some((w, i) => w !== node.attrs.colwidth[i])) tr.setNodeMarkup(pos, undefined, { ...node.attrs, colwidth: widths });
    });
    return tr.docChanged ? tr : null;
  },
}));

export function configureLayout(ctx: Ctx) {
  ctx.update(imageSchema.key, prev => ctx => {
    const base = prev(ctx);
    return {
      ...base, attrs: { ...base.attrs, width: { default: null } },
      parseMarkdown: { ...base.parseMarkdown, runner: (state, node, type) => {
        state.addNode(type, { src: node.url, alt: node.alt ?? '', title: node.title ?? '', width: validWidth(node.folioWidth) ? node.folioWidth : null });
      } },
      toMarkdown: { ...base.toMarkdown, runner: (state, node) => {
        base.toMarkdown.runner(state, node);
        if (validWidth(node.attrs.width)) state.addNode('html', undefined, `<!-- folio:image:v1 width=${node.attrs.width} -->`);
      } },
    };
  });
  for (const schema of [tableCellSchema, tableHeaderSchema]) {
    ctx.update(schema.key, prev => ctx => {
      const base = prev(ctx);
      return { ...base, parseMarkdown: { ...base.parseMarkdown, runner: (state, node, type) => {
        state.openNode(type, { alignment: node.align, colwidth: validWidth(node.folioWidth) ? [node.folioWidth] : null });
        state.openNode(state.schema.nodes.paragraph).next(node.children).closeNode().closeNode();
      } } };
    });
  }
  ctx.update(tableSchema.key, prev => ctx => {
    const base = prev(ctx);
    return { ...base, toMarkdown: { ...base.toMarkdown, runner: (state, node) => {
      const widths: number[] = [];
      node.firstChild?.forEach(cell => widths.push(validWidth(cell.attrs.colwidth?.[0]) ? cell.attrs.colwidth[0] : 0));
      if (widths.some(Boolean)) state.addNode('html', undefined, `<!-- folio:table:v1 widths=${widths.join(',')} -->`);
      base.toMarkdown.runner(state, node);
    } } };
  });
}
