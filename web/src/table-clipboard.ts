import DOMPurify from 'dompurify';
import { DOMParser, DOMSerializer, type Node, type Schema } from '@milkdown/kit/prose/model';
import { Plugin, TextSelection, type EditorState, type Transaction } from '@milkdown/kit/prose/state';
import { CellSelection, TableMap } from '@milkdown/kit/prose/tables';
import type { EditorView } from '@milkdown/kit/prose/view';
import { tableCommand, tableContext } from './table-commands';

type Grid = { rows: Node[][] };
const MAX_CELLS = 50_000, MAX_COLS = 256, MAX_TEXT = 10_000_000;
const limitMessage = '붙여넣는 표는 최대 256열·50,000셀·10MB까지 지원합니다.';

// Excel quotes cells containing tabs, line breaks or quotes. A final row separator
// terminates the last row; it does not represent an extra empty row.
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [], row: string[] = [];
  let value = '', quoted = false;
  text = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') { value += '"'; i++; }
    else if (char === '"' && (quoted || !value)) quoted = !quoted;
    else if (!quoted && (char === '\t' || char === '\n')) {
      row.push(value); value = '';
      if (char === '\n') { rows.push(row.splice(0)); }
    } else value += char;
  }
  if (value || row.length || !text.endsWith('\n')) { row.push(value); rows.push(row); }
  return rows;
}

function checkSize(height: number, width: number) {
  if (width > MAX_COLS || height * width > MAX_CELLS) throw new Error(limitMessage);
}
function inlineText(schema: Schema, text: string) {
  const nodes: Node[] = [];
  text.replace(/\r\n?/g, '\n').split('\n').forEach((line, i) => {
    if (i) nodes.push(schema.nodes.folio_raw_inline.create({ raw: '<br />' }));
    if (line) nodes.push(schema.text(line));
  });
  return schema.nodes.paragraph.create(null, nodes);
}

function htmlGrid(html: string, schema: Schema): Grid | null {
  if (!/<table[\s>]/i.test(html)) return null;
  const fragment = DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    ALLOWED_TAGS: ['table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'p', 'div', 'span', 'br', 'b', 'strong', 'i', 'em', 's', 'del', 'strike', 'code', 'a', 'img'],
    ALLOWED_ATTR: ['rowspan', 'colspan', 'style', 'align', 'data-colwidth', 'data-folio-raw', 'href', 'src', 'alt', 'title'],
    ALLOW_DATA_ATTR: false,
  });
  const table = fragment.querySelector('table');
  if (!table) return null;
  // A selection containing surrounding prose or several tables must continue
  // through the editor's document paste, never silently drop its other blocks.
  const remainder = fragment.cloneNode(true) as DocumentFragment;
  remainder.querySelector('table')?.remove();
  if (remainder.querySelector('table') || remainder.textContent?.trim()) return null;
  const sourceRows = Array.from(table.rows).filter(row => row.closest('table') === table);
  const rows: Node[][] = [];
  const parser = DOMParser.fromSchema(schema);
  for (let r = 0; r < sourceRows.length; r++) {
    const cells = rows[r] ??= [];
    let col = 0;
    for (const cell of Array.from(sourceRows[r].cells)) {
      while (cells[col]) col++;
      const height = Math.max(1, Math.min(cell.rowSpan || sourceRows.length - r, sourceRows.length - r));
      const width = Math.max(1, cell.colSpan);
      checkSize(Math.max(rows.length, r + height), col + width);
      // Never carry executable raw tokens or remote images out of clipboard HTML.
      cell.querySelectorAll('[data-folio-raw]').forEach(el => {
        if (!/^<br\s*\/?\s*>$/i.test(el.getAttribute('data-folio-raw') ?? '')) el.removeAttribute('data-folio-raw');
      });
      cell.querySelectorAll('img').forEach(img => {
        if (/^(?:[a-z][a-z\d+.-]*:|[\\/])/i.test(img.getAttribute('src') ?? '')) img.replaceWith(img.alt);
      });
      const parsed = parser.parse(cell, { topNode: schema.nodes.paragraph.create(), preserveWhitespace: true });
      const inline: Node[] = [];
      parsed.content.forEach(node => inline.push(node.type.name === 'hardbreak' ? schema.nodes.folio_raw_inline.create({ raw: '<br />' }) : node));
      const content = schema.nodes.paragraph.create(null, inline);
      const alignment = cell.style.textAlign || cell.getAttribute('align');
      const rawWidth = Number(cell.getAttribute('data-colwidth'));
      const attrs = { alignment: ['left', 'center', 'right'].includes(alignment ?? '') ? alignment : 'left', colwidth: Number.isInteger(rawWidth) && rawWidth >= 40 && rawWidth <= 2400 ? [rawWidth] : null };
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        (rows[r + y] ??= [])[col + x] = schema.nodes.table_cell.create(attrs, x || y ? schema.nodes.paragraph.create() : content);
      }
      col += width;
    }
  }
  return rows.length ? { rows } : null;
}

function readGrid(data: DataTransfer, view: EditorView): Grid | null {
  const html = data.getData('text/html'), text = data.getData('text/plain');
  if (html.length + text.length > MAX_TEXT) throw new Error(limitMessage);
  const grid = htmlGrid(html, view.state.schema);
  if (grid) return grid;
  const context = tableContext(view.state);
  // Ordinary multiline prose remains prose outside a table. Inside a table a
  // one-column Excel range (or a scalar for a cell selection) is meaningful.
  if (!text.includes('\t') && !(context && (text.includes('\n') || view.state.selection instanceof CellSelection))) return null;
  const values = parseTsv(text);
  checkSize(values.length, Math.max(...values.map(row => row.length)));
  return { rows: values.map(row => row.map(value => view.state.schema.nodes.table_cell.create(null, inlineText(view.state.schema, value)))) };
}

function pasteGrid(view: EditorView, grid: Grid): Transaction | null {
  const { state } = view, { schema } = state;
  const width = Math.max(...grid.rows.map(row => row.length));
  const height = grid.rows.length;
  if (!width || !height) return null;
  checkSize(height, width);
  const c = tableContext(state), empty = schema.nodes.paragraph.create();
  const scalar = width === 1 && height === 1 && state.selection instanceof CellSelection;
  const pastedHeight = scalar && c ? c.bottom - c.top : height;
  const pastedWidth = scalar && c ? c.right - c.left : width;
  const top = c?.top ?? 0, left = c?.left ?? 0;
  const totalHeight = Math.max(2, c?.map.height ?? 0, top + pastedHeight);
  const totalWidth = Math.max(c?.map.width ?? 0, left + pastedWidth);
  checkSize(totalHeight, totalWidth);
  const rows: Node[] = [];
  for (let r = 0; r < totalHeight; r++) {
    const cells: Node[] = [];
    for (let col = 0; col < totalWidth; col++) {
      const old = c && r < c.map.height && col < c.map.width ? c.table.child(r).child(col) : null;
      const inside = r >= top && r < top + pastedHeight && col >= left && col < left + pastedWidth;
      const source = inside ? grid.rows[scalar ? 0 : r - top]?.[scalar ? 0 : col - left] : null;
      const format = c && col < c.map.width ? c.table.firstChild!.child(col) : grid.rows[0]?.[col - left];
      const attrs = old?.attrs ?? { alignment: format?.attrs.alignment ?? 'left', colwidth: format?.attrs.colwidth ?? null };
      cells.push(schema.nodes[r === 0 ? 'table_header' : 'table_cell'].create(attrs, inside ? source?.content ?? empty : old?.content ?? empty));
    }
    rows.push(schema.nodes[r === 0 ? 'table_header_row' : 'table_row'].create(null, cells));
  }
  const table = schema.nodes.table.create(c?.table.attrs, rows);
  const tr = state.tr;
  if (c) {
    if (c.table.eq(table)) return null;
    tr.replaceWith(c.tableStart - 1, c.tableStart - 1 + c.table.nodeSize, table);
    const map = TableMap.get(table);
    tr.setSelection(CellSelection.create(tr.doc, c.tableStart + map.map[top * totalWidth + left], c.tableStart + map.map[(top + pastedHeight - 1) * totalWidth + left + pastedWidth - 1]));
  } else {
    // A paste outside a table uses the first copied row as its GFM header.
    // One-row copies get a blank body row, preserving all copied values.
    tr.replaceSelectionWith(table);
    let inserted = -1;
    tr.doc.descendants((node, pos) => { if (node === table) { inserted = pos; return false; } });
    if (inserted < 0) return null;
    const map = TableMap.get(table);
    tr.setSelection(TextSelection.near(tr.doc.resolve(inserted + 1 + map.map[0] + 2)));
  }
  return tr.scrollIntoView();
}

export function serializeTableSelection(state: EditorState) {
  const c = tableContext(state);
  if (!c) return null;
  const doc = document.implementation.createHTMLDocument('');
  const table = doc.createElement('table'), body = doc.createElement('tbody'); table.append(body);
  const serializer = DOMSerializer.fromSchema(state.schema), lines: string[] = [];
  for (let r = c.top; r < c.bottom; r++) {
    const row = doc.createElement('tr'), values: string[] = []; body.append(row);
    for (let col = c.left; col < c.right; col++) {
      const cell = c.table.child(r).child(col);
      row.append(serializer.serializeNode(cell, { document: doc }));
      const value = cell.textBetween(0, cell.content.size, '\n', node => node.type.name === 'folio_raw_inline' && /^<br\s*\/?\s*>$/i.test(node.attrs.raw) ? '\n' : node.attrs.alt ?? node.attrs.raw ?? '\n');
      values.push(/[\t\n"]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value);
    }
    lines.push(values.join('\t'));
  }
  return { html: table.outerHTML, text: lines.join('\r\n') };
}

function copyGrid(view: EditorView, event: ClipboardEvent, cut: boolean, commit: (view: EditorView, tr: Transaction) => void) {
  if (!(view.state.selection instanceof CellSelection) || !event.clipboardData) return false;
  const data = serializeTableSelection(view.state);
  if (!data) return false;
  event.clipboardData.setData('text/html', data.html);
  event.clipboardData.setData('text/plain', data.text);
  event.preventDefault();
  if (cut) tableCommand('clear')(view.state, tr => commit(view, tr), view);
  return true;
}

export function tableClipboard(commit: (view: EditorView, tr: Transaction) => void, notify: (message: string) => void) {
  return new Plugin({ props: { handleDOMEvents: {
    copy: (view, event) => copyGrid(view, event, false, commit),
    cut: (view, event) => copyGrid(view, event, true, commit),
    paste(view, event) {
      if (!event.clipboardData || view.state.selection.$from.parent.type.spec.code || view.composing) return false;
      try {
        const grid = readGrid(event.clipboardData, view);
        if (!grid) return false;
        event.preventDefault();
        const tr = pasteGrid(view, grid);
        if (tr) commit(view, tr);
        return true;
      } catch (error) {
        event.preventDefault(); notify(error instanceof Error ? error.message : '표를 붙여넣지 못했습니다.'); return true;
      }
    },
  } } });
}
