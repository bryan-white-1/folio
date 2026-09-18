import type { MermaidConfig } from 'mermaid';

export interface Diagram { svg: string; width: number; height: number }
export class DiagramError extends Error {
  constructor(message: string, public readonly kind = 'error') { super(message); }
}
let sequence = 0;
let epoch = 0;
let queue: Promise<unknown> = Promise.resolve();
let library: Promise<typeof import('mermaid')> | undefined;
const cache = new Map<string, Diagram>();
let cacheBytes = 0;
export const diagramEvents = new EventTarget();
export const diagramTheme = () => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
export function refreshDiagrams(reset = false) {
  if (reset) { epoch++; cache.clear(); cacheBytes = 0; }
  diagramEvents.dispatchEvent(new Event(reset ? 'reset' : 'theme'));
}

function configuration(dark: boolean): MermaidConfig {
  const paper = dark ? '#202927' : '#ffffff';
  const text = dark ? '#e1e9e5' : '#1f2937';
  const line = dark ? '#a0b5ab' : '#6b7280';
  return {
    startOnLoad: false, securityLevel: 'strict', htmlLabels: false,
    suppressErrorRendering: true, maxTextSize: 20_000, maxEdges: 200,
    theme: 'base', look: 'classic', layout: 'dagre',
    fontFamily: 'Segoe UI, Malgun Gothic, sans-serif',
    themeVariables: {
      darkMode: dark, background: paper, primaryColor: paper, primaryTextColor: text,
      primaryBorderColor: dark ? '#53665e' : '#e5e7eb', lineColor: line,
      secondaryColor: dark ? '#293630' : '#f9fafb', tertiaryColor: paper,
      clusterBkg: dark ? '#25312b' : '#ffffff', clusterBorder: dark ? '#53665e' : '#e5e7eb',
      edgeLabelBackground: paper, fontFamily: 'Segoe UI, Malgun Gothic, sans-serif', fontSize: '16px',
      actorBkg: paper, actorBorder: line, actorTextColor: text, actorLineColor: line,
      signalColor: line, signalTextColor: text, labelBoxBkgColor: paper, labelTextColor: text,
    },
    flowchart: { theme: 'base', look: 'classic', layout: 'dagre', curve: 'basis', nodeSpacing: 36, rankSpacing: 56, padding: 16, wrappingWidth: 280, minNodeWidth: 0, useMaxWidth: false },
    sequence: { theme: 'base', look: 'classic', useMaxWidth: false },
    class: { theme: 'base', look: 'classic', layout: 'dagre', useMaxWidth: false },
    state: { theme: 'base', look: 'classic', layout: 'dagre', useMaxWidth: false },
    er: { theme: 'base', look: 'classic', layout: 'dagre', useMaxWidth: false },
  };
}

// Only inert SVG survives; CSS is scoped further by a ShadowRoot at display time.
async function cleanSvg(raw: string): Promise<Diagram> {
  const { default: purify } = await import('dompurify');
  const clean = purify.sanitize(raw, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['foreignObject', 'image', 'a', 'script', 'animate', 'set', 'animateMotion', 'animateTransform'],
  });
  const doc = new DOMParser().parseFromString(clean, 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.localName !== 'svg' || doc.querySelector('parsererror')) throw new Error('SVG를 읽을 수 없습니다.');
  for (const element of [svg, ...svg.querySelectorAll('*')]) {
    for (const attr of [...element.attributes]) {
      if (/^on/i.test(attr.name) || (/^(href|xlink:href)$/i.test(attr.name) && !attr.value.startsWith('#'))) element.removeAttribute(attr.name);
      else if (/url\s*\(/i.test(attr.value) && /url\s*\(\s*['"]?(?!#)/i.test(attr.value)) {
        // Keep fragment marker references, discard every non-local resource.
        element.setAttribute(attr.name, attr.value.replace(/url\s*\(([^)]*)\)/gi, (_, target: string) => /^['"]?#[\w:.-]+['"]?$/.test(target.trim()) ? `url(${target})` : 'none'));
      }
    }
  }
  for (const style of svg.querySelectorAll('style')) {
    const css = style.textContent ?? '';
    // Parse detached CSS: remove at-rules (imports/fonts/animations), retain ordinary
    // Mermaid rules. Dropping the whole sheet would discard its essential SVG fills.
    const sheet = new CSSStyleSheet(); sheet.replaceSync(css);
    style.textContent = [...sheet.cssRules].filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule).map(rule => {
      for (const property of [...rule.style]) {
        const value = rule.style.getPropertyValue(property);
        if (/[\\@]/.test(value)) rule.style.removeProperty(property);
        else rule.style.setProperty(property, value.replace(/url\s*\(([^)]*)\)/gi, (_, target: string) => /^['"]?#[\w:.-]+['"]?$/.test(target.trim()) ? `url(${target})` : 'none'), rule.style.getPropertyPriority(property));
      }
      return rule.cssText;
    }).join('\n');
  }
  const box = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  for (const rect of svg.querySelectorAll('.node rect[rx]')) {
    const radius = Number(rect.getAttribute('rx'));
    if (radius > 0 && radius <= 8) { rect.setAttribute('rx', '10'); rect.setAttribute('ry', '10'); }
  }
  const width = box?.[2] ?? 0, height = box?.[3] ?? 0;
  if (!(width > 0 && height > 0 && Number.isFinite(width + height))) throw new Error('다이어그램 크기를 계산할 수 없습니다.');
  svg.setAttribute('role', 'img');
  if (!svg.hasAttribute('aria-label') && !svg.hasAttribute('aria-labelledby')) svg.setAttribute('aria-label', 'Mermaid 다이어그램');
  return { svg: new XMLSerializer().serializeToString(svg), width, height };
}

export function renderDiagram(source: string, theme: string, current: () => boolean): Promise<Diagram> {
  const requestEpoch = epoch;
  const task = async () => {
    if (requestEpoch !== epoch || !current()) throw new DiagramError('취소됨', 'cancelled');
    if (source.length > 20_000) throw new DiagramError('20,000자를 초과했습니다. 원문 모드에서 확인해주세요.', 'limited');
    if (!source.trim()) throw new DiagramError('Mermaid 구문을 입력해주세요.');
    if (/@\{[^}]*\b(?:img|icon)\s*:/i.test(source)) throw new DiagramError('이미지·외부 아이콘 노드는 지원하지 않습니다.', 'unsupported');
    const key = `${theme}\0${source}`;
    const cached = cache.get(key);
    if (cached) { cache.delete(key); cache.set(key, cached); return cached; }
    // Custom CSS resource loading is not part of diagram notation supported here.
    if (/(?:classDef|style|linkStyle)\s+[^\n]*(?:url\s*\(|[\\@{}<>])/i.test(source)) throw new DiagramError('외부 리소스 또는 실행 가능한 스타일은 지원하지 않습니다.');
    library ??= import('mermaid').catch(error => { library = undefined; throw error; });
    const mermaid = (await library).default;
    await document.fonts.ready;
    if (requestEpoch !== epoch || !current()) throw new DiagramError('취소됨', 'cancelled');
    const config = configuration(theme === 'dark');
    config.secure = [...new Set([...Object.keys(mermaid.mermaidAPI.defaultConfig), ...Object.keys(config), 'secure', 'themeCSS', 'dompurifyConfig'])];
    mermaid.initialize(config);
    const parsed = await mermaid.parse(source);
    if (!parsed || !['flowchart', 'flowchart-v2', 'sequence', 'class', 'classDiagram', 'state', 'stateDiagram', 'er'].includes(parsed.diagramType)) {
      throw new DiagramError('현재는 흐름도·시퀀스·클래스·상태·ER 다이어그램을 지원합니다.', 'unsupported');
    }
    const stage = document.createElement('div'); stage.className = 'mermaid-stage';
    stage.setAttribute('aria-hidden', 'true'); document.body.append(stage);
    try {
      const { svg } = await mermaid.render(`folio-render-${++sequence}`, source, stage);
      const result = await cleanSvg(svg);
      if (requestEpoch !== epoch || !current()) throw new DiagramError('취소됨', 'cancelled');
      const size = result.svg.length * 2;
      if (size <= 8_000_000) {
        cache.set(key, result); cacheBytes += size;
        while (cache.size > 24 || cacheBytes > 8_000_000) {
          const oldest = cache.keys().next().value!; cacheBytes -= cache.get(oldest)!.svg.length * 2; cache.delete(oldest);
        }
      }
      return result;
    } finally { stage.remove(); }
  };
  const result = queue.then(task);
  queue = result.catch(() => {});
  return result;
}

export function diagramSvg(diagram: Diagram): SVGSVGElement {
  const svg = new DOMParser().parseFromString(diagram.svg, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
  const prefix = `folio-view-${++sequence}-`;
  const ids = new Map<string, string>();
  for (const el of [svg, ...svg.querySelectorAll('[id]')]) if (el.id) ids.set(el.id, prefix + el.id);
  // Replace each identifier once, including CSS selectors, marker URLs and ARIA IDREFS.
  const escaped = [...ids.keys()].sort((a, b) => b.length - a.length).map(id => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(?<![\\w-])(?:${escaped.join('|')})(?![\\w-])`, 'g');
  const rewrite = (value: string) => value.replace(pattern, id => ids.get(id)!);
  for (const el of [svg, ...svg.querySelectorAll('*')]) {
    for (const attr of [...el.attributes]) el.setAttribute(attr.name, rewrite(attr.value));
    if (el.localName === 'style') el.textContent = rewrite(el.textContent ?? '');
  }
  svg.style.cssText = 'display:block;max-width:100%;height:auto;margin:0 auto;';
  svg.setAttribute('width', String(diagram.width)); svg.removeAttribute('height');
  return document.importNode(svg, true);
}

export function diagramMessage(error: unknown): string {
  if (error instanceof DiagramError) return error.message;
  const message = error instanceof Error ? error.message : String(error);
  if (/max.*edges|edge.*limit|too many edges/i.test(message)) return '연결선 200개 제한을 초과했습니다. 원문 모드에서 확인해주세요.';
  const line = /(?:parse error on line|line)\s+(\d+)/i.exec(message)?.[1];
  return line ? `구문 오류: Mermaid ${line}번째 줄을 확인해주세요.` : '다이어그램을 렌더링할 수 없습니다. 원문 구문을 확인해주세요.';
}
