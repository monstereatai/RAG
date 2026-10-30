export const MAX_REQUEST_BYTES = 320 * 1024;
export const MAX_SOURCE_BYTES = 300 * 1024;
export const MAX_FILES = 5;

const FILES_BY_FRAMEWORK = {
  react: new Set(['src/main.tsx', 'src/App.tsx', 'src/style.css']),
  vue: new Set(['src/main.ts', 'src/App.vue', 'src/style.css']),
};

const UNSAFE_SOURCE = /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|require|eval|Function)\b|import\s*\(/;
const ALLOWED_IMPORTS = new Set([
  'vue',
  'react',
  'react-dom/client',
  './App',
  './App.vue',
  './style.css',
]);

export function validatePreviewRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Request must be an object.');
  }
  const { framework, files } = value;
  if (framework !== 'react' && framework !== 'vue') {
    throw new Error('Framework must be react or vue.');
  }
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    throw new Error('Files must be an object.');
  }
  const entries = Object.entries(files);
  if (entries.length === 0 || entries.length > MAX_FILES) {
    throw new Error(`Files must contain between 1 and ${MAX_FILES} entries.`);
  }
  let totalBytes = 0;
  for (const [filePath, source] of entries) {
    if (!FILES_BY_FRAMEWORK[framework].has(filePath)) {
      throw new Error(`File path is not allowed: ${filePath}`);
    }
    if (typeof source !== 'string') {
      throw new Error(`Source must be text: ${filePath}`);
    }
    if (UNSAFE_SOURCE.test(source) || /@import\s|https?:\/\//i.test(source)) {
      throw new Error(`Source uses a blocked API or external resource: ${filePath}`);
    }
    for (const match of source.matchAll(/(?:from\s*|import\s*)['\"]([^'\"]+)['\"]/g)) {
      if (!ALLOWED_IMPORTS.has(match[1])) {
        throw new Error(`Import is not allowed: ${match[1]}`);
      }
    }
    totalBytes += Buffer.byteLength(source, 'utf8');
  }
  if (totalBytes > MAX_SOURCE_BYTES) {
    throw new Error(`Source exceeds ${MAX_SOURCE_BYTES} bytes.`);
  }
  const entry = framework === 'react' ? 'src/main.tsx' : 'src/main.ts';
  if (!Object.hasOwn(files, entry)) {
    throw new Error(`Missing framework entry file: ${entry}`);
  }
  return { framework, files };
}

export function createPreviewDocument(script, styles = '') {
  const safeScript = script.replace(/<\/script/gi, '<\\/script');
  const safeStyles = styles.replace(/<\/style/gi, '<\\/style');
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'font-src data:',
    "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
  ].join('; ');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${safeStyles}</style></head><body><div id="app"></div><script>${safeScript}</script></body></html>`;
}
