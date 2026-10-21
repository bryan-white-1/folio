export const defaultFontFamily = 'Malgun Gothic';
export const fontFamilies = ['Malgun Gothic', 'Gulim', 'Dotum', 'Batang', 'Gungsuh', 'Noto Sans KR', 'Noto Serif KR', 'NanumGothic', 'NanumMyeongjo', 'Pretendard'];

export function validFontFamily(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 128 && !/["'\\;{}\u0000-\u001f\u007f]/.test(value);
}

export function applyFontFamily(value: unknown) {
  const family = validFontFamily(value) ? value.trim() : defaultFontFamily;
  document.documentElement.style.setProperty('--document-font', `"${family}", "Malgun Gothic", sans-serif`);
}
