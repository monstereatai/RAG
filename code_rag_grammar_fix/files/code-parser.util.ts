import { BadRequestException } from '@nestjs/common';
import { parse as parseAst, Lang, registerDynamicLanguage } from '@ast-grep/napi';
import langJava from '@ast-grep/lang-java';
import langGo from '@ast-grep/lang-go';
import langPython from '@ast-grep/lang-python';
import langRust from '@ast-grep/lang-rust';
import langCSharp from '@ast-grep/lang-csharp';
import langC from '@ast-grep/lang-c';
import langCpp from '@ast-grep/lang-cpp';
import langPhp from '@ast-grep/lang-php';
import langRuby from '@ast-grep/lang-ruby';
import langKotlin from '@ast-grep/lang-kotlin';
import langSwift from '@ast-grep/lang-swift';
import langDart from '@ast-grep/lang-dart';
import langScala from '@ast-grep/lang-scala';
import langBash from '@ast-grep/lang-bash';
import langJson from '@ast-grep/lang-json';
import langYaml from '@ast-grep/lang-yaml';
import { parse as parseVueSfc } from '@vue/compiler-sfc';
import type {
  ParsedBlock,
  ParsedDocument,
  ParsedDocumentWarning,
} from './document-parser.types';
import { getCodeLanguage, isSafeCodePath, MAX_CODE_FILE_BYTES } from './code-language.util';

interface AstNode {
  kind(): string;
  text(): string;
  range(): { start: { line: number; column: number }; end: { line: number; column: number } };
  namedChildren(): AstNode[];
  field(name: string): AstNode | null;
}

/** @ast-grep/napi bundles only JS/TS/TSX/HTML/CSS. Load the verified external grammars once. */
let grammarsRegistered = false;
function ensureDynamicGrammars(): void {
  if (grammarsRegistered) return;
  registerDynamicLanguage({
    java: langJava,
    go: langGo,
    python: langPython,
    rust: langRust,
    csharp: langCSharp,
    c: langC,
    cpp: langCpp,
    php: langPhp,
    ruby: langRuby,
    kotlin: langKotlin,
    swift: langSwift,
    dart: langDart,
    scala: langScala,
    bash: langBash,
    json: langJson,
    yaml: langYaml,
  });
  grammarsRegistered = true;
}

const CLASS_KINDS = new Set([
  'class_declaration', 'class_definition', 'interface_declaration', 'interface_definition',
  'enum_declaration', 'struct_item', 'struct_specifier', 'trait_item', 'impl_item',
  'type_declaration', 'object_declaration', 'record_declaration',
]);
const FUNCTION_KINDS = new Set([
  'function_declaration', 'function_definition', 'function_item',
  'method_definition', 'method_declaration', 'constructor_declaration',
  'generator_function_declaration', 'local_function_statement',
  'function_definition_statement', 'singleton_method', 'method',
]);
const IMPORT_KINDS = new Set([
  'import_statement', 'import_declaration', 'import_from_statement',
  'use_declaration', 'using_directive', 'using_statement', 'namespace_use_declaration',
  'import_spec', 'preproc_include',
]);

function decodeSource(buffer: Buffer, filename: string): string {
  if (!buffer.length || buffer.length > MAX_CODE_FILE_BYTES) {
    throw new BadRequestException(`invalid code file size: ${filename}`);
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new BadRequestException(`source file must be UTF-8: ${filename}`);
  }
  if (text.includes('\0')) throw new BadRequestException(`binary source rejected: ${filename}`);
  const normalized = text.replace(/^\uFEFF/, '');
  if (!normalized.trim()) throw new BadRequestException(`empty source file: ${filename}`);
  return normalized;
}

function symbolType(node: AstNode): 'class' | 'function' | 'method' | null {
  const kind = node.kind();
  if (CLASS_KINDS.has(kind)) return 'class';
  if (FUNCTION_KINDS.has(kind)) return kind.includes('method') || kind.includes('constructor') ? 'method' : 'function';
  if (kind === 'variable_declarator') {
    const value = node.field('value');
    if (value && /^(?:arrow_function|function_expression|function|generator_function)$/.test(value.kind())) {
      return 'function';
    }
  }
  // Go and Kotlin type nodes can be handled as containers only when they are declarative.
  return null;
}

function symbolName(node: AstNode, kind: string): string {
  const direct = node.field('name')?.text() || node.field('declarator')?.text();
  if (direct) return direct.replace(/\s*\(.*/s, '').slice(0, 160);
  const firstLine = node.text().slice(0, 250);
  const found = /(?:class|interface|struct|trait|enum|impl|type|func|fun|def|fn|function)\s+([\w.$<>:*]+)/.exec(firstLine);
  return (found?.[1] || `${kind}@${node.range().start.line + 1}`).slice(0, 160);
}

function asCodeBlock(params: {
  content: string;
  filename: string;
  language: string;
  symbol: string;
  symbolKind: string;
  startLine: number;
  endLine: number;
  parentSymbol?: string;
  imports?: string[];
}): ParsedBlock {
  return {
    type: 'code',
    text: params.content,
    headingPath: [params.filename, params.symbol],
    metadata: {
      filePath: params.filename,
      language: params.language,
      symbol: params.symbol,
      symbolKind: params.symbolKind,
      startLine: params.startLine,
      endLine: params.endLine,
      parentSymbol: params.parentSymbol ?? '',
      imports: JSON.stringify((params.imports ?? []).slice(0, 60)),
    },
  };
}

function extractAstBlocks(
  content: string,
  filename: string,
  language: string,
  grammar: Lang | string,
  lineOffset = 0,
): ParsedBlock[] {
  // Dynamic language IDs are plain strings in ast-grep's NAPI interface.
  // A cast alone is NOT enough: registration must happen before parsing.
  ensureDynamicGrammars();
  const root = parseAst(grammar as Lang, content).root() as unknown as AstNode;
  const imports: string[] = [];
  const symbols: ParsedBlock[] = [];
  const maxNodes = 100_000;
  let visited = 0;

  function walk(node: AstNode, parent = ''): void {
    if (++visited > maxNodes) throw new BadRequestException(`AST node limit exceeded: ${filename}`);
    if (IMPORT_KINDS.has(node.kind()) && imports.length < 60) {
      imports.push(node.text().slice(0, 240));
    }
    const type = symbolType(node);
    let symbol = parent;
    if (type) {
      const name = symbolName(node, node.kind());
      symbol = parent ? `${parent}.${name}` : name;
      const startLine = lineOffset + node.range().start.line + 1;
      const endLine = lineOffset + node.range().end.line + 1;
      // Container header is indexed separately; methods below are their own chunks.
      const text = type === 'class' && node.text().length > 400
        ? node.text().split('\n').slice(0, 16).join('\n').slice(0, 1000)
        : node.text();
      symbols.push(asCodeBlock({
        content: text, filename, language, symbol, symbolKind: type,
        startLine, endLine: type === 'class' && text !== node.text()
          ? startLine + text.split('\n').length - 1 : endLine,
        parentSymbol: parent,
      }));
    }
    for (const child of node.namedChildren()) {
      walk(child, type === 'class' ? symbol : parent);
    }
  }
  walk(root);
  // Imports collected throughout the AST are part of every symbol's provenance.
  for (const symbol of symbols) {
    if (symbol.metadata) symbol.metadata.imports = JSON.stringify(imports.slice(0, 60));
  }

  const header = imports.length ? imports.join('\n').slice(0, 6000) : '';
  const blocks = header ? [asCodeBlock({
    content: header, filename, language, symbol: '<imports>', symbolKind: 'imports',
    startLine: lineOffset + 1,
    endLine: lineOffset + Math.min(content.split('\n').length, imports.length),
    imports,
  })] : [];
  blocks.push(...symbols);
  if (!symbols.length) {
    blocks.push(asCodeBlock({
      content,
      filename,
      language,
      symbol: '<module>',
      symbolKind: 'module',
      startLine: lineOffset + 1,
      endLine: lineOffset + content.split('\n').length,
      imports,
    }));
  }
  // Preserve top-level statements/constants in addition to named symbols.
  const topLevel = root.namedChildren()
    .filter((node) => !symbolType(node) && !IMPORT_KINDS.has(node.kind()) &&
      !node.namedChildren().some((child) => symbolType(child) !== null))
    .map((node) => node.text())
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 10000);
  if (topLevel && symbols.length) {
    blocks.push(asCodeBlock({
      content: topLevel, filename, language,
      symbol: '<module-statements>', symbolKind: 'module',
      startLine: lineOffset + 1,
      endLine: lineOffset + content.split('\n').length,
      imports,
    }));
  }
  return blocks;
}

function parseVueBlocks(source: string, filename: string): { blocks: ParsedBlock[]; warnings: ParsedDocumentWarning[] } {
  const { descriptor, errors } = parseVueSfc(source, { filename });
  const warnings = errors.map((error) => ({ code: 'vue_sfc_invalid', message: String(error) }));
  const blocks: ParsedBlock[] = [];
  const base = filename.replace(/\.vue$/i, '');
  for (const [index, script] of [descriptor.script, descriptor.scriptSetup].entries()) {
    if (!script?.content.trim()) continue;
    const language = /^(?:ts|tsx)$/i.test(script.lang ?? '') ? 'typescript' : 'javascript';
    const grammar = /^(?:tsx|jsx)$/i.test(script.lang ?? '')
      ? Lang.Tsx : language === 'typescript' ? Lang.TypeScript : Lang.JavaScript;
    const offset = Math.max(0, script.loc.start.line - 1);
    const scriptBlocks = extractAstBlocks(script.content, filename, language, grammar, offset);
    blocks.push(...scriptBlocks);
    // setup() bindings can be unexported constants; index their text as a bounded context block.
    if (index === 1) blocks.push(asCodeBlock({
      content: script.content, filename, language, symbol: `${base}.<script setup>`,
      symbolKind: 'component-script', startLine: script.loc.start.line,
      endLine: script.loc.end.line,
    }));
  }
  if (descriptor.template?.content.trim()) {
    const template = descriptor.template;
    blocks.push(asCodeBlock({
      content: template.content, filename, language: 'vue-template',
      symbol: `${base}.<template>`, symbolKind: 'component-template',
      startLine: template.loc.start.line, endLine: template.loc.end.line,
    }));
  }
  descriptor.styles.forEach((style, index) => {
    if (!style.content.trim()) return;
    blocks.push(asCodeBlock({
      content: style.content, filename, language: style.lang ?? 'css',
      symbol: `${base}.<style:${index + 1}>`, symbolKind: 'component-style',
      startLine: style.loc.start.line, endLine: style.loc.end.line,
    }));
  });
  if (!blocks.length) warnings.push({ code: 'vue_sfc_empty', message: 'Vue SFC has no indexable blocks' });
  return { blocks, warnings };
}

function toMarkdown(block: ParsedBlock): string {
  const meta = block.metadata ?? {};
  const fence = '````';
  const lang = String(meta.language ?? 'text').replace(/[^\w-]/g, '');
  return `## ${String(meta.filePath)} :: ${String(meta.symbol)} (L${meta.startLine}-${meta.endLine})\n\n${fence}${lang}\n${block.text}\n${fence}`;
}

/** Parse *untrusted* source code without evaluating it. */
export function parseCodeSource(buffer: Buffer, filename: string): ParsedDocument {
  if (!isSafeCodePath(filename)) throw new BadRequestException(`unsafe source path: ${filename}`);
  const detected = getCodeLanguage(filename);
  if (!detected) throw new BadRequestException(`unsupported code language: ${filename}`);
  const source = decodeSource(buffer, filename);
  const warnings: ParsedDocumentWarning[] = [];
  let blocks: ParsedBlock[];
  if (detected.language === 'vue') {
    const vue = parseVueBlocks(source, filename);
    blocks = vue.blocks;
    warnings.push(...vue.warnings);
  } else if (detected.grammar) {
    try {
      blocks = extractAstBlocks(source, filename, detected.language, detected.grammar);
    } catch (error) {
      // An AST/parser failure must be visible, never advertised as a successful AST extraction.
      throw new BadRequestException(`code AST parsing failed for ${filename}: ${String(error)}`);
    }
  } else {
    // SQL / GraphQL / protobuf don't have a built-in grammar: line-aware text-only ingestion.
    warnings.push({ code: 'code_ast_unavailable', message: `No built-in AST grammar for ${detected.language}` });
    blocks = [asCodeBlock({
      content: source, filename, language: detected.language,
      symbol: '<module>', symbolKind: 'module',
      startLine: 1, endLine: source.split('\n').length,
    })];
  }
  return {
    kind: 'code',
    title: filename,
    blocks,
    markdown: blocks.map(toMarkdown).join('\n\n'),
    status: blocks.length ? (warnings.length ? 'partial' : 'complete') : 'failed',
    completeness: blocks.length ? (warnings.length ? 0.9 : 1) : 0,
    warnings,
  };
}
