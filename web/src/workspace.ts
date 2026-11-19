import { t, uiHtml } from './i18n';
import { detectLanguage } from './text-language';
type Packet = { type: string; [key: string]: any };
type Tab = { id: string; path: string; name: string; kind: string; dirty: boolean; external: boolean; externalVersion: string };
type Entry = { path: string; name: string; directory: boolean; link: boolean };

const rightChevron = 'M6 3.5 10.5 8 6 12.5';
function chevronIcon(path: string) {
  return `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${path}"/></svg>`;
}

function tabIcon(item: Tab) {
  const markdown = item.kind === 'markdown';
  const code = detectLanguage(item.name) !== 'plain' || /\.[cm]?jsx?$/i.test(item.name);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'tab-file-icon');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI!, 'path');
  const page = 'M5 2.5h9l5 5V21H5z M14 3v5h5 ';
  const detail = item.kind === 'image' ? 'M7 17l3-4 2 2 2-3 3 5z' : code ? 'M10 11l-3 3 3 3m4-6 3 3-3 3' : 'M8 12h8m-8 4h6';
  path.setAttribute('d', markdown
    ? 'M2 5h20v14H2z M5 15V9l3 3 3-3v6 M17 9v6m-3-3 3 3 3-3'
    : page + detail);
  svg.append(path);
  return svg;
}
export function installWorkspace(shell: HTMLElement, send: (p: Packet) => void) {
  const command = (name: string, path = '') => send({ type: 'command', name, path });
  const strip = document.createElement('div'); strip.className = 'document-tabs';
  const tabs = document.createElement('div'); tabs.className = 'tab-items'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', t('열린 파일'));
  const nav = document.createElement('div'); nav.className = 'tab-nav';
  function navButton(label: string, chevron: string) {
    const button = document.createElement('button');
    button.title = t(label); button.setAttribute('aria-label', button.title);
    button.innerHTML = chevronIcon(chevron);
    nav.append(button); return button;
  }
  const prev = navButton('이전 탭', 'M10 3.5 5.5 8 10 12.5');
  const next = navButton('다음 탭', rightChevron);
  const toggle = navButton('열린 파일 목록', 'M3.5 6 8 10.5 12.5 6');
  const list = document.createElement('div'); list.id = 'open-file-list'; list.hidden = true;
  list.setAttribute('role', 'menu'); list.setAttribute('aria-label', t('열린 파일 목록'));
  toggle.setAttribute('aria-haspopup', 'menu'); toggle.setAttribute('aria-controls', list.id); toggle.setAttribute('aria-expanded', 'false');
  strip.append(tabs, nav, list); document.getElementById('app')!.prepend(strip);
  const banner = document.createElement('div'); banner.className = 'external-notice'; banner.hidden = true;
  const message = document.createElement('span'); message.setAttribute('role', 'status');
  const keep = document.createElement('button'); keep.textContent = t('계속 편집');
  const action = document.createElement('button');
  banner.append(message, keep, action); strip.after(banner);
  const dismissed = new Map<string, string>();
  const sidebar = shell.querySelector<HTMLElement>('.host-sidebar')!;
  const outline = document.createElement('div'); outline.className = 'outline-pane';
  for (const node of [...sidebar.children]) if (node.tagName !== 'FOOTER') outline.append(node);
  const chooser = document.createElement('div'); chooser.className = 'sidebar-chooser'; chooser.innerHTML = uiHtml('<button data-pane="files">파일</button><button data-pane="outline">목차</button>');
  const files = document.createElement('div'); files.className = 'folder-pane';
  files.innerHTML = uiHtml('<div class="folder-actions"><button data-folder="openFolder" title="폴더 열기">폴더 열기</button><button data-folder="refresh" title="새로고침">↻</button><button data-folder="reveal" title="현재 파일 위치">◎</button></div><button class="folder-root"></button><input class="folder-filter" aria-label="표시된 파일 필터" placeholder="표시된 파일 필터"><label class="folder-excluded"><input type="checkbox">제외 폴더 표시</label><div class="folder-tree" role="tree" aria-label="프로젝트 파일"></div>');
  sidebar.prepend(chooser, files, outline);
  const tree = files.querySelector<HTMLElement>('.folder-tree')!, rootLabel = files.querySelector<HTMLElement>('.folder-root')!, filter = files.querySelector<HTMLInputElement>('.folder-filter')!, excluded = files.querySelector<HTMLInputElement>('input[type=checkbox]')!;
  let pane = 'outline', root = '', currentPath = '', currentId = '', entries: Tab[] = [], tabKey = '', generation = 0, selectedPath = '';
  const cache = new Map<string, { entries: Entry[]; error: string }>(), expanded = new Set<string>(), pending = new Map<string, string>();
  const equal = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();
  function selectPane(value: string) {
    pane = value; files.hidden = value !== 'files'; outline.hidden = value !== 'outline';
    chooser.querySelectorAll<HTMLElement>('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pane === value)));
  }
  chooser.querySelectorAll<HTMLElement>('button').forEach(b => b.onclick = () => selectPane(b.dataset.pane!)); selectPane(pane);
  function request(path: string) {
    if (!path || pending.has(path)) return;
    const id = `${generation}:${crypto.randomUUID()}`; pending.set(path, id);
    send({ type: 'listFolder', path, requestId: id, showExcluded: excluded.checked });
  }
  function reset() { generation++; cache.clear(); pending.clear(); request(root); render(); }
  function reveal() {
    selectPane('files');
    if (!root || !currentPath.toLocaleLowerCase().startsWith(root.replace(/[\\/]$/, '').toLocaleLowerCase() + '\\')) return;
    const relative = currentPath.slice(root.replace(/[\\/]$/, '').length + 1).split('\\'); relative.pop();
    let parent = root.replace(/[\\/]$/, '');
    for (const segment of relative) { parent += '\\' + segment; expanded.add(parent); request(parent); }
    selectedPath = currentPath; render();
    [...tree.querySelectorAll<HTMLElement>('[data-path]')].find(row => equal(row.dataset.path!, currentPath))?.scrollIntoView({ block: 'nearest' });
  }
  files.querySelectorAll<HTMLElement>('[data-folder]').forEach(b => b.onclick = () => {
    const action = b.dataset.folder; if (action === 'refresh') reset(); else if (action === 'reveal') reveal(); else command('openFolder');
  });
  excluded.onchange = reset; filter.oninput = render;
  rootLabel.onclick = () => { if (root) command('copySelectedPath', root); };
  function render() {
    const focused = (document.activeElement as HTMLElement)?.dataset.path;
    tree.replaceChildren(); rootLabel.textContent = root.split(/[\\/]/).filter(Boolean).at(-1) ?? t('폴더를 열어주세요.'); rootLabel.title = root;
    if (!root) { tree.textContent = t('폴더를 열어 프로젝트 파일을 탐색하세요.'); return; }
    const query = filter.value.toLocaleLowerCase();
    const add = (path: string, depth: number) => {
      const data = cache.get(path);
      if (!data) { request(path); const loading = document.createElement('p'); loading.className = 'folder-message'; loading.textContent = t('읽는 중…'); tree.append(loading); return; }
      for (const entry of data.entries) {
        if (query && !entry.directory && !entry.name.toLocaleLowerCase().includes(query)) continue;
        const row = document.createElement('div'); row.className = 'file-tree-row'; row.setAttribute('role', 'treeitem'); row.setAttribute('aria-level', String(depth + 1)); row.tabIndex = 0; row.dataset.path = entry.path; row.title = entry.path;
        row.style.paddingLeft = `${10 + depth * 15}px`; row.setAttribute('aria-selected', String(equal(selectedPath || currentPath, entry.path)));
        const open = expanded.has(entry.path);
        const caret = document.createElement('span'); caret.className = 'file-caret'; caret.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span'); label.textContent = entry.name; row.append(caret, label);
        const toggle = () => { if (!entry.directory || entry.link) return; if (expanded.has(entry.path)) expanded.delete(entry.path); else { expanded.add(entry.path); request(entry.path); } render(); };
        if (entry.directory && !entry.link) {
          row.setAttribute('aria-expanded', String(open));
          caret.innerHTML = chevronIcon(rightChevron);
          caret.onclick = e => { e.stopPropagation(); row.focus(); toggle(); };
          caret.ondblclick = e => e.stopPropagation();
        } else if (entry.directory && entry.link) {
          caret.textContent = '↗';
          row.title += '\n' + t('연결 폴더는 순환 탐색 방지를 위해 펼치지 않습니다.');
        }
        const activate = () => { if (entry.directory) toggle(); else command('openPath', entry.path); };
        row.onclick = () => { selectedPath = entry.path; tree.querySelectorAll<HTMLElement>('[data-path]').forEach(r => r.setAttribute('aria-selected', String(r === row))); };
        row.ondblclick = activate; row.oncontextmenu = e => { e.preventDefault(); command('copySelectedPath', entry.path); };
        row.onkeydown = e => {
          if (e.key === 'Enter') { e.preventDefault(); activate(); }
          else if (e.ctrlKey && e.key.toLowerCase() === 'c') { e.preventDefault(); command('copySelectedPath', entry.path); }
          else if (e.key === 'ArrowRight' && entry.directory && !open || e.key === 'ArrowLeft' && open) { e.preventDefault(); toggle(); }
          else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const rows = [...tree.querySelectorAll<HTMLElement>('[data-path]')]; const i = rows.indexOf(row); rows[e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : i + (e.key === 'ArrowDown' ? 1 : -1)]?.focus(); }
        };
        tree.append(row); if (entry.directory && open && !entry.link) add(entry.path, depth + 1);
      }
      if (data.error) { const message = document.createElement('p'); message.className = 'folder-message'; message.textContent = data.error; tree.append(message); }
    };
    add(root, 0); if (!tree.childElementCount) tree.textContent = t('표시할 파일이 없습니다.');
    if (focused) [...tree.querySelectorAll<HTMLElement>('[data-path]')].find(row => row.dataset.path === focused)?.focus();
  }
  function updateExternalNotice() {
    for (const [id, version] of dismissed) {
      if (!entries.some(tab => tab.id === id && tab.externalVersion === version)) dismissed.delete(id);
    }
    const tab = entries.find(item => item.id === currentId);
    banner.hidden = !tab?.external || dismissed.has(currentId);
    if (!tab || banner.hidden) return;
    const deleted = tab.externalVersion === 'deleted';
    action.hidden = deleted && tab.kind === 'image';
    const label = deleted ? t('디스크에서 파일이 삭제되었습니다.') : t('파일이 외부에서 변경되었습니다.');
    if (message.textContent !== label) message.textContent = label;
    keep.hidden = deleted || !tab.dirty;
    action.textContent = deleted ? t('다른 이름으로 저장') : tab.dirty ? t('내 변경을 버리고 다시 읽기') : t('다시 읽기');
    keep.onclick = () => {
      dismissed.set(tab.id, tab.externalVersion); banner.hidden = true;
      document.querySelector<HTMLElement>(document.getElementById('source-editor')!.hidden ? '.ProseMirror' : '.cm-content')?.focus();
    };
    action.onclick = () => send({ type: 'command', documentId: tab.id, name: deleted ? 'saveAs' : 'reload', path: tab.dirty && !deleted ? 'discard' : '' });
  }
  let focusedId = '';
  function focusTab(index: number) {
    const button = tabs.children[index]?.querySelector<HTMLButtonElement>('.tab-select');
    if (!button) return;
    button.focus({preventScroll:true}); tabs.children[index].scrollIntoView({block:'nearest', inline:'nearest'});
  }
  function moveTab(delta: number) {
    const index = entries.findIndex(item => item.id === focusedId);
    focusTab((index + delta + entries.length) % entries.length);
  }
  prev.onclick = () => moveTab(-1);
  next.onclick = () => moveTab(1);
  function fitMenu() {
    list.style.setProperty('--available-height', `${Math.max(0, window.innerHeight - strip.getBoundingClientRect().bottom - 4)}px`);
  }
  function showMenu(open: boolean) {
    list.hidden = !open; toggle.setAttribute('aria-expanded', String(open));
    if (open) { fitMenu(); list.querySelector<HTMLButtonElement>('[aria-checked=true]')?.focus(); }
  }
  toggle.onclick = () => showMenu(list.hidden);
  toggle.onkeydown = e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); showMenu(true); }
  };
  list.onkeydown = e => {
    if (e.key === 'Escape' || (e.key === 'Tab' && !e.ctrlKey)) {
      if (e.key === 'Escape') e.preventDefault();
      showMenu(false); toggle.focus(); return;
    }
    const index = [...list.children].indexOf(document.activeElement!);
    const positions: Record<string, number> = { ArrowDown:index + 1, ArrowUp:index - 1, Home:0, End:list.children.length - 1 };
    if (Object.hasOwn(positions, e.key)) {
      e.preventDefault();
      const pos = (positions[e.key] + list.children.length) % list.children.length;
      (list.children[pos] as HTMLElement)?.focus();
    }
  };
  document.addEventListener('pointerdown', e => { if (!list.hidden && !list.contains(e.target as Node) && !toggle.contains(e.target as Node)) showMenu(false); });
  document.addEventListener('focusin', e => {
    if (!strip.contains(e.target as Node)) focusedId = currentId;
    if (!list.hidden && !list.contains(e.target as Node) && e.target !== toggle) showMenu(false);
  });
  window.addEventListener('resize', () => { if (!list.hidden) fitMenu(); });
  function renderTabs(changedDocument: boolean) {
    const key = JSON.stringify([entries, currentId]); if (key === tabKey) return; tabKey = key;
    updateExternalNotice();
    const restoreTabFocus = tabs.contains(document.activeElement);
    const menuFocusId = (document.activeElement as HTMLElement)?.dataset.fileId;
    if (changedDocument || !entries.some(item => item.id === focusedId)) focusedId = currentId;
    if (changedDocument || !entries.length) showMenu(false);
    tabs.replaceChildren(); list.replaceChildren();
    for (const item of entries) {
      const row = document.createElement('div'); row.className = 'document-tab'; row.dataset.tabId = item.id; row.classList.toggle('active', item.id === currentId);
      const select = document.createElement('button'); select.className = 'tab-select'; select.setAttribute('role', 'tab'); select.setAttribute('aria-selected', String(item.id === currentId)); select.tabIndex = item.id === currentId ? 0 : -1;
      const duplicate = entries.filter(x => x.name.toLocaleLowerCase() === item.name.toLocaleLowerCase()).length > 1;
      const parent = item.path.split(/[\\/]/).slice(-2, -1)[0] ?? '';
      const filename = document.createElement('span'); filename.className = 'tab-name';
      filename.textContent = duplicate && parent ? `${item.name} — ${parent}` : item.name;
      select.append(tabIcon(item), filename);
      if (item.dirty) select.append('●');
      if (item.external) select.append('⚠');
      row.title = [item.name, item.path, item.external && t('외부 변경 · 다시 읽기 또는 저장 시 확인')].filter(Boolean).join('\n');
      select.onclick = () => command('activateTab', item.id);
      select.onfocus = () => { focusedId = item.id; };
      select.onkeydown = e => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); moveTab(e.key === 'ArrowLeft' ? -1 : 1); }
        else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); focusTab(e.key === 'Home' ? 0 : entries.length - 1); }
      };
      const close = document.createElement('button'); close.className = 'tab-close'; close.textContent = '×'; close.setAttribute('aria-label', `${t('탭 닫기')}: ${item.name}`); close.onclick = () => command('closeTab', item.id);
      row.append(select, close); tabs.append(row);
      const option = document.createElement('button'); option.tabIndex = -1; option.dataset.fileId = item.id;
      option.setAttribute('role', 'menuitemradio'); option.setAttribute('aria-checked', String(item.id === currentId));
      option.title = item.path || item.name;
      option.append(tabIcon(item), filename.cloneNode(true));
      if (item.dirty) option.append('●');
      option.onclick = () => { showMenu(false); toggle.focus(); command('activateTab', item.id); };
      list.append(option);
    }
    prev.disabled = next.disabled = entries.length < 2; toggle.disabled = !entries.length;
    if (restoreTabFocus) focusTab(entries.findIndex(item => item.id === focusedId));
    else if (changedDocument) tabs.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (!list.hidden) {
      const options = [...list.querySelectorAll('button')];
      (options.find(option => option.dataset.fileId === menuFocusId) ?? options.find(option => option.dataset.fileId === currentId))?.focus();
    }
  }
  document.addEventListener('keydown', e => {
    if (e.isComposing || document.querySelector('dialog[open]') || !e.ctrlKey) return;
    if (e.key.toLowerCase() === 'w') { e.preventDefault(); e.stopImmediatePropagation(); command('closeTab', currentId); }
    else if (e.key === 'Tab' && entries.length) { e.preventDefault(); e.stopImmediatePropagation(); const i = entries.findIndex(x => x.id === currentId); command('activateTab', entries[(i + (e.shiftKey ? entries.length - 1 : 1)) % entries.length].id); }
    else if (e.key.toLowerCase() === 'g' && document.documentElement.dataset.documentKind === 'text') { e.preventDefault(); e.stopImmediatePropagation(); document.querySelector<HTMLButtonElement>('.text-tools button:last-child')?.click(); }
  }, true);
  return (packet: Packet) => {
    if (packet.type === 'hostState') {
      shell.querySelector<HTMLButtonElement>('[data-host-command="save"]')!.disabled = packet.kind === 'image';
      const changedDocument = currentId !== packet.documentId;
      entries = packet.tabs ?? []; currentId = packet.documentId ?? ''; currentPath = packet.path ?? ''; renderTabs(changedDocument);
      if (packet.root !== root) { root = packet.root ?? ''; expanded.clear(); reset(); }
      if (packet.kind === 'text' || packet.kind === 'image') {
        outline.querySelector<HTMLElement>('#host-empty')!.textContent = packet.kind === 'image' ? t('이미지에는 목차가 없습니다.') : t('Text 파일에는 목차가 없습니다.');
        if (changedDocument && pane === 'outline') selectPane('files');
      }
      tree.querySelectorAll<HTMLElement>('[data-path]').forEach(row => row.classList.toggle('current-file', equal(row.dataset.path!, currentPath)));
    } else if (packet.type === 'folderRoot') { root = packet.root; expanded.clear(); reset(); selectPane('files'); }
    else if (packet.type === 'folderEntries' && equal(packet.root, root) && pending.get(packet.path) === packet.requestId) { pending.delete(packet.path); cache.set(packet.path, { entries: packet.entries, error: packet.error }); render(); }
  };
}
