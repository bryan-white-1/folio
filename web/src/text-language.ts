import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { json } from '@codemirror/lang-json';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';

export const languages = ['plain', 'python', 'json', 'java', 'c', 'cpp', 'markdown'] as const;
export type TextLanguage = typeof languages[number];
export function documentKind(name: string): 'markdown' | 'text' { return /\.(md|markdown)$/i.test(name) ? 'markdown' : 'text'; }
export function detectLanguage(name: string): TextLanguage {
  const ext = name.split('.').at(-1)?.toLowerCase();
  return ({ py: 'python', pyw: 'python', json: 'json', java: 'java', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp', md: 'markdown', markdown: 'markdown' } as Record<string, TextLanguage>)[ext ?? ''] ?? 'plain';
}
export const languageLabels: Record<TextLanguage, string> = { plain: 'Plain Text', python: 'Python', json: 'JSON', java: 'Java', c: 'C', cpp: 'C++', markdown: 'Markdown' };
export function languageExtension(value: TextLanguage) {
  switch (value) { case 'python': return python(); case 'json': return json(); case 'java': return java(); case 'c': case 'cpp': return cpp(); case 'markdown': return markdown(); default: return []; }
}
