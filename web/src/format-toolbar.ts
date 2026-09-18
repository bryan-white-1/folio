import type { EditorState } from '@milkdown/kit/prose/state';
import type { HeadingStatus } from './heading-commands';
import { tableContext, tableActionReason, validTableSize, type TableAction } from './table-commands';
import './format-toolbar.css';

export interface FormatActions<T> {
  prepare(): Promise<void>;
  capture(): T;
  status(): { heading: HeadingStatus; table: EditorState | null; canInsert: boolean };
  focus(): void;
  heading(level: number, target: T): Promise<void>;
  table(action: TableAction, target: T): Promise<void>;
  copy(target: T): Promise<void>;
  insert(rows: number, cols: number, target: T): Promise<void>;
  tableCellElement(): HTMLElement | null;
}
const labels: Record<TableAction, string> = {
  'row-before': '위에 행 추가', 'row-after': '아래에 행 추가', 'row-delete': '행 삭제',
  'col-before': '왼쪽에 열 추가', 'col-after': '오른쪽에 열 추가', 'col-delete': '열 삭제',
  'select-row': '행 선택', 'select-col': '열 선택', 'select-table': '표 전체 선택',
  clear: '내용 지우기', delete: '표 삭제', left: '왼쪽 정렬', center: '가운데 정렬', right: '오른쪽 정렬',
};

export class FormatToolbar<T> {
  private headingButton = document.getElementById('heading-picker') as HTMLButtonElement;
  private insertButton = document.querySelector<HTMLButtonElement>('[data-command="table"]')!;
  private panel = document.createElement('div');
  private target: T | null = null;
  private anchor: HTMLElement | null = null;
  private positionPoint: { x: number; y: number } | null = null;
  private pendingOpen = 0;
  private frame = 0;
  constructor(private actions: FormatActions<T>) {
    this.panel.className = 'format-popover'; this.panel.hidden = true;
    this.panel.id = 'format-popover'; this.panel.tabIndex = -1;
    document.body.append(this.panel);
    this.headingButton.setAttribute('aria-controls', this.panel.id);
    this.insertButton.setAttribute('aria-haspopup', 'dialog');
    this.headingButton.onmousedown = e => e.preventDefault();
    this.headingButton.onclick = () => void this.open('heading', this.headingButton);
    this.insertButton.onmousedown = e => e.preventDefault();
    this.insertButton.onclick = () => void this.open('insert', this.insertButton);
    this.panel.addEventListener('keydown', e => this.menuKeys(e));
    document.addEventListener('pointerdown', e => {
      if (!this.panel.hidden && !this.panel.contains(e.target as Node) && !this.anchor?.contains(e.target as Node)) this.close(false);
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !this.panel.hidden) { e.preventDefault(); e.stopPropagation(); this.close(true); }
    }, true);
    document.getElementById('editor-scroll')!.addEventListener('scroll', () => this.schedulePosition());
    window.addEventListener('resize', () => this.schedulePosition());
    new ResizeObserver(() => this.schedulePosition()).observe(document.getElementById('editor-scroll')!);
  }
  close(focus = false) {
    this.pendingOpen++;
    this.panel.hidden = true; this.target = null;
    if (this.anchor instanceof HTMLButtonElement) this.anchor.setAttribute('aria-expanded', 'false');
    this.anchor = null; this.positionPoint = null;
    if (focus) this.actions.focus();
  }
  update() {
    const { heading, canInsert } = this.actions.status();
    this.headingButton.disabled = !heading.enabled;
    this.headingButton.title = heading.reason || '본문·제목 선택 (Ctrl+Alt+0–6)';
    this.headingButton.querySelector('span')!.textContent = !heading.enabled ? '서식' : heading.level === null ? '혼합' : heading.level ? `제목 ${heading.level}` : '본문';
    this.insertButton.disabled = !canInsert;
    this.insertButton.title = canInsert ? '표 삽입 · 행과 열 선택' : '표 밖의 문단에서 표를 삽입하세요';
    this.schedulePosition();
  }
  private schedulePosition() {
    if (this.panel.hidden || this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.position(); });
  }
  private position() {
    if (this.panel.hidden || !this.anchor) return;
    const a = this.anchor.getBoundingClientRect();
    const x = this.positionPoint?.x ?? a.left;
    const y = this.positionPoint?.y ?? a.bottom + 7;
    const h = this.panel.offsetHeight;
    this.panel.style.left = `${Math.max(8, Math.min(x, innerWidth - this.panel.offsetWidth - 8))}px`;
    this.panel.style.top = `${Math.max(8, Math.min(y, innerHeight - h - 8))}px`;
  }
  async open(kind: 'heading' | 'insert' | 'context', anchor?: HTMLElement, point?: { x: number; y: number }) {
    const token = ++this.pendingOpen;
    await this.actions.prepare();
    if (token !== this.pendingOpen) return;
    const status = this.actions.status();
    if ((kind === 'heading' && !status.heading.enabled) || (kind === 'insert' && !status.canInsert) || (!['heading', 'insert'].includes(kind) && !status.table)) return;
    anchor ??= this.actions.tableCellElement() ?? undefined;
    if (!anchor) return;
    if (this.anchor instanceof HTMLButtonElement) this.anchor.setAttribute('aria-expanded', 'false');
    this.anchor = anchor;
    if (anchor instanceof HTMLButtonElement) anchor.setAttribute('aria-expanded', 'true');
    this.positionPoint = point ?? null; this.target = this.actions.capture();
    this.panel.replaceChildren(); this.panel.hidden = false;
    this.panel.setAttribute('role', kind === 'insert' ? 'dialog' : 'menu');
    this.panel.setAttribute('aria-label', kind === 'heading' ? '본문·제목 선택' : kind === 'insert' ? '표 크기 선택' : '표 편집 메뉴');
    this.panel.classList.toggle('insert-popover', kind === 'insert');
    if (kind === 'heading') {
      for (let level = 0; level <= 6; level++) {
        const b = this.item(level ? `제목 ${level}` : '본문', () => {
          const target = this.target; this.close(); if (target) void this.actions.heading(level, target);
        });
        b.setAttribute('role', 'menuitemradio'); b.setAttribute('aria-checked', String(status.heading.level === level));
        b.dataset.level = String(level);
        b.innerHTML = `<span class="heading-tag">${level ? 'H' + level : '¶'}</span><span class="heading-sample">${level ? '제목 ' + level : '본문'}</span><kbd>Ctrl+Alt+${level}</kbd><span class="menu-check">${status.heading.level === level ? '✓' : ''}</span>`;
      }
    } else if (kind === 'insert') this.insertionForm();
    else {
      const copy = this.item('복사', () => {
        const target = this.target; this.close(); if (target) void this.actions.copy(target);
      });
      copy.dataset.action = 'copy'; copy.title = '선택한 셀 복사 (Ctrl+C)';
      copy.innerHTML = '<span>복사</span><kbd>Ctrl+C</kbd>';
      this.panel.append(Object.assign(document.createElement('hr'), { className: 'menu-divider' }));
      const groups: TableAction[][] = [['row-before', 'row-after', 'col-before', 'col-after'], ['left', 'center', 'right'], ['select-row', 'select-col', 'select-table', 'clear'], ['row-delete', 'col-delete', 'delete']];
      const alignment = status.table && tableContext(status.table)?.alignment;
      groups.forEach((group, index) => {
        if (index) this.panel.append(Object.assign(document.createElement('hr'), { className: 'menu-divider' }));
        group.forEach(action => {
          const b = this.item(labels[action], () => void this.execute(action));
          b.dataset.action = action;
          const reason = status.table ? tableActionReason(status.table, action) : '표 셀을 선택하세요';
          b.disabled = !!reason; b.title = reason || labels[action];
          if (['left', 'center', 'right'].includes(action)) {
            b.setAttribute('role', 'menuitemradio'); b.setAttribute('aria-checked', String(action === alignment));
          }
          if (action.includes('delete')) b.classList.add('danger');
        });
      });
      const hint = document.createElement('p'); hint.className = 'menu-hint'; hint.textContent = 'Tab 셀 이동 · 마지막 셀에서 행 추가 · Enter 표 밖으로'; this.panel.append(hint);
    }
    this.position();
    (this.panel.querySelector<HTMLElement>(kind === 'insert' ? 'input' : '[aria-checked="true"]') ?? this.panel.querySelector<HTMLElement>('button:not(:disabled),input') ?? this.panel).focus();
  }
  private item(label: string, click: () => void) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'format-menu-item'; b.setAttribute('role', 'menuitem'); b.textContent = label; b.onclick = click; this.panel.append(b); return b;
  }
  private async execute(action: TableAction) {
    await this.actions.prepare();
    const target = this.target ?? this.actions.capture();
    this.close(); await this.actions.table(action, target);
  }
  private insertionForm() {
    const title = document.createElement('div'); title.className = 'popover-title'; title.textContent = '표 삽입'; this.panel.append(title);
    const preview = document.createElement('p'); preview.className = 'grid-preview'; this.panel.append(preview);
    const grid = document.createElement('div'); grid.className = 'table-size-grid'; grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', '빠른 표 크기'); this.panel.append(grid);
    const form = document.createElement('form');
    form.innerHTML = '<div class="table-size-fields"><label>행 <small>머리행 포함</small><input name="rows" aria-label="표 행 수" type="number" min="2" max="100" step="1" value="3" required></label><label>열<input name="cols" aria-label="표 열 수" type="number" min="1" max="50" step="1" value="2" required></label></div><p class="menu-hint">첫 행은 머리행입니다. 2–100행 · 1–50열</p><button class="primary insert-submit" type="submit">표 만들기</button>';
    this.panel.append(form);
    const rows = form.elements.namedItem('rows') as HTMLInputElement, cols = form.elements.namedItem('cols') as HTMLInputElement;
    const paint = (r: number, c: number) => {
      preview.textContent = `${r}행 × ${c}열`;
      grid.querySelectorAll<HTMLElement>('button').forEach(b => b.classList.toggle('active', Number(b.dataset.row) <= r && Number(b.dataset.col) <= c));
    };
    const apply = (r: number, c: number) => {
      if (!validTableSize(r, c)) return;
      const target = this.target; this.close(); if (target) void this.actions.insert(r, c, target);
    };
    for (let r = 1; r <= 8; r++) for (let c = 1; c <= 8; c++) {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.row = String(r); b.dataset.col = String(c);
      b.setAttribute('aria-label', `${Math.max(2, r)}행 ${c}열 표 삽입`); b.tabIndex = -1;
      b.onmouseenter = () => paint(Math.max(2, r), c); b.onclick = () => apply(Math.max(2, r), c); grid.append(b);
    }
    grid.onmouseleave = () => paint(Number(rows.value), Number(cols.value));
    form.oninput = () => paint(Number(rows.value), Number(cols.value));
    form.onsubmit = e => { e.preventDefault(); if (form.reportValidity()) apply(Number(rows.value), Number(cols.value)); };
    paint(3, 2);
  }
  private menuKeys(e: KeyboardEvent) {
    const insertion = this.panel.classList.contains('insert-popover');
    const buttons = Array.from(this.panel.querySelectorAll<HTMLElement>(insertion ? 'input,button[type="submit"]' : 'button:not(:disabled)'));
    const index = buttons.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Tab' && insertion) {
      e.preventDefault(); buttons[(index + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
    } else if (e.key === 'Tab') { e.preventDefault(); this.close(true); }
    else if (!insertion && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  }
}
