import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { MineruCloudService } from './mineru-cloud.service';
import { convertMineruResult } from './mineru-cloud.result';

const ORIGINAL_ENV = {...process.env};
const imageBytes = Buffer.from('89504e470d0a1a0a01000000', 'hex');
const htmlTable = `<table><tr><th>模块</th><th>问题描述</th><th>附件</th><th>任务人</th></tr><tr><td>首页</td><td>替换这个按钮</td><td><img src="https://cdn-mineru.openxlab.org.cn/result/pic.png"/></td><td>黄中底</td></tr><tr><td>游戏版本页</td><td>修改文字</td><td>请保留附件说明</td><td>陈小到</td></tr></table>`;
const exampleJson = {
  pdf_info: [{
    page_idx: 0,
    para_blocks: [
      { type: 'title', lines: [{ spans: [{ type: 'text', content: 'bug修复' }] }] },
      { type: 'table', blocks: [{ lines: [{ spans: [{ type: 'table', html: htmlTable }] }] }] },
    ],
  }],
};
function xlsxFixture(): Buffer {
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([
    ['模块','问题描述','附件','任务人'],
    ['首页','替换这个按钮','','黄中底'],
    ['游戏版本页','修改文字','请保留附件说明','陈小到']
  ]),'bug修复');
  return XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}) as Buffer;
}
async function zipFixture(): Promise<JSZip> {
  const zip = new JSZip();
  zip.file('full.md','# bug修复\n\n<table></table>');
  zip.file('mineru.json',JSON.stringify(exampleJson));
  zip.file('images/pic.png',imageBytes);
  return zip;
}
afterEach(()=>{process.env={...ORIGINAL_ENV};});

describe('MinerU Cloud V4 record conversion',()=>{
  it('keeps independent Excel records, exact sheet/row, assignee, screenshot and notes',async()=>{
    const saved: Array<{key:string; contentType?:string}> = [];
    const zip=await zipFixture();
    const parsed=await convertMineruResult({
      kind:'xlsx', filename:'需求文档.xlsx', markdown:await zip.file('full.md')!.async('string'),
      json:exampleJson,zip,originalBuffer:xlsxFixture(),
      images:{ownerUserId:'test-user',storage:{async putObject(input){saved.push({key:input.key,contentType:input.contentType});return {key:input.key,url:'http://private-oss/'+input.key};}},urlResolver:stored=>'/api/v1/documents/assets/image?key='+encodeURIComponent(stored.key)},
    });
    expect(parsed.status).toBe('complete');
    expect(parsed.blocks.filter(b=>b.metadata?.recordId)).toHaveLength(2);
    expect(parsed.markdown).toContain('### 第 2 行');
    expect(parsed.markdown).toContain('### 第 3 行');
    expect(parsed.markdown).toContain('请保留附件说明');
    expect(parsed.markdown).toContain('黄中底');
    expect(parsed.markdown).toContain('/api/v1/documents/assets/image?key=');
    expect(parsed.markdown).not.toContain('cdn-mineru.openxlab.org.cn');
    expect(saved).toHaveLength(1);
    expect(saved[0].key).toMatch(/^documents\/test-user\/mineru\//);
    expect(saved[0].contentType).toBe('image/png');
  });
  it('does not invent a row number when the source workbook is absent',async()=>{
    const zip=await zipFixture();
    const parsed=await convertMineruResult({kind:'xlsx',filename:'x.xlsx',markdown:'',json:exampleJson,zip});
    expect(parsed.markdown).toContain('### 记录 1');
    expect(parsed.markdown).not.toContain('### 第 2 行');
    expect(parsed.warnings.some(w=>w.code==='mineru_image_storage_missing')).toBe(true);
  });
  it('retains plain PDF Markdown when no HTML tables are present',async()=>{
    const zip=new JSZip();
    const parsed=await convertMineruResult({kind:'pdf',filename:'guide.pdf',markdown:'# Guide\n\n## 第 1 页\n\nImportant policy text',zip});
    expect(parsed.status).toBe('complete');
    expect(parsed.markdown).toContain('Important policy text');
  });
});

describe('MinerU Cloud V4 transport',()=>{
  it('uploads, polls and reads result ZIP without sending bearer token to signed upload host', async()=>{
    process.env.MINERU_ENABLED='true';process.env.MINERU_PROVIDER='cloud_v4';process.env.MINERU_API_KEY='TEST_ONLY_TOKEN';
    const zip=await zipFixture();
    const bytes=await zip.generateAsync({type:'nodebuffer'});
    const seen: Array<{url:string;method:string;auth?:string}> = [];
    const client=new MineruCloudService();
    (client as unknown as {http: typeof fetch}).http = async (input,init) => {
      const url=String(input);
      seen.push({url,method:init?.method ?? 'GET',auth:new Headers(init?.headers).get('Authorization') ?? undefined});
      if(url.endsWith('/file-urls/batch')) return new Response(JSON.stringify({code:0,data:{batch_id:'batch1',file_urls:['https://mineru.oss-cn-shanghai.aliyuncs.com/file']}}),{status:200});
      if(url.endsWith('/file')) return new Response(null,{status:200});
      if(url.includes('extract-results/batch/')) return new Response(JSON.stringify({code:0,data:{extract_result:[{state:'done',full_zip_url:'https://cdn-mineru.openxlab.org.cn/out.zip'}]}}),{status:200});
      if(url.endsWith('/out.zip')) return new Response(new Uint8Array(bytes),{status:200});
      throw new Error('unexpected URL');
    };
    const result=await client.parse({kind:'xlsx',filename:'需求文档.xlsx',buffer:xlsxFixture()});
    expect(result.markdown).toContain('替换这个按钮');
    expect(seen.map(x=>x.method)).toEqual(['POST','PUT','GET','GET']);
    expect(seen[1].auth).toBeUndefined();
    expect(seen[0].auth).toBe('Bearer TEST_ONLY_TOKEN');
  });
  it('is opt-in and disabled by default',()=>{
    const client=new MineruCloudService();
    delete process.env.MINERU_ENABLED;
    expect(client.accepts('xlsx')).toBe(false);
  });
});
