#!/usr/bin/env python3
"""Offline verification of the installer safety contract and TS snippet syntax.

This is not a substitute for building the real repository after installation.
"""
from pathlib import Path
import tempfile
import shutil
import subprocess
import ast
import json
from apply_retrieval9 import Patcher, ROOT


def test_installer():
    with tempfile.TemporaryDirectory() as tmp:
        root=Path(tmp)/'RAG'
        file=root/ROOT/'rag/retrieval/mock.ts'
        file.parent.mkdir(parents=True)
        file.write_text('const current = 1;\n',encoding='utf-8')
        p=Patcher(root)
        p.replace('rag/retrieval/mock.ts','const current = 1;', 'const current = 2;','single replace')
        p.commit(check=True)
        assert file.read_text() == 'const current = 1;\n', 'check mode wrote to source'
        p.commit(check=False)
        assert file.read_text() == 'const current = 2;\n', 'commit failed'
        backup=list((root.parent/'RAG-retrieval9-backups').rglob('mock.ts'))
        assert len(backup)==1 and backup[0].read_text()== 'const current = 1;\n'
        p2=Patcher(root)
        p2.replace('rag/retrieval/mock.ts','const current = 1;', 'const current = 2;','idempotent')
        p2.commit(check=True)
        assert p2.after['rag/retrieval/mock.ts']==p2.before['rag/retrieval/mock.ts']
        p3=Patcher(root)
        try:
            p3.replace('rag/retrieval/mock.ts','not present','anything','guard')
        except RuntimeError:
            pass
        else:
            raise AssertionError('Patch guard did not reject absent anchor')
        assert file.read_text()== 'const current = 2;\n'
    print('installer transactional preflight / check / backup / idempotence: PASS')


def test_ts_syntax():
    text=Path(__file__).with_name('apply_retrieval9.py').read_text()
    tree=ast.parse(text)
    cases=[]
    for node in ast.walk(tree):
        if not isinstance(node,ast.Call) or not isinstance(node.func,ast.Attribute) or node.func.attr not in ['replace','insert_before']:
            continue
        if not isinstance(node.func.value,ast.Name) or node.func.value.id!='p':continue
        if len(node.args)!=4:continue
        try:
            new=ast.literal_eval(node.args[2]);label=ast.literal_eval(node.args[3])
        except Exception:continue
        if label in ['authority retrieval APIs','shared filter method','code file boundary helper']:
            cases.append({'name':label,'code':'class Checker {\n'+new+'\n}'})
        if label=='code index metadata helper':
            cases.append({'name':label,'code':new})
        if label in ['code symbol ranking','parallel embedding start','no early context clipping','code per-file diversification']:
            cases.append({'name':label,'code':'async function check(){\n'+new+('\n}\n}' if label == 'parallel embedding completion' else '')+'\n}'})
        if label=='PostgreSQL source rehydration':
            cases.append({'name':label,'code':'const obj = {\n'+new+'\n};'})
    cases.append({'name':'Jest suite','code':Path(__file__).with_name('retrieval9-hardening.spec.ts').read_text()})
    helper=r"""
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
const fs = require('fs');
const cases = JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
let count = 0;
for(const x of cases){
 const f=ts.createSourceFile(x.name+'.ts',x.code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 const diag=f.parseDiagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' '));
 if(diag.length){ console.error('FAILED', x.name, diag);process.exitCode=1; }
 else count++;
}
console.log('TypeScript parser syntax OK:',count+'/'+cases.length,'selected generated fragments.');
"""
    with tempfile.TemporaryDirectory() as tmp:
        path=Path(tmp)/'cases.json';path.write_text(json.dumps(cases))
        node=Path(tmp)/'check.cjs';node.write_text(helper)
        subprocess.run(['node',str(node),str(path)],check=True)

if __name__=='__main__':
    test_installer()
    test_ts_syntax()
