import { BadRequestException } from '@nestjs/common';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import {
  extractDocxText,
  extractPptxText,
  extractWorkbookText,
  parsePptxDocument,
  parseOfficeDocument,
} from './document-parser.office';

describe('Office document parsing', () => {
  it('keeps DOCX headings, paragraphs, tables, image position, and Mammoth warnings', async () => {
    const parsed = await parseOfficeDocument(await createDocxSample(), 'docx');

    expect(parsed.status).toBe('partial');
    expect(parsed.blocks.map((block) => block.type)).toEqual([
      'heading',
      'paragraph',
      'table',
      'image',
    ]);
    expect(parsed.blocks[0]).toMatchObject({ text: '销售政策', level: 1 });
    expect(parsed.blocks[2]?.text).toContain('折扣');
    expect(parsed.blocks[2]?.text).toContain('15%');
    expect(parsed.blocks[3]?.asset).toMatchObject({
      alt: '组织架构图',
      mimeType: 'image/png',
    });
    expect(
      parsed.warnings.some(
        (warning) => warning.code === 'docx_image_not_materialized',
      ),
    ).toBe(true);
    expect(
      parsed.warnings.some((warning) => warning.code.startsWith('mammoth_')),
    ).toBe(true);
    expect(parsed.markdown).toContain('# 销售政策');
  });

  it('retains XLSX sheet names, row and column values, and source range metadata', async () => {
    const parsed = await parseOfficeDocument(createXlsxSample(), 'xlsx');

    expect(parsed.status).toBe('complete');
    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.blocks[0]).toMatchObject({
      type: 'table',
      sheetName: '部门预算',
      metadata: {
        rows: 3,
        columns: 2,
        startRow: 1,
        endRow: 3,
        cellRange: 'A1:B3',
      },
    });
    expect(parsed.blocks[0]?.text).toContain('研发');
    expect(parsed.blocks[0]?.text).toContain('12');
    expect(extractWorkbookText(createXlsxSample())).toContain('## 部门预算');
  });

  it('parses PPTX slide text, tables, image placement, and cached chart data', async () => {
    const parsed = await parseOfficeDocument(await createPptxSample(), 'pptx');

    expect(parsed.status).toBe('partial');
    expect(
      parsed.blocks.some(
        (block) => block.type === 'heading' && block.text.includes('季度营收'),
      ),
    ).toBe(true);
    expect(
      parsed.blocks.some(
        (block) =>
          block.type === 'paragraph' && block.text.includes('季度销售汇总'),
      ),
    ).toBe(true);
    expect(
      parsed.blocks.some(
        (block) => block.type === 'table' && block.text.includes('华东'),
      ),
    ).toBe(true);
    expect(
      parsed.blocks.some(
        (block) => block.type === 'image' && block.asset?.alt === '趋势图',
      ),
    ).toBe(true);
    const chart = parsed.blocks.find((block) => block.type === 'chart');
    expect(chart?.text).toContain('季度销售额');
    expect(chart?.text).toContain('华东');
    expect(chart?.text).toContain('120');
    expect(await extractPptxText(await createPptxSample())).toContain(
      '季度销售额',
    );
  });

  it('marks invalid Office containers as failed and never returns printable binary text', async () => {
    const invalid = Buffer.from(
      'binary-looking-invalid-document-ABC123',
      'utf8',
    );
    const parsed = await parseOfficeDocument(invalid, 'docx');

    expect(parsed.status).toBe('failed');
    expect(parsed.markdown).toBe('');
    expect(parsed.blocks).toHaveLength(0);
    expect(parsed.warnings).toContainEqual(
      expect.objectContaining({ code: 'docx_parse_failed' }),
    );
    await expect(extractDocxText(invalid)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect((await parseOfficeDocument(invalid, 'pptx')).status).toBe('failed');
    expect((await parseOfficeDocument(invalid, 'xlsx')).status).toBe('failed');
  });

  it('does not treat an empty PPTX slide heading as indexable document content', async () => {
    const parsed = await parseOfficeDocument(
      await createEmptyPptxSample(),
      'pptx',
    );

    expect(parsed.status).toBe('failed');
    expect(parsed.blocks).toHaveLength(0);
    expect(parsed.markdown).toBe('');
    expect(parsed.warnings).toContainEqual(
      expect.objectContaining({ code: 'document_content_empty' }),
    );
  });

  it('records a ParsedDocument warning when PPTX image extraction reaches its limit', async () => {
    const previousLimit = process.env.DOCUMENT_IMAGE_MAX_COUNT;
    process.env.DOCUMENT_IMAGE_MAX_COUNT = '1';
    try {
      const parsed = await parsePptxDocument(
        await createPptxSampleWithTwoImages(),
        {
          storage: {
            putObject: ({ key }) =>
              Promise.resolve({
                key,
                url: `https://storage.test/${key}`,
              }),
          },
          docId: 'office-fixture',
        },
      );

      expect(parsed.warnings).toContainEqual(
        expect.objectContaining({ code: 'pptx_image_limit_reached' }),
      );
      expect(parsed.status).toBe('partial');
    } finally {
      if (previousLimit === undefined) {
        delete process.env.DOCUMENT_IMAGE_MAX_COUNT;
      } else {
        process.env.DOCUMENT_IMAGE_MAX_COUNT = previousLimit;
      }
    }
  });
});

async function createDocxSample(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>`,
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
 <w:body>
  <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>销售政策</w:t></w:r></w:p>
  <w:p><w:r><w:t>年度折扣必须经过审批。</w:t></w:r></w:p>
  <w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>
   <w:tr><w:tc><w:p><w:r><w:t>项目</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>规则</w:t></w:r></w:p></w:tc></w:tr>
   <w:tr><w:tc><w:p><w:r><w:t>折扣</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>15%</w:t></w:r></w:p></w:tc></w:tr>
  </w:tbl>
  <w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="95250" cy="95250"/><wp:docPr id="1" name="图示" descr="组织架构图"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="image1.png"/><pic:cNvPicPr><a:picLocks noChangeAspect="1"/></pic:cNvPicPr></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId2"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="95250" cy="95250"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
  <w:sectPr/>
 </w:body>
</w:document>`,
  );
  zip.file(
    'word/media/image1.png',
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/XxkAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

function createXlsxSample(): Buffer {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ['部门', '人数'],
    ['研发', 12],
    ['销售', 8],
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, '部门预算');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

async function createPptxSample(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>
</Types>`,
  );
  zip.file(
    'ppt/presentation.xml',
    `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`,
  );
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`,
  );
  zip.file(
    'ppt/slides/_rels/slide1.xml.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/></Relationships>`,
  );
  zip.file(
    'ppt/slides/slide1.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">
 <p:cSld><p:spTree>
  <p:nvGrpSpPr/><p:grpSpPr/>
  <p:sp><p:nvSpPr><p:cNvPr id="2" name="标题"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>季度营收</a:t></a:r></a:p></p:txBody></p:sp>
  <p:sp><p:nvSpPr><p:cNvPr id="3" name="正文"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>季度销售汇总</a:t></a:r></a:p></p:txBody></p:sp>
  <p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="表格"/><p:cNvGraphicFramePr/><p:nvGraphicFramePr/></p:nvGraphicFramePr><p:xfrm/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tr><a:tc><a:p><a:r><a:t>地区</a:t></a:r></a:p></a:tc><a:tc><a:p><a:r><a:t>金额</a:t></a:r></a:p></a:tc></a:tr><a:tr><a:tc><a:p><a:r><a:t>华东</a:t></a:r></a:p></a:tc><a:tc><a:p><a:r><a:t>120</a:t></a:r></a:p></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>
  <p:pic><p:nvPicPr><p:cNvPr id="5" name="图表图片" descr="趋势图"/><p:cNvPicPr/><p:nvPicPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/></p:blipFill><p:spPr/></p:pic>
  <p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="Chart 1"/><p:cNvGraphicFramePr/><p:nvGraphicFramePr/></p:nvGraphicFramePr><p:xfrm/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId3"/></a:graphicData></a:graphic></p:graphicFrame>
 </p:spTree></p:cSld></p:sld>`,
  );
  zip.file(
    'ppt/charts/chart1.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>季度销售额</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:barChart><c:ser><c:tx><c:strRef><c:strCache><c:pt idx="0"><c:v>华东</c:v></c:pt></c:strCache></c:strRef></c:tx><c:cat><c:strRef><c:strCache><c:pt idx="0"><c:v>第一季度</c:v></c:pt><c:pt idx="1"><c:v>第二季度</c:v></c:pt></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:numCache><c:pt idx="0"><c:v>120</c:v></c:pt><c:pt idx="1"><c:v>150</c:v></c:pt></c:numCache></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>`,
  );
  zip.file(
    'ppt/media/image1.png',
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/XxkAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function createEmptyPptxSample(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`,
  );
  zip.file(
    'ppt/presentation.xml',
    `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`,
  );
  zip.file(
    'ppt/slides/slide1.xml',
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree/></p:cSld></p:sld>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function createPptxSampleWithTwoImages(): Promise<Buffer> {
  const zip = await JSZip.loadAsync(await createPptxSample());
  const slideFile = zip.file('ppt/slides/slide1.xml');
  const relsFile = zip.file('ppt/slides/_rels/slide1.xml.rels');
  if (!slideFile || !relsFile) throw new Error('PPTX fixture is incomplete.');
  const [slideXml, relsXml] = await Promise.all([
    slideFile.async('text'),
    relsFile.async('text'),
  ]);
  zip.file(
    'ppt/slides/slide1.xml',
    slideXml.replace(
      '</p:spTree>',
      `<p:pic><p:nvPicPr><p:cNvPr id="7" name="second" descr="第二张图"/><p:cNvPicPr/><p:nvPicPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId4"/></p:blipFill><p:spPr/></p:pic></p:spTree>`,
    ),
  );
  zip.file(
    'ppt/slides/_rels/slide1.xml.rels',
    relsXml.replace(
      '</Relationships>',
      `<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image2.png"/></Relationships>`,
    ),
  );
  zip.file(
    'ppt/media/image2.png',
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/XxkAAAAASUVORK5CYII=',
      'base64',
    ),
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}
