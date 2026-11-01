#!/usr/bin/env python3
"""Safely apply the hybrid RAG changes to monstereatai/RAG main (no remote push)."""
import json,subprocess,sys,os,tempfile
from pathlib import Path

def main():
    root=Path.cwd()
    if not (root/'apps/rag-api/package.json').is_file():
        raise SystemExit('ERROR: run in the RAG repository root (apps/rag-api not found).')
    result=subprocess.run(['git','branch','--show-current'],capture_output=True,text=True,cwd=root)
    branch=result.stdout.strip() if result.returncode==0 else ''
    if branch and branch!='main':
        raise SystemExit(f'ERROR: current branch {branch}, expected main; nothing changed.')
    here=Path(__file__).resolve().parent
    changes=json.loads((here/'changes.json').read_text(encoding='utf-8'))
    new_files=[file for file in (here/'new_files').rglob('*') if file.is_file()]
    if (new_files and all((root/file.relative_to(here/'new_files')).is_file() and
           (root/file.relative_to(here/'new_files')).read_bytes()==file.read_bytes()
           for file in new_files) and
           "import { splitHybridDocument }" in (root/'apps/rag-api/src/modules/document/document.service.upload-workflow.ts').read_text(encoding='utf-8')):
        print('Hybrid RAG integration already installed; no files changed.')
        return
    target={}
    applied=[]
    for rel,repls in changes.items():
        file=root/rel
        if not file.is_file(): raise SystemExit(f'ERROR: file missing {rel}; nothing changed.')
        original=file.read_text(encoding='utf-8')
        content=original
        for old,new in repls:
            if new in content:
                # Already applied, possibly by a prior run.
                continue
            elif old in content:
                content=content.replace(old,new)
            else:
                raise SystemExit(f'ERROR: main contents changed; cannot match edit in {rel}: {old[:65]!r}; nothing changed.')
        if content!=original:
            target[file]=content
            applied.append(rel)
    for newfile in (here/'new_files').rglob('*'):
        if not newfile.is_file(): continue
        relative=newfile.relative_to(here/'new_files')
        destination=root/relative
        content=newfile.read_bytes()
        if destination.is_file():
            if destination.read_bytes()!=content:
                raise SystemExit(f'ERROR: new file already exists with different contents: {relative}; nothing changed.')
        else: target[destination]=content
    # Full validation is complete. Only now write the approved files.
    for file,contents in target.items():
        file.parent.mkdir(parents=True,exist_ok=True)
        data=contents.encode('utf-8') if isinstance(contents,str) else contents
        fd,temp=tempfile.mkstemp(prefix='.rag-hybrid-',dir=str(file.parent))
        try:
            with os.fdopen(fd,'wb') as stream: stream.write(data)
            os.replace(temp,file)
        finally:
            if os.path.exists(temp): os.unlink(temp)
    print(f'Applied hybrid RAG changes: {len(target)} files. No Git commit or push performed.')
    print('Next: pnpm --filter backend exec jest --runInBand hybrid-document-chunker.spec.ts hybrid-context-builder.spec.ts')
    print('Next: pnpm --filter backend build')
    print('Run DB migration with your existing deployment process before enabling in production.')
if __name__=='__main__': main()
