import { t } from './i18n';

const scales = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

export function installImagePreview() {
  const panel = document.getElementById('image-preview')!;
  const viewport = panel.querySelector<HTMLElement>('.image-viewport')!;
  const info = document.getElementById('image-info')!;
  const fit = document.querySelector<HTMLButtonElement>('#image-fit')!;
  const original = document.querySelector<HTMLButtonElement>('#image-original')!;
  const zoomIn = document.querySelector<HTMLButtonElement>('#image-zoom-in')!;
  const zoomOut = document.querySelector<HTMLButtonElement>('#image-zoom-out')!;
  const percent = document.querySelector<HTMLInputElement>('#image-zoom')!;
  const manualScales = new Map<string, number>();
  let image: HTMLImageElement | undefined;
  let activeId = '';
  let scale = 1;
  let editingPercent = false;

  function layout() {
    const manual = manualScales.get(activeId);
    viewport.classList.toggle('fit-size', manual === undefined);
    fit.setAttribute('aria-pressed', String(manual === undefined));
    original.setAttribute('aria-pressed', String(manual === 1));
    const ready = !!image?.naturalWidth && !!image.naturalHeight;
    percent.disabled = fit.disabled = original.disabled = !ready;
    if (!image || !ready) {
      percent.value = '';
      zoomIn.disabled = zoomOut.disabled = true;
      return;
    }
    const padding = getComputedStyle(viewport);
    const width = viewport.clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight);
    const height = viewport.clientHeight - parseFloat(padding.paddingTop) - parseFloat(padding.paddingBottom);
    scale = manual ?? Math.min(1, Math.max(1, width) / image.naturalWidth, Math.max(1, height) / image.naturalHeight);
    image.style.width = `${image.naturalWidth * scale}px`;
    if (!editingPercent) {
      const value = manual === undefined ? (scale * 100).toFixed(1) : (scale * 100).toPrecision(12);
      percent.value = `${Number(value)}%`;
    }
    zoomIn.disabled = scale >= scales[scales.length - 1];
    zoomOut.disabled = scale <= scales[0];
  }
  function setScale(value: number, point?: MouseEvent) {
    if (!image?.naturalWidth) return;
    const area = viewport.getBoundingClientRect(), before = image.getBoundingClientRect();
    const x = point?.clientX ?? area.left + viewport.clientWidth / 2;
    const y = point?.clientY ?? area.top + viewport.clientHeight / 2;
    const u = (x - before.left) / before.width, v = (y - before.top) / before.height;
    manualScales.set(activeId, value);
    editingPercent = false;
    percent.setCustomValidity('');
    layout();
    const after = image.getBoundingClientRect();
    viewport.scrollBy(after.left + u * after.width - x, after.top + v * after.height - y);
  }
  function step(increase: boolean, point?: MouseEvent) {
    const next = increase ? scales.find(s => s > scale) : scales.findLast(s => s < scale);
    if (next !== undefined) setScale(next, point);
  }
  fit.onclick = () => { manualScales.delete(activeId); layout(); viewport.scrollTo(0, 0); };
  original.onclick = () => setScale(1);
  zoomIn.onclick = () => step(true);
  zoomOut.onclick = () => step(false);
  function commitPercent(showError: boolean) {
    if (!editingPercent) return;
    const match = /^(\d+(?:\.\d*)?)\s*%?$/.exec(percent.value.trim());
    const value = match ? Number(match[1]) / 100 : NaN;
    if (value >= scales[0] && value <= scales[scales.length - 1]) {
      setScale(value);
    } else if (showError) {
      percent.setCustomValidity(t('10~400 사이의 숫자를 입력하세요.'));
      percent.reportValidity();
      percent.select();
    } else {
      editingPercent = false;
      percent.setCustomValidity('');
      layout();
    }
  }
  percent.onfocus = () => percent.select();
  percent.oninput = () => { editingPercent = true; percent.setCustomValidity(''); };
  percent.onblur = () => commitPercent(false);
  percent.onkeydown = event => {
    if (event.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      commitPercent(true);
      if (!editingPercent) viewport.focus({preventScroll:true});
    } else if (event.key === 'Escape') {
      event.preventDefault();
      editingPercent = false;
      percent.setCustomValidity('');
      layout();
      viewport.focus({preventScroll:true});
    }
  };
  viewport.addEventListener('wheel', event => {
    if (!event.ctrlKey || !event.deltaY) return;
    event.preventDefault();
    step(event.deltaY < 0, event);
  }, { passive: false });
  new ResizeObserver(() => { if (image && !manualScales.has(activeId)) layout(); }).observe(viewport);

  return {
    show(id: string, name: string, url: string) {
      editingPercent = false;
      percent.setCustomValidity('');
      activeId = id;
      const img = new Image();
      image = img;
      img.alt = name;
      img.onload = () => {
        if (img.parentElement !== viewport) return;
        info.textContent = `${img.naturalWidth} × ${img.naturalHeight} px`;
        layout();
      };
      img.onerror = () => {
        if (img.parentElement !== viewport) return;
        img.hidden = true;
        info.textContent = t('이미지를 표시할 수 없습니다.');
      };
      info.textContent = '';
      viewport.replaceChildren(img);
      panel.hidden = false;
      layout();
      viewport.scrollTo(0, 0); viewport.focus({preventScroll:true});
      img.src = url;
    },
    hide() { panel.hidden = true; image = undefined; viewport.replaceChildren(); activeId = ''; },
    discard(id: string) { manualScales.delete(id); },
  };
}
