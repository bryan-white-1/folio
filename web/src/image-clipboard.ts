const maxBytes = 20 * 1024 * 1024;
const supported = /\.(png|jpe?g|gif|webp|bmp)$/i;
const imageType = /^image\/(png|jpeg|gif|webp|bmp|x-ms-bmp)$/i;

export function installImageClipboard(actions: {
  begin(): Promise<string | undefined>;
  send(requestId: string, images: string[]): void;
  cancel(requestId: string): void;
  notify(message: string): void;
}) {
  document.addEventListener('paste', event => {
    if (!(event.target instanceof Element) || !event.target.closest('.ProseMirror, .cm-content')) return;
    const files = Array.from(event.clipboardData?.files ?? []);
    if (!files.length) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (files.some(file => !supported.test(file.name) && !imageType.test(file.type))) {
      actions.notify('PNG·JPEG·GIF·WebP·BMP 이미지 파일을 붙여넣으세요.'); return;
    }
    if (files.length > 16 || files.reduce((sum, file) => sum + file.size, 0) > maxBytes) {
      actions.notify('이미지는 한 번에 16개·합계 20MB 이하로 삽입하세요.'); return;
    }
    void (async () => {
      const requestId = await actions.begin();
      if (!requestId) return;
      try {
        const images = await Promise.all(files.map(file => new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = () => reject(reader.error);
          reader.onabort = () => reject(new Error('이미지 읽기 취소'));
          reader.readAsDataURL(file);
        })));
        actions.send(requestId, images);
      } catch {
        actions.cancel(requestId); actions.notify('클립보드 이미지를 읽지 못했습니다. 다시 붙여넣으세요.');
      }
    })();
  }, true);
}
