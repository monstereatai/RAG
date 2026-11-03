#!/usr/bin/env python3
"""Fix RAG Code RAG ast-grep dynamic language registration, on an already patched project.
Idempotent, file-content validation, backups. This does not rerun the original installer.
"""
import argparse
import json
from pathlib import Path
import shutil

GRAMMAR_VERSIONS = {'java': '0.0.7', 'go': '0.0.6', 'python': '0.0.6', 'rust': '0.0.7', 'csharp': '0.0.6', 'c': '0.0.6', 'cpp': '0.0.6', 'php': '0.0.7', 'ruby': '0.0.7', 'kotlin': '0.0.7', 'swift': '0.0.8', 'dart': '0.0.7', 'scala': '0.0.7', 'bash': '0.0.8', 'json': '0.0.7', 'yaml': '0.0.6'}
GRAMMAR_PACKAGES = {f'@ast-grep/lang-{lang}': version for lang, version in GRAMMAR_VERSIONS.items()}
FIX_FILES = ['code-language.util.ts', 'code-parser.util.ts', 'code-parser.util.spec.ts']
HERE = Path(__file__).resolve().parent

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('repository', type=Path)
    ap.add_argument('--check', action='store_true')
    args = ap.parse_args()
    repo = args.repository.expanduser().resolve()
    modules = repo / 'apps/rag-api/src/modules/document'
    package = repo / 'apps/rag-api/package.json'
    workspace = repo / 'pnpm-workspace.yaml'
    if not package.is_file() or not (modules / 'code-language.util.ts').is_file() or not workspace.is_file():
        ap.error('Please specify the RAG repository where the original Code RAG patch was applied.')

    changes = {}
    for name in FIX_FILES:
        src = HERE / 'files' / name
        dst = modules / name
        if not dst.is_file():
            ap.error('Missing current file: ' + str(dst))
        current = dst.read_text(encoding='utf-8')
        new = src.read_text(encoding='utf-8')
        if current != new:
            if name == 'code-language.util.ts' and 'Lang.Java' not in current:
                ap.error('code-language.util.ts differs from the known bad patch; review manually.')
            if name == 'code-parser.util.ts' and 'function extractAstBlocks(' not in current:
                ap.error('code-parser.util.ts differs from the expected patch; review manually.')
            changes[dst] = new

    obj = json.loads(package.read_text(encoding='utf-8'))
    deps = obj.get('dependencies', {})
    if deps.get('@ast-grep/napi') is None:
        ap.error('The original Code RAG dependencies are missing; install original patch first.')
    for name, version in GRAMMAR_PACKAGES.items():
        existing = deps.get(name)
        if existing is not None and existing != version:
            ap.error(f'{name} version differs ({existing}); refusing to override')
        deps[name] = version
    obj['dependencies'] = dict(sorted(deps.items()))
    new_pkg = json.dumps(obj, ensure_ascii=False, indent=2) + '\n'
    if package.read_text(encoding='utf-8') != new_pkg:
        changes[package] = new_pkg

    lines = workspace.read_text(encoding='utf-8').splitlines()
    header = 'onlyBuiltDependencies:'
    if header not in lines:
        ap.error('pnpm-workspace.yaml is missing onlyBuiltDependencies; review manually.')
    start = lines.index(header)
    end = next((i for i in range(start+1, len(lines)) if lines[i] and not lines[i].startswith('  - ') and not lines[i].startswith('  #')), len(lines))
    pre = lines[:start+1]
    existing = set(line.strip().lstrip('-').strip().strip("'").strip('"') for line in lines[start+1:end] if line.strip().startswith('- '))
    for name in GRAMMAR_PACKAGES:
        existing.add(name)
    new_lines = pre + ['  - ' + json.dumps(x) for x in sorted(existing)] + lines[end:]
    new_workspace = '\n'.join(new_lines).rstrip() + '\n'
    if workspace.read_text(encoding='utf-8') != new_workspace:
        changes[workspace] = new_workspace

    print('Prepared updates:', len(changes))
    for target in changes:
        print(' -', target.relative_to(repo))
    if args.check or not changes:
        return
    backup = repo.parent / f'{repo.name}-code-rag-grammar-fix-backup'
    if backup.exists():
        ap.error('Backup directory exists; please move it aside before applying a second time')
    for target, content in changes.items():
        saved = backup / target.relative_to(repo)
        saved.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(target, saved)
    for target, content in changes.items():
        target.write_text(content, encoding='utf-8')
    print('Updated successfully. Backup:', backup)
    print('Run from repository root: pnpm install --no-frozen-lockfile')
    print('Then: pnpm --filter backend build')
    print('Then: pnpm --filter backend exec jest --runInBand code-parser.util.spec.ts code-chunker.util.spec.ts')

if __name__ == '__main__':
    main()
