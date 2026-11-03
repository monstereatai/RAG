import JSZip from 'jszip';
import { detectDocumentKind, parseDocument } from './document-parser.util';
import { isSafeCodePath } from './code-language.util';

describe('Code RAG parser', () => {
  it.each([
    ['demo.js', 'code'], ['index.tsx', 'code'], ['App.vue', 'code'],
    ['Main.java', 'code'], ['main.go', 'code'], ['app.py', 'code'],
    ['lib.rs', 'code'], ['Program.cs', 'code'], ['project.zip', 'code_archive'],
  ])('routes %s to %s', (filename, kind) => {
    expect(detectDocumentKind(filename)).toBe(kind);
  });

  it.each([
    ['service.ts', 'export class UserService { async getUser(id: string) { return id; } }', 'UserService.getUser'],
    ['service.js', 'function getUser(id) { return id; }', 'getUser'],
    ['component.tsx', 'export function UserCard() { return <div>User</div>; }', 'UserCard'],
    ['main.go', 'package main\nfunc GetUser(id string) string { return id }', 'GetUser'],
    ['Service.java', 'class Service { String getUser(String id) { return id; } }', 'Service.getUser'],
    ['app.py', 'def get_user(id):\n    return id\n', 'get_user'],
  ])('preserves symbols in %s', async (fileName, code, expectedSymbol) => {
    const result = await parseDocument(
      Buffer.from(code, 'utf8'), 'code', undefined, undefined, undefined, { filename: fileName },
    );
    expect(result.status).toBe('complete');
    expect(result.blocks.some((b) => b.metadata?.symbol === expectedSymbol)).toBe(true);
    expect(result.blocks.some((b) => b.metadata?.filePath === fileName)).toBe(true);
  });

  it('parses Vue template, setup script, and scoped styles separately', async () => {
    const vue = `<template><div>{{ name }}</div></template>\n<script setup lang="ts">\nconst name = 'A';\nfunction updateName() { return name; }\n</script>\n<style scoped>.a { color: red; }</style>`;
    const doc = await parseDocument(Buffer.from(vue), 'code', undefined, undefined, undefined, { filename: 'App.vue' });
    expect(doc.blocks.some((b) => b.metadata?.symbolKind === 'component-template')).toBe(true);
    expect(doc.blocks.some((b) => b.metadata?.symbolKind === 'component-style')).toBe(true);
    expect(doc.blocks.some((b) => String(b.metadata?.symbol).includes('updateName'))).toBe(true);
  });

  it('indexes multiple ZIP sources but excludes secrets, dependencies and binary outputs', async () => {
    const zip = new JSZip();
    zip.file('src/user.service.ts', 'export function createUser() { return 1; }');
    zip.file('src/main.go', 'package main\nfunc Main() {}');
    zip.file('node_modules/lib/index.js', 'function shouldNotIndex() {}');
    zip.file('.env', 'API_KEY=not-for-indexing');
    const parsed = await parseDocument(
      await zip.generateAsync({ type: 'nodebuffer' }),
      'code_archive', undefined, undefined, undefined, { filename: 'project.zip' },
    );
    const files = parsed.blocks.map((block) => block.metadata?.filePath);
    expect(files).toContain('src/user.service.ts');
    expect(files).toContain('src/main.go');
    expect(files).not.toContain('.env');
    expect(files).not.toContain('node_modules/lib/index.js');
  });

  it('refuses unsafe paths, binary input and incorrect ZIP containers', async () => {
    expect(isSafeCodePath('../secret.ts')).toBe(false);
    expect(isSafeCodePath('C:\\Windows\\secret.js')).toBe(false);
    expect(isSafeCodePath('src/.env.production')).toBe(false);
    await expect(parseDocument(Buffer.from([0xff, 0xfe]), 'code', undefined, undefined, undefined, { filename: 'a.py' }))
      .rejects.toThrow('UTF-8');
    await expect(parseDocument(Buffer.from('not a zip'), 'code_archive', undefined, undefined, undefined, { filename: 'a.zip' }))
      .rejects.toThrow('invalid');
  });
});
