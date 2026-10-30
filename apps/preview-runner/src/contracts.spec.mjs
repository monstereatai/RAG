import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewDocument, validatePreviewRequest } from './contracts.mjs';
import { compilePreview } from './build-preview.mjs';

test('accepts fixed React and Vue entry files only', () => {
  assert.equal(
    validatePreviewRequest({ framework: 'react', files: { 'src/main.tsx': 'void 0;' } }).framework,
    'react',
  );
  assert.throws(
    () => validatePreviewRequest({ framework: 'vue', files: { '../secret': 'x', 'src/main.ts': 'x' } }),
    /not allowed/,
  );
});

test('blocks generated source that can access network or dynamic modules', () => {
  assert.throws(
    () => validatePreviewRequest({ framework: 'react', files: { 'src/main.tsx': 'fetch("https://example.com")' } }),
    /blocked API/,
  );
  assert.throws(
    () => validatePreviewRequest({ framework: 'vue', files: { 'src/main.ts': 'import("./dynamic")' } }),
    /blocked API/,
  );
});

test('creates an opaque-origin friendly document with network disabled CSP', () => {
  const html = createPreviewDocument('document.body.textContent = "preview";');
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /<div id="app"><\/div>/);
});

test('compiles a React page into a self-contained preview document', async () => {
  const html = await compilePreview({
    framework: 'react',
    files: {
      'src/main.tsx': "import React from 'react'; import { createRoot } from 'react-dom/client'; import App from './App'; import './style.css'; createRoot(document.getElementById('app')!).render(<App />);",
      'src/App.tsx': 'import React from "react"; export default function App(){return <h1>RAG preview</h1>}',
      'src/style.css': 'h1 { color: #123; }',
    },
  });
  assert.match(html, /RAG preview/);
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /src="\/assets\//);
});

test('compiles a Vue page into a self-contained preview document', async () => {
  const html = await compilePreview({
    framework: 'vue',
    files: {
      'src/main.ts': "import { createApp } from 'vue'; import App from './App.vue'; import './style.css'; createApp(App).mount('#app');",
      'src/App.vue': '<template><h1>RAG preview</h1></template>',
      'src/style.css': 'h1 { color: #123; }',
    },
  });
  assert.match(html, /RAG preview/);
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /src="\/assets\//);
});
