import { describe, it, expect } from 'vitest';
import { DocumentModel } from '../src/document';
import { documentKind, detectLanguage } from '../src/text-language';
describe('text files', () => {
  it('detects file type and language without treating unknown extensions as Markdown', () => {
    expect(documentKind('README.MD')).toBe('markdown'); expect(documentKind('notes.txt')).toBe('text');
    for (const [name, lang] of [['a.py','python'],['a.json','json'],['a.java','java'],['a.c','c'],['a.hpp','cpp'],['.env','plain'],['Dockerfile','plain']]) expect(detectLanguage(name)).toBe(lang);
  });
  it('preserves mixed newlines, whitespace, final newline absence and undo/redo', () => {
    const m = new DocumentModel(); m.preserveEndings = true; const original = 'a  \r\nb\nc\rd\t'; m.load(original);
    expect(m.fileText()).toBe(original);
    m.change('alpha  \nb\nc\nd\t', 'source', 5, 1, [{from:0,to:1,insert:'alpha'}]);
    expect(m.fileText()).toBe('alpha  \r\nb\nc\rd\t'); expect(m.dirty).toBe(true);
    m.undo(); expect(m.fileText()).toBe(original); expect(m.dirty).toBe(false);
    m.redo(); expect(m.fileText()).toBe('alpha  \r\nb\nc\rd\t');
  });
  it('maps separated edits against original coordinates and restores removed newlines', () => {
    const m = new DocumentModel(); m.preserveEndings = true; m.load('a\r\nb\nc\r\nd');
    m.change('A\n\nb\nC\nd', 'source', 1, 1, [{from:0,to:1,insert:'A\n'},{from:4,to:5,insert:'C'}]);
    expect(m.fileText()).toBe('A\r\n\r\nb\nC\r\nd'); m.breakGroup();
    m.change('Ab\nC\nd', 'source', 1, 2, [{from:1,to:3,insert:''}]); expect(m.fileText()).toBe('Ab\nC\r\nd');
    m.undo(); expect(m.fileText()).toBe('A\r\n\r\nb\nC\r\nd'); m.undo(); expect(m.fileText()).toBe('a\r\nb\nc\r\nd');
  });
});
