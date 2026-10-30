import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import vue from '@vitejs/plugin-vue';
import { createPreviewDocument, validatePreviewRequest } from './contracts.mjs';

const packageDirectory = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

export async function compilePreview(request) {
  const { framework, files } = validatePreviewRequest(request);
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'rag-preview-'));
  try {
    await mkdir(path.join(temporaryRoot, 'src'), { recursive: true });
    await symlink(path.join(packageDirectory, 'node_modules'), path.join(temporaryRoot, 'node_modules'), 'dir');
    await Promise.all(
      Object.entries(files).map(([filePath, source]) =>
        writeFile(path.join(temporaryRoot, filePath), source, 'utf8'),
      ),
    );
    const entry = framework === 'react' ? 'src/main.tsx' : 'src/main.ts';
    const output = await build({
      root: temporaryRoot,
      configFile: false,
      mode: 'production',
      plugins: framework === 'react' ? [react()] : [vue()],
      logLevel: 'error',
      build: {
        write: false,
        minify: false,
        sourcemap: false,
        cssMinify: false,
        rollupOptions: {
          input: path.join(temporaryRoot, entry),
          output: {
            format: 'iife',
            name: 'PreviewBundle',
            entryFileNames: 'preview.js',
            assetFileNames: 'preview.[ext]',
          },
        },
      },
    });
    const outputs = Array.isArray(output) ? output.flatMap((item) => item.output) : output.output;
    const script = outputs.find((item) => item.type === 'chunk' && item.isEntry);
    if (!script || script.type !== 'chunk') {
      throw new Error('Preview build did not produce a JavaScript entry.');
    }
    const css = outputs.find((item) => item.type === 'asset' && item.fileName.endsWith('.css'));
    const styles = css && 'source' in css ? String(css.source) : '';
    const html = createPreviewDocument(script.code, styles);
    if (Buffer.byteLength(html, 'utf8') > 2 * 1024 * 1024) {
      throw new Error('Compiled preview exceeds 2 MB.');
    }
    return html;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  try {
    const html = await compilePreview(JSON.parse(input));
    process.stdout.write(JSON.stringify({ html }));
  } catch (error) {
    process.stderr.write(error instanceof Error ? error.message : 'Preview build failed.');
    process.exitCode = 1;
  }
}
