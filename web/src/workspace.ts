import { t, uiHtml } from './i18n';
type Packet = { type: string; [key: string]: any };
type Tab = { id: string; path: string; name: string; kind: string; dirty: boolean; external: boolean };
type Entry = { path: string; name: string; directory: boolean; link: boolean };
export function installWorkspace(shell: HTMLElement, send: (p: Packet) => void) {
  const command = (name: string, path = '') => send({ type: 'command', name, path });
  const strip = document.createElement('div'); strip.className = 'document-tabs';
  const tabs = document.createElement('div'); tabs.className = 'tab-items'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', t('열린 파일'));
  const list = document.createElement('select'); list.className = 'open-file-list'; list.setAttribute('aria-label', t('열린 파일 목록')); list.onchange = () => command('activateTab', list.value);
  strip.append(tabs, list); document.getElementById('app')!.prepend(strip);
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
        const open = expanded.has(entry.path), caret = document.createElement('button'); caret.tabIndex = -1; caret.className = 'file-caret'; caret.textContent = entry.directory ? entry.link ? '↗' : open ? '⌄' : '›' : '·'; caret.setAttribute('aria-label', t('펼치기 / 접기'));
        const label = document.createElement('span'); label.textContent = entry.name; row.append(caret, label);
        const toggle = () => { if (!entry.directory || entry.link) return; if (expanded.has(entry.path)) expanded.delete(entry.path); else { expanded.add(entry.path); request(entry.path); } render(); };
        if (entry.directory) { row.setAttribute('aria-expanded', String(open)); caret.onclick = e => { e.stopPropagation(); toggle(); }; }
        if (entry.link && entry.directory) row.title += '\n' + t('연결 폴더는 순환 탐색 방지를 위해 펼치지 않습니다.');
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
  function renderTabs() {
    const key = JSON.stringify([entries, currentId]); if (key === tabKey) return; tabKey = key;
    const focusId = (document.activeElement as HTMLElement)?.closest<HTMLElement>('[data-tab-id]')?.dataset.tabId;
    tabs.replaceChildren(); list.replaceChildren();
    for (const item of entries) {
      const row = document.createElement('div'); row.className = 'document-tab'; row.dataset.tabId = item.id; row.classList.toggle('active', item.id === currentId);
      const select = document.createElement('button'); select.className = 'tab-select'; select.setAttribute('role', 'tab'); select.setAttribute('aria-selected', String(item.id === currentId)); select.tabIndex = item.id === currentId ? 0 : -1;
      const duplicate = entries.filter(x => x.name.toLocaleLowerCase() === item.name.toLocaleLowerCase()).length > 1;
      const parent = item.path.split(/[\\/]/).slice(-2, -1)[0] ?? '';
      select.textContent = `${item.kind === 'markdown' ? 'M↓' : '</>'}  ${item.name}${duplicate && parent ? ' — ' + parent : ''}${item.dirty ? ' ●' : ''}${item.external ? ' ⚠' : ''}`;
      select.title = (item.path || item.name) + (item.external ? '\n' + t('외부 변경 · 다시 읽기 또는 저장 시 확인') : ''); select.onclick = () => command('activateTab', item.id);
      select.onkeydown = e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const i = entries.indexOf(item); const next = entries[e.key === 'Home' ? 0 : e.key === 'End' ? entries.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : entries.length - 1)) % entries.length]; command('activateTab', next.id); } };
      const close = document.createElement('button'); close.className = 'tab-close'; close.textContent = '×'; close.setAttribute('aria-label', `${t('탭 닫기')}: ${item.name}`); close.onclick = () => command('closeTab', item.id);
      row.append(select, close); tabs.append(row);
      const option = document.createElement('option'); option.value = item.id; option.textContent = `${item.dirty ? '● ' : ''}${item.path || item.name}`; list.append(option);
    }
    list.value = currentId; list.hidden = !entries.length;
    const active = [...tabs.children].find(row => (row as HTMLElement).dataset.tabId === currentId) as HTMLElement | undefined;
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); if (focusId) active?.querySelector<HTMLElement>('.tab-select')?.focus();
  }
  document.addEventListener('keydown', e => {
    if (e.isComposing || document.querySelector('dialog[open]') || !e.ctrlKey) return;
    if (e.key.toLowerCase() === 'w') { e.preventDefault(); e.stopImmediatePropagation(); command('closeTab', currentId); }
    else if (e.key === 'Tab' && entries.length) { e.preventDefault(); e.stopImmediatePropagation(); const i = entries.findIndex(x => x.id === currentId); command('activateTab', entries[(i + (e.shiftKey ? entries.length - 1 : 1)) % entries.length].id); }
    else if (e.key.toLowerCase() === 'g' && document.documentElement.dataset.documentKind === 'text') { e.preventDefault(); e.stopImmediatePropagation(); document.querySelector<HTMLButtonElement>('.text-tools button:last-child')?.click(); }
  }, true);
  return (packet: Packet) => {
    if (packet.type === 'hostState') {
      const changedDocument = currentId !== packet.documentId;
      entries = packet.tabs ?? []; currentId = packet.documentId ?? ''; currentPath = packet.path ?? ''; renderTabs();
      if (packet.root !== root) { root = packet.root ?? ''; expanded.clear(); reset(); }
      if (packet.kind === 'text') { outline.querySelector<HTMLElement>('#host-empty')!.textContent = t('Text 파일에는 목차가 없습니다.'); if (changedDocument && pane === 'outline') selectPane('files'); }
      tree.querySelectorAll<HTMLElement>('[data-path]').forEach(row => row.classList.toggle('current-file', equal(row.dataset.path!, currentPath)));
    } else if (packet.type === 'folderRoot') { root = packet.root; expanded.clear(); reset(); selectPane('files'); }
    else if (packet.type === 'folderEntries' && equal(packet.root, root) && pending.get(packet.path) === packet.requestId) { pending.delete(packet.path); cache.set(packet.path, { entries: packet.entries, error: packet.error }); render(); }
  };
}
