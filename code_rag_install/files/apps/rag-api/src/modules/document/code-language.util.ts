import { Lang } from '@ast-grep/napi';

/** A single registry for AST-supported sources and code-like configurations. */
const SOURCE_LANGUAGES: Record<string, { language: string; grammar: Lang | null }> = {
  js: { language: 'javascript', grammar: Lang.JavaScript },
  cjs: { language: 'javascript', grammar: Lang.JavaScript },
  mjs: { language: 'javascript', grammar: Lang.JavaScript },
  jsx: { language: 'jsx', grammar: Lang.Tsx },
  ts: { language: 'typescript', grammar: Lang.TypeScript },
  mts: { language: 'typescript', grammar: Lang.TypeScript },
  cts: { language: 'typescript', grammar: Lang.TypeScript },
  tsx: { language: 'tsx', grammar: Lang.Tsx },
  vue: { language: 'vue', grammar: null },
  java: { language: 'java', grammar: Lang.Java },
  go: { language: 'go', grammar: Lang.Go },
  py: { language: 'python', grammar: Lang.Python },
  pyi: { language: 'python', grammar: Lang.Python },
  rs: { language: 'rust', grammar: Lang.Rust },
  cs: { language: 'csharp', grammar: Lang.CSharp },
  c: { language: 'c', grammar: Lang.C },
  h: { language: 'c', grammar: Lang.C },
  cc: { language: 'cpp', grammar: Lang.Cpp },
  cpp: { language: 'cpp', grammar: Lang.Cpp },
  hpp: { language: 'cpp', grammar: Lang.Cpp },
  php: { language: 'php', grammar: Lang.Php },
  rb: { language: 'ruby', grammar: Lang.Ruby },
  kt: { language: 'kotlin', grammar: Lang.Kotlin },
  kts: { language: 'kotlin', grammar: Lang.Kotlin },
  swift: { language: 'swift', grammar: Lang.Swift },
  dart: { language: 'dart', grammar: Lang.Dart },
  scala: { language: 'scala', grammar: Lang.Scala },
  sh: { language: 'bash', grammar: Lang.Bash },
  bash: { language: 'bash', grammar: Lang.Bash },
  css: { language: 'css', grammar: Lang.Css },
  scss: { language: 'scss', grammar: Lang.Css },
  sql: { language: 'sql', grammar: null },
  graphql: { language: 'graphql', grammar: null },
  proto: { language: 'protobuf', grammar: null },
  // Normal document uploads already handle JSON/HTML; in ZIP archives these are configuration sources.
  json: { language: 'json', grammar: Lang.Json },
  yaml: { language: 'yaml', grammar: Lang.Yaml },
  yml: { language: 'yaml', grammar: Lang.Yaml },
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
  { language: string; grammar: Lang | null } | null {
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
