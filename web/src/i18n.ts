import english from './locales/en.json';

export type Language = 'ko' | 'en';
export const language: Language = typeof location !== 'undefined' && new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'ko';
const catalog: Record<string, string> = english;
export function t(key: string): string { return language === 'en' ? catalog[key] ?? key : key; }
export function tr(parts: TemplateStringsArray, ...values: unknown[]): string {
  const key = parts.reduce((s, part, i) => s + (i ? '${' + (i - 1) + '}' : '') + part, '');
  return t(key).replace(/\$\{(\d+)\}/g, (_, i) => String(values[Number(i)]));
}

// Only call on application-owned chrome before user content is inserted.
// Never traverse the document, file paths, outline labels, or an editor instance.
export function translateUi(root: ParentNode) {
  if (language !== 'en') return;
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent ?? '', key = value.trim();
      if (catalog[key]) node.textContent = value.replace(key, catalog[key]);
    } else if (node instanceof Element) {
      if (node.matches('script,style,#rendered-editor,#source-editor')) return;
      for (const attr of ['title', 'aria-label', 'placeholder', 'value']) {
        const value = node.getAttribute(attr); if (value && catalog[value]) node.setAttribute(attr, catalog[value]);
      }
    }
    node.childNodes.forEach(visit);
  };
  root.childNodes.forEach(visit);
}
export function uiHtml(markup: string): string {
  if (language !== 'en') return markup;
  const template = document.createElement('template'); template.innerHTML = markup;
  translateUi(template.content); return template.innerHTML;
}
