import { detectLanguage } from './text-language';

const actions = {
  previous: 'M10 4 6 8l4 4',
  next: 'm6 4 4 4-4 4',
  down: 'm4 6 4 4 4-4',
  close: 'm4 4 8 8m0-8-8 8',
  refresh: 'M13 6a5.2 5.2 0 1 0 .1 3.8M13 2.5V6H9.5',
  reveal: 'M8 1v2m0 10v2M1 8h2m10 0h2M13 8a5 5 0 1 1-10 0 5 5 0 0 1 10 0ZM9.5 8a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z',
  settings: 'm6.8 1.5-.5 1.7-1.2.7-1.8-.3-1.2 2 1.2 1.4v1.9l-1.2 1.4 1.2 2 1.8-.3 1.2.7.5 1.8h2.4l.5-1.8 1.2-.7 1.8.3 1.2-2-1.2-1.4V7l1.2-1.4-1.2-2-1.8.3-1.2-.7-.5-1.7zM10.2 8a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0Z',
  more: 'M3 8h.2M8 8h.2M13 8h.2',
  link: 'M4 12l8-8M6 4h6v6',
} as const;

export function actionIcon(name: keyof typeof actions) {
  return `<svg class="workspace-action-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="${actions[name]}"/></svg>`;
}

const files = {
  markdown: 'M1 3h14v10H1z M3 10V6l2 2 2-2v4m4-4v4m-2-2 2 2 2-2',
  text: 'M3 2h7l3 3v9H3z M9.5 2v3.5H13M5.5 8h5m-5 3h4',
  image: 'M1.5 2.5h13v11h-13z M2 12l4-5 3 3 2-2 3 4M11 5.5h.1',
  code: 'm4.5 4-4 4 4 4m7-8 4 4-4 4m-2-10-3 12',
  json: 'M6 2H5q-2 0-2 2v2q0 2-2 2 2 0 2 2v2q0 2 2 2h1m4-12h1q2 0 2 2v2q0 2 2 2-2 0-2 2v2q0 2-2 2h-1',
  typescript: 'M1 2h14v12H1z M3 6h4m-2 0v5m7-5h-2a1.3 1.3 0 0 0 0 2.5h1a1.3 1.3 0 0 1 0 2.5H9',
  react: 'M15 8a7 2.7 0 1 1-14 0 7 2.7 0 1 1 14 0ZM11.5 14.06a7 2.7 60 1 1-7-12.12 7 2.7 60 1 1 7 12.12ZM4.5 14.06a7 2.7 120 1 1 7-12.12 7 2.7 120 1 1-7 12.12ZM8 8h.1',
} as const;

function fileType(name: string, kind?: string): keyof typeof files {
  if (kind === 'image' || /\.(png|jpe?g|jfif|gif|webp|svg|bmp)$/i.test(name)) return 'image';
  if (kind === 'markdown' || /\.(md|markdown)$/i.test(name)) return 'markdown';
  if (/\.[jt]sx$/i.test(name)) return 'react';
  if (/\.[cm]?ts$/i.test(name)) return 'typescript';
  if (/\.jsonc?$/i.test(name)) return 'json';
  if (detectLanguage(name) !== 'plain' || /\.(css|scss|[cm]js)$/i.test(name)) return 'code';
  return 'text';
}

export function fileIcon(name: string, kind?: string) {
  const type = fileType(name, kind);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', `workspace-file-icon icon-${type}`);
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI!, 'path');
  path.setAttribute('d', files[type]);
  svg.append(path);
  return svg;
}
