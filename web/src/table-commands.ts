import { CellSelection, TableMap, selectedRect, isInTable, deleteTable, goToNextCell } from '@milkdown/kit/prose/tables';
import { TextSelection, type EditorState, type Command } from '@milkdown/kit/prose/state';
import { Fragment, type Node } from '@milkdown/kit/prose/model';

export type TableAction = 'row-before' | 'row-after' | 'row-delete' | 'col-before' | 'col-after' | 'col-delete' | 'select-row' | 'select-col' | 'select-table' | 'clear' | 'delete' | 'left' | 'center' | 'right';
export function tableContext(state: EditorState) {
  if (!isInTable(state)) return null;
  if (!(state.selection instanceof CellSelection)) {
    const start = state.selection.$from, end = state.selection.$to;
    let startTable: Node | undefined, endTable: Node | undefined;
    for (let d = start.depth; d > 0; d--) if (start.node(d).type.spec.tableRole === 'table') startTable = start.node(d);
    for (let d = end.depth; d > 0; d--) if (end.node(d).type.spec.tableRole === 'table') endTable = end.node(d);
    if (!startTable || startTable !== endTable) return null;
  }
  const rect = selectedRect(state);
  // Folio's pipe-table format is a rectangular grid, with one dedicated header row.
  if (rect.table.childCount < 2 || rect.table.firstChild?.type.name !== 'table_header_row') return null;
  let simple = true;
  rect.table.forEach(row => {
    if (row.childCount !== rect.map.width) simple = false;
    row.forEach(cell => { if (cell.attrs.colspan !== 1 || cell.attrs.rowspan !== 1) simple = false; });
  });
  if (!simple) return null;
  const alignments = Array.from({ length: rect.right - rect.left }, (_, i) => rect.table.firstChild!.child(i + rect.left).attrs.alignment || 'left');
  return { ...rect, alignment: alignments.every(a => a === alignments[0]) ? alignments[0] as string : null };
}

export function tableActionReason(state: EditorState, action: TableAction) {
  const c = tableContext(state);
  if (!c) return '편집할 표의 셀을 선택하세요.';
  if (action === 'row-before' && c.top === 0) return '머리행 앞에는 행을 추가할 수 없습니다.';
  if (action === 'row-delete' && c.top === 0) return '머리행은 유지해야 합니다. 내용 지우기를 사용하세요.';
  if (action === 'row-delete' && c.map.height - (c.bottom - c.top) < 2) return '본문 행 하나는 유지해야 합니다. 내용 지우기 또는 표 삭제를 사용하세요.';
  if (action === 'col-delete' && c.right - c.left === c.map.width) return '열 하나는 유지해야 합니다. 내용 지우기 또는 표 삭제를 사용하세요.';
  if (['col-before', 'col-after'].includes(action) && c.map.width >= 256) return '최대 256열까지 편집할 수 있습니다.';
  return '';
}

// Rebuild only the current table, preserving every surviving cell node and attribute.
// This also avoids generic table commands moving the GFM-only header row.
export function tableCommand(action: TableAction): Command {
  return (state, dispatch, view) => {
    if (tableActionReason(state, action)) return false;
    const c = tableContext(state)!;
    if (action === 'delete') return deleteTable(state, dispatch);
    const { table, tableStart, map, top, bottom, left, right } = c;
    const tr = state.tr;
    if (action.startsWith('select-')) {
      const r1 = action === 'select-col' || action === 'select-table' ? 0 : top;
      const r2 = action === 'select-col' || action === 'select-table' ? map.height - 1 : bottom - 1;
      const c1 = action === 'select-row' || action === 'select-table' ? 0 : left;
      const c2 = action === 'select-row' || action === 'select-table' ? map.width - 1 : right - 1;
      dispatch?.(tr.setSelection(CellSelection.create(tr.doc, tableStart + map.map[r1 * map.width + c1], tableStart + map.map[r2 * map.width + c2])));
      return true;
    }
    const rows: Node[] = [];
    let targetRow = top, targetCol = left;
    const empty = state.schema.nodes.paragraph.create();
    const rowIndex = action === 'row-before' ? top : bottom;
    const colIndex = action === 'col-before' ? left : right;
    table.forEach((row, _offset, r) => {
      if (action === 'row-delete' && r >= top && r < bottom) return;
      const cells: Node[] = [];
      row.forEach((cell, _offset, col) => {
        if (action === 'col-delete' && col >= left && col < right) return;
        if (['left', 'center', 'right'].includes(action) && col >= left && col < right)
          cell = cell.type.create({ ...cell.attrs, alignment: action }, cell.content, cell.marks);
        if (action === 'clear' && r >= top && r < bottom && col >= left && col < right)
          cell = cell.type.create(cell.attrs, empty, cell.marks);
        cells.push(cell);
      });
      if (action === 'col-before' || action === 'col-after') cells.splice(colIndex, 0, row.firstChild!.type.create({ alignment: 'left', colwidth: null }, empty));
      rows.push(row.copy(Fragment.fromArray(cells)));
    });
    if (action === 'row-before' || action === 'row-after') {
      const cells: Node[] = [];
      table.firstChild!.forEach(cell => cells.push(state.schema.nodes.table_cell.create({ ...cell.attrs }, empty)));
      rows.splice(rowIndex, 0, state.schema.nodes.table_row.create(null, cells));
      targetRow = rowIndex;
    }
    if (action === 'col-before' || action === 'col-after') targetCol = colIndex;
    const next = table.type.create(table.attrs, rows, table.marks);
    if (table.eq(next)) return false;
    tr.replaceWith(tableStart - 1, tableStart - 1 + table.nodeSize, next);
    const nextMap = TableMap.get(next);
    if (action === 'clear' || ['left', 'center', 'right'].includes(action)) {
      // Geometry is unchanged: keep text or rectangular selection at the same cells.
      if (state.selection instanceof CellSelection) {
        const anchor = map.findCell(state.selection.$anchorCell.pos - tableStart), head = map.findCell(state.selection.$headCell.pos - tableStart);
        tr.setSelection(CellSelection.create(tr.doc, tableStart + nextMap.map[anchor.top * nextMap.width + anchor.left], tableStart + nextMap.map[head.top * nextMap.width + head.left]));
      } else if (action !== 'clear') tr.setSelection(state.selection.getBookmark().resolve(tr.doc));
      else tr.setSelection(TextSelection.near(tr.doc.resolve(tableStart + nextMap.map[top * nextMap.width + left] + 2)));
    } else {
      targetRow = Math.min(targetRow, nextMap.height - 1); targetCol = Math.min(targetCol, nextMap.width - 1);
      tr.setSelection(TextSelection.near(tr.doc.resolve(tableStart + nextMap.map[targetRow * nextMap.width + targetCol] + 2)));
    }
    dispatch?.(tr.scrollIntoView());
    return true;
  };
}

export const nextTableCell: Command = (state, dispatch, view) => {
  if (goToNextCell(1)(state, dispatch, view)) return true;
  const c = tableContext(state);
  if (!c || c.bottom !== c.map.height || c.right !== c.map.width) return false;
  return tableCommand('row-after')(state, tr => {
    const next = tr.doc.nodeAt(c.tableStart - 1)!;
    const map = TableMap.get(next);
    tr.setSelection(TextSelection.near(tr.doc.resolve(c.tableStart + map.map[(map.height - 1) * map.width] + 2)));
    dispatch?.(tr);
  }, view);
};

export function emptyTableMarkdown(rows: number, cols: number) {
  const blank = '| ' + Array(cols).fill(' ').join(' | ') + ' |';
  return [blank, '| ' + Array(cols).fill('---').join(' | ') + ' |', ...Array(rows - 1).fill(blank)].join('\n');
}

export const validTableSize = (rows: number, cols: number) => Number.isInteger(rows) && Number.isInteger(cols) && rows >= 2 && rows <= 100 && cols >= 1 && cols <= 50;
