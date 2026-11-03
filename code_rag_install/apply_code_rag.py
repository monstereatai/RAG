#!/usr/bin/env python3
"""Apply Code RAG changes to a checked-out monstereatai/RAG repository.

Default: verify all patch anchors and create backups before modifying any file.
Use --check to verify without writing. No downloaded patch execution, no Git operations.
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

BASE = Path(__file__).resolve().parent
DOC = 'apps/rag-api/src/modules/document/'


def replace_once(text: str, before: str, after: str, path: str) -> str:
    n = text.count(before)
    if n == 1:
        # Replacement can be a short subset of the original snippet (dangling-return fix).
        if len(after) >= len(before) and after in text:
            return text
        return text.replace(before, after, 1)
    if n == 0 and after in text:
        return text
    raise ValueError(f'{path}: patch anchor expected once, found {n}: {before[:100]!r}')


def patch_types(text: str, path: str) -> str:
    text = replace_once(text, "  | 'markdown'\n  | 'text'", "  | 'markdown'\n  | 'text'\n  | 'code'\n  | 'code_archive'", path)
    text = replace_once(text, "  | 'paragraph'\n  | 'table'", "  | 'paragraph'\n  | 'code'\n  | 'table'", path)
    return text


def patch_parser(text: str, path: str) -> str:
    text = replace_once(text,
        "import { validateDocumentFormat } from './document-parser.validation';",
        "import { validateDocumentFormat } from './document-parser.validation';\n"
        "import { isCodeUpload } from './code-language.util';\n"
        "import { parseCodeSource } from './code-parser.util';\n"
        "import { parseCodeArchive } from './code-archive.util';", path)
    text = replace_once(text,
        "  throw new BadRequestException(\n    'only document, url, image, audio and video knowledge files are supported',",
        "  if (lowerName.endsWith('.zip')) return 'code_archive';\n"
        "  if (isCodeUpload(filename)) return 'code';\n\n"
        "  throw new BadRequestException(\n    'only document, URL, image, audio, video and source code files are supported',", path)
    text = replace_once(text,
        "  switch (kind) {\n    case 'markdown':",
        "  switch (kind) {\n    case 'code':\n      return parseCodeSource(buffer, filename);\n"
        "    case 'code_archive':\n      return parseCodeArchive(buffer, filename);\n"
        "    case 'markdown':", path)
    return text


def patch_hybrid(text: str, path: str) -> str:
    text = replace_once(text,
        "import type { ParsedBlock, ParsedDocument } from './document-parser.types';",
        "import type { ParsedBlock, ParsedDocument } from './document-parser.types';\n"
        "import { splitCodeDocument } from './code-chunker.util';", path)
    text = replace_once(text,
        "  assetRefs?: string[];\n}",
        "  assetRefs?: string[];\n  filePath?: string;\n  language?: string;\n"
        "  symbol?: string;\n  symbolKind?: string;\n  parentSymbol?: string;\n"
        "  startLine?: number;\n  endLine?: number;\n  imports?: string[];\n}", path)
    text = replace_once(text,
        "  const splitter = new MarkdownChunker(input.chunkSize, input.chunkOverlap, true);",
        "  if (input.parsedDocument?.kind === 'code' || input.parsedDocument?.kind === 'code_archive') {\n"
        "    return splitCodeDocument({\n"
        "      docId: input.docId, filename: input.filename, parsedDocument: input.parsedDocument,\n"
        "      chunkSize: input.chunkSize, chunkOverlap: input.chunkOverlap,\n"
        "    });\n"
        "  }\n"
        "  const splitter = new MarkdownChunker(input.chunkSize, input.chunkOverlap, true);", path)
    return text


def patch_document_profile(text: str, path: str) -> str:
    text = replace_once(text, "  | 'postmortem'\n  | 'general';", "  | 'postmortem'\n  | 'code'\n  | 'general';", path)
    text = replace_once(text,
        "  general: { chunkSize: 500, chunkOverlap: 75, semanticBoundaries: true },",
        "  code: { chunkSize: 800, chunkOverlap: 80, semanticBoundaries: true },\n"
        "  general: { chunkSize: 500, chunkOverlap: 75, semanticBoundaries: true },", path)
    return text


def patch_upload_workflow(text: str, path: str) -> str:
    text = replace_once(text,
        "      const detectedBusiness = detectGameDocumentMetadata(filename, content);",
        "      const codeInput = options.parsedDocument?.kind === 'code' ||\n"
        "        options.parsedDocument?.kind === 'code_archive';\n"
        "      const detectedBusiness = detectGameDocumentMetadata(filename, content);", path)
    text = replace_once(text,
        "      const strategy = await this.context.resolveChunkStrategy(business);",
        "      if (codeInput) business.documentType = 'code';\n"
        "      const strategy = await this.context.resolveChunkStrategy(business);", path)
    text = replace_once(text,
        "      const metadataPromise = options.preserveExistingMetadata\n",
        "      const metadataPromise = options.preserveExistingMetadata || codeInput\n", path)
    text = replace_once(text,
        "        this.context.graphService.isEnabled() ? 'pending' : 'skipped';",
        "        this.context.graphService.isEnabled() && !codeInput ? 'pending' : 'skipped';", path)
    return text


def patch_controller(text: str, path: str) -> str:
    # A dangling return on the current main branch prevents all synchronous uploads.
    text = replace_once(text,
        "    // cd 获取文件类型，调用 extractDocumentText 提取文本内容；ObsidianIngestService 做去重和来源挂接。\n"
        "    const kind = detectDocumentKind(file.originalname);\n"
        "    console.log(`cdddddddddd Detected document kind: ${kind} for file: ${file.originalname}`);\n"
        "    console.log(file);\n\n"
        "    return\n\n",
        "    const kind = detectDocumentKind(file.originalname);\n", path)
    return text


def patch_obsidian(text: str, path: str) -> str:
    text = replace_once(text,
        "    // 文本已由入口完成解析；这里处理内容去重，并把 RAG 文档索引与 Obsidian 来源记录关联起来。\n"
        "    const duplicate = await this.findDuplicate(params.content, params.userId);",
        "    // Distinct code files may share identical contents; preserve each file's provenance.\n"
        "    const isCode = params.parsedDocument?.kind === 'code' ||\n"
        "      params.parsedDocument?.kind === 'code_archive';\n"
        "    const duplicate = isCode ? null : await this.findDuplicate(params.content, params.userId);", path)
    text = replace_once(text,
        "    const obsidian = await this.enqueueNote({\n      docId: rag.docId,\n      userId: params.userId,\n      title: params.title,",
        "    // Code has a structured source index; avoid duplicating entire repositories into Obsidian.\n"
        "    if (isCode) {\n"
        "      return {\n"
        "        rag,\n"
        "        obsidian: {\n"
        "          status: 'skipped', title: params.title, tags: [],\n"
        "          contentHash: createHash('sha256').update(params.content).digest('hex'),\n"
        "          ragDocId: rag.docId,\n"
        "        },\n"
        "      };\n"
        "    }\n"
        "    const obsidian = await this.enqueueNote({\n      docId: rag.docId,\n      userId: params.userId,\n      title: params.title,", path)
    return text


def patch_package(text: str, path: str) -> str:
    value = json.loads(text)
    deps = value['dependencies']
    if deps.get('@ast-grep/napi') not in (None, '0.45.3'):
        raise ValueError(f'{path}: existing ast-grep version differs')
    deps['@ast-grep/napi'] = '0.45.3'
    if deps.get('@vue/compiler-sfc') not in (None, '3.5.22'):
        raise ValueError(f'{path}: existing Vue compiler version differs')
    deps['@vue/compiler-sfc'] = '3.5.22'
    value['dependencies'] = dict(sorted(deps.items()))
    return json.dumps(value, ensure_ascii=False, indent=2) + '\n'


PATCHES = {
    f'{DOC}document-parser.types.ts': patch_types,
    f'{DOC}document-parser.util.ts': patch_parser,
    f'{DOC}hybrid-document-chunker.ts': patch_hybrid,
    f'{DOC}document-profile.util.ts': patch_document_profile,
    f'{DOC}document.service.upload-workflow.ts': patch_upload_workflow,
    f'{DOC}document.controller.ts': patch_controller,
    f'{DOC}obsidian-ingest.service.ts': patch_obsidian,
    'apps/rag-api/package.json': patch_package,
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('repo', type=Path, help='Path to cloned RAG repository')
    parser.add_argument('--check', action='store_true', help='Preflight all patches without touching files')
    args = parser.parse_args()
    root = args.repo.expanduser().resolve()
    if not (root / 'apps/rag-api/src/modules/document/document.controller.ts').is_file():
        raise SystemExit('This does not look like monstereatai/RAG; aborting')
    changes: dict[Path, str] = {}
    for rel, patch in PATCHES.items():
        file = root / rel
        changes[file] = patch(file.read_text(encoding='utf-8'), rel)
    for file in sorted((BASE / 'files').rglob('*')):
        if not file.is_file():
            continue
        target = root / file.relative_to(BASE / 'files')
        if target.exists() and target.read_bytes() != file.read_bytes():
            raise ValueError(f'refusing to overwrite a differing file: {target}')
        changes[target] = file.read_text(encoding='utf-8')
    print(f'Preflight OK: {len(changes)} files prepared')
    if args.check:
        return
    # Keep backups *outside* the Git worktree so they cannot be committed accidentally.
    backup_root = root.parent / f'{root.name}-code-rag-backup-20261103'
    if backup_root.exists():
        raise SystemExit('Existing backup folder detected: refusing to overwrite old backups')
    for original in PATCHES:
        dst = backup_root / original
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / original, dst)
    for file, content in changes.items():
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(content, encoding='utf-8')
    print(f'Changes installed. Backups: {backup_root}')
    print('NEXT: cd <repo> && pnpm install --no-frozen-lockfile')
    print('NEXT: pnpm --filter backend build')
    print('NEXT: pnpm --filter backend test -- --runInBand code-parser.util.spec.ts code-chunker.util.spec.ts')
    print('NEXT: git status --short (review + commit after tests pass)')

if __name__ == '__main__':
    main()
