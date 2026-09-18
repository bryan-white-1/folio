// Versioned, inert comments keep ordinary Markdown images/tables portable.
export type LayoutAst = { type: string; value?: string; children?: LayoutAst[]; folioWidth?: number; folioWidths?: number[] };
export const validWidth = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 40 && value <= 2400;
export function readLayoutMetadata(parent: LayoutAst) {
  const children = parent.children;
  if (!children) return;
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (node.type === 'html') {
      const image = /^<!-- folio:image:v1 width=(\d{2,4}) -->$/.exec(node.value ?? '');
      const table = /^<!-- folio:table:v1 widths=([\d,]{1,1280}) -->$/.exec(node.value ?? '');
      const previous = children[i - 1], next = children[i + 1];
      if (image && previous?.type === 'image' && validWidth(Number(image[1]))) {
        previous.folioWidth = Number(image[1]); children.splice(i--, 1); continue;
      }
      if (table && next?.type === 'table') {
        const widths = table[1].split(',').map(Number);
        if (widths.length <= 256 && widths.length === next.children?.[0]?.children?.length && widths.every(w => w === 0 || validWidth(w))) {
          next.folioWidths = widths;
          next.children?.forEach(row => row.children?.forEach((cell, col) => { cell.folioWidth = widths[col]; }));
          children.splice(i--, 1); continue;
        }
      }
    }
    readLayoutMetadata(node);
  }
}
