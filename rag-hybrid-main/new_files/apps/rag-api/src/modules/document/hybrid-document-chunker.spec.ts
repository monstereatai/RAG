import { splitHybridDocument } from './hybrid-document-chunker';
import type { ParsedDocument, ParsedBlock } from './document-parser.types';

function document(kind: ParsedDocument['kind'], blocks: ParsedBlock[]): ParsedDocument {
  return {
    kind, title: '业务资料.xlsx', blocks,
    markdown: blocks.map((b) => b.text).join('\n\n'),
    status: 'complete', completeness: 1, warnings: [],
  };
}

const split = (parsedDocument: ParsedDocument) => splitHybridDocument({
  docId: 'doc-001', filename: '业务资料.xlsx',
  content: parsedDocument.markdown, parsedDocument,
  chunkSize: 550, chunkOverlap: 70,
});

describe('hybrid document chunker', () => {
  it('keeps Excel issues and their screenshots isolated, with verified row provenance', async () => {
    const doc = document('xlsx', [
      { type:'heading', text:'工作表：bug修复', headingPath:['业务资料.xlsx','bug修复'], sheetName:'bug修复' },
      { type:'paragraph', text:'### 第 2 行\n- 模块：首页\n- 问题描述：替换按钮\n- 附件：![截图](/api/v1/documents/assets/image?key=documents%2Fuser%2F1.png)', sheetName:'bug修复', headingPath:['业务资料.xlsx','bug修复','第 2 行'], metadata:{sourceRow:2,recordId:'record-2'} },
      { type:'paragraph', text:'### 第 3 行\n- 模块：游戏页\n- 问题描述：修改文字', sheetName:'bug修复', headingPath:['业务资料.xlsx','bug修复','第 3 行'], metadata:{sourceRow:3,recordId:'record-3'} },
    ]);
    const chunks=await split(doc);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const bugA=chunks.filter(c=>c.sourceMetadata.rowStart===2);
    const bugB=chunks.filter(c=>c.sourceMetadata.rowStart===3);
    expect(bugA.length).toBeGreaterThan(0);
    expect(bugB.length).toBeGreaterThan(0);
    expect(bugA[0].sourceMetadata.assetRefs?.[0]).toContain('documents%2Fuser%2F1.png');
    expect(bugA.every(c=>!c.parentContent?.includes('修改文字'))).toBe(true);
    expect(bugA[0].parentChunkId).not.toBe(bugB[0].parentChunkId);
    expect(bugB[0].sourceMetadata.sheetName).toBe('bug修复');
  });

  it('groups API parameter tables with their endpoint and isolates the next endpoint', async () => {
    const doc=document('docx', [
      {type:'heading',text:'接口文档',headingPath:['接口文档']},
      {type:'paragraph',text:'GET /api/products',headingPath:['接口文档']},
      {type:'paragraph',text:'请求参数：id',headingPath:['接口文档']},
      {type:'table',text:'| 字段 | 说明 |\n| --- | --- |\n| id | 商品ID |',headingPath:['接口文档']},
      {type:'paragraph',text:'POST /api/orders',headingPath:['接口文档']},
      {type:'paragraph',text:'响应参数：orderId',headingPath:['接口文档']},
    ]);
    const chunks=await split(doc);
    const product=chunks.find(c=>c.parentContent?.includes('GET /api/products'));
    const orders=chunks.find(c=>c.parentContent?.includes('POST /api/orders'));
    expect(product?.parentContent).toContain('商品ID');
    expect(product?.parentContent).not.toContain('POST /api/orders');
    expect(orders?.parentContent).toContain('orderId');
    expect(product?.parentChunkId).not.toBe(orders?.parentChunkId);
  });

  it('keeps PDF page and multimedia timestamps on children', async () => {
    const pdf=document('pdf',[
      {type:'paragraph',text:'第一页条款内容',pageNumber:1,headingPath:['活动规则']},
      {type:'paragraph',text:'第二页规则说明',pageNumber:2,headingPath:['活动规则']},
    ]);
    const pdfChunks=await split(pdf);
    expect(pdfChunks.map(x=>x.sourceMetadata.pageNumber)).toEqual([1,2]);
    const audio=document('audio',[
      {type:'transcript',text:'玩家登录失败，查看日志',startSeconds:10,endSeconds:20},
      {type:'transcript',text:'已经恢复登录',startSeconds:20,endSeconds:30},
    ]);
    const audioChunks=await split(audio);
    expect(audioChunks.map(x=>x.sourceMetadata.startSeconds)).toEqual([10,20]);
    expect(audioChunks[0].parentChunkId).not.toBe(audioChunks[1].parentChunkId);
  });

  it('converts native XLSX Markdown tables to per-row business records', async () => {
    const doc=document('xlsx',[{type:'table',text:'| 模块 | 问题描述 |\n| --- | --- |\n| 首页 | 按钮错误 |\n| 活动页 | 标题错误 |',sheetName:'bug修复',headingPath:['bug修复'],metadata:{startRow:1}}]);
    const chunks=await split(doc);
    expect(chunks.length).toBe(2);
    expect(chunks[0].sourceMetadata.rowStart).toBe(2);
    expect(chunks[1].sourceMetadata.rowStart).toBe(3);
    expect(chunks[0].content).toContain('模块：首页');
    expect(chunks[0].parentContent).not.toContain('标题错误');
  });

  it('preserves pure Markdown fallback and a retrievable parent payload', async () => {
    const chunks=await splitHybridDocument({docId:'m1',filename:'guide.md',content:'# 玩法\n\n玩法说明与版本规则。',chunkSize:550,chunkOverlap:70});
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].parentContent).toContain('玩法');
    expect(chunks[0].sourceMetadata.filename).toBe('guide.md');
  });
});
