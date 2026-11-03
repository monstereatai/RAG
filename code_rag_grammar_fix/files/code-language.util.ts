import { Lang } from '@ast-grep/napi';

/** Built-in JS grammars are Lang values; other grammars must be registered dynamically. */
export type CodeGrammar = Lang | string | null;

/** A single registry for AST-supported sources and code-like configurations. */
const SOURCE_LANGUAGES: Record<string, { language: string; grammar: CodeGrammar }> = {
  js: { language: 'javascript', grammar: Lang.JavaScript },
  cjs: { language: 'javascript', grammar: Lang.JavaScript },
  mjs: { language: 'javascript', grammar: Lang.JavaScript },
  jsx: { language: 'jsx', grammar: Lang.Tsx },
  ts: { language: 'typescript', grammar: Lang.TypeScript },
  mts: { language: 'typescript', grammar: Lang.TypeScript },
  cts: { language: 'typescript', grammar: Lang.TypeScript },
  tsx: { language: 'tsx', grammar: Lang.Tsx },
  vue: { language: 'vue', grammar: null },
  java: { language: 'java', grammar: 'java' },
  go: { language: 'go', grammar: 'go' },
  py: { language: 'python', grammar: 'python' },
  pyi: { language: 'python', grammar: 'python' },
  rs: { language: 'rust', grammar: 'rust' },
  cs: { language: 'csharp', grammar: 'csharp' },
  c: { language: 'c', grammar: 'c' },
  h: { language: 'c', grammar: 'c' },
  cc: { language: 'cpp', grammar: 'cpp' },
  cpp: { language: 'cpp', grammar: 'cpp' },
  hpp: { language: 'cpp', grammar: 'cpp' },
  php: { language: 'php', grammar: 'php' },
  rb: { language: 'ruby', grammar: 'ruby' },
  kt: { language: 'kotlin', grammar: 'kotlin' },
  kts: { language: 'kotlin', grammar: 'kotlin' },
  swift: { language: 'swift', grammar: 'swift' },
  dart: { language: 'dart', grammar: 'dart' },
  scala: { language: 'scala', grammar: 'scala' },
  sh: { language: 'bash', grammar: 'bash' },
  bash: { language: 'bash', grammar: 'bash' },
  css: { language: 'css', grammar: Lang.Css },
  scss: { language: 'scss', grammar: Lang.Css },
  sql: { language: 'sql', grammar: null },
  graphql: { language: 'graphql', grammar: null },
  proto: { language: 'protobuf', grammar: null },
  // Normal document uploads already handle JSON/HTML; in ZIP archives these are configuration sources.
  json: { language: 'json', grammar: 'json' },
  yaml: { language: 'yaml', grammar: 'yaml' },
  yml: { language: 'yaml', grammar: 'yaml' },
  html: { language: 'html', grammar: Lang.Html },
};

const IGNORED_PARTS = new Set([
  '.git', '.svn', '.hg', 'node_modules', 'vendor', 'dist', 'build', 'target', 'coverage',
  '.next', '.nuxt', '.output', '.venv', 'venv', '__pycache__', '.gradle', '.idea',
  '.turbo', '.cache', 'out', '.terraform', 'bin', 'obj', '.pytest_cache',
]);

const SENSITIVE_BASENAMES = new Set([
  '.env', '.npmrc', '.pypirc', '.netrc', '.dockercfg', 'credentials',
  'id_rsa', 'id_ed25519', 'known_hosts', 'authorized_keys',
]);

export const MAX_CODE_FILE_BYTES = 2 * 1024 * 1024;

export function getCodeLanguage(filename: string):
  { language: string; grammar: CodeGrammar } | null {
  const extension = filename.replace(/\\/g, '/').split('/').at(-1)?.split('.').at(-1)?.toLowerCase();
  return extension ? SOURCE_LANGUAGES[extension] ?? null : null;
}

/** Reject unsafe paths before using ZIP entry names for provenance or persistence. */
export function isSafeCodePath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:\//i.test(normalized)) return false;
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || IGNORED_PARTS.has(part.toLowerCase()))) {
    return false;
  }
  const basename = parts.at(-1)?.toLowerCase() ?? '';
  if (SENSITIVE_BASENAMES.has(basename) || basename.startsWith('.env.') ||
      /\.(pem|key|p12|pfx|crt|cer|jks|keystore|sqlite|db|lock|map)$/i.test(basename) ||
      /\.min\.(js|css)$/i.test(basename) || /(?:^|[._-])secret(?:s)?[._-]/i.test(basename)) {
    return false;
  }
  return true;
}

export function isCodeUpload(filename: string): boolean {
  return isSafeCodePath(filename) && getCodeLanguage(filename) !== null;
}
