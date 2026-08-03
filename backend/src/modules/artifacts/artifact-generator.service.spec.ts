import * as XLSX from 'xlsx';
import { GeneratedArtifactEntity } from '../../providers/db/entities/generated-artifact.entity';
import { ArtifactGeneratorService } from './artifact-generator.service';
import { DashScopeImageService } from './dashscope-image.service';

describe('ArtifactGeneratorService', () => {
  const generateImage = jest.fn().mockResolvedValue(Buffer.from('png-content'));
  const imageService = {
    generate: generateImage,
  } as unknown as DashScopeImageService;
  const service = new ArtifactGeneratorService(imageService);

  const artifact = (kind: GeneratedArtifactEntity['kind']) =>
    Object.assign(new GeneratedArtifactEntity(), {
      id: 'artifact-1',
      ownerUserId: 'user-1',
      threadId: null,
      title: '活动评审材料',
      kind,
      status: 'generating',
      filename: 'artifact',
      sourceText:
        '# 目标\n\n- 提升预约转化\n\n| 阶段 | 负责人 |\n| --- | --- |\n| 开发 | 前端 |',
      prompt: '游戏周年庆主视觉',
    });

  it('generates valid markdown, Word, Excel and SVG buffers', async () => {
    const markdown = await service.generate(artifact('markdown'));
    const word = await service.generate(artifact('word'));
    const excel = await service.generate(artifact('excel'));
    const architecture = await service.generate(artifact('architecture'));

    expect(markdown.body.toString()).toContain('# 目标');
    expect(word.body.subarray(0, 2).toString()).toBe('PK');
    expect(XLSX.read(excel.body).SheetNames).toEqual(['表格1']);
    expect(architecture.body.toString()).toContain('<svg');
    expect(architecture.body.toString()).toContain('活动评审材料');
  });

  it('uses the real image provider boundary for PNG generation', async () => {
    const result = await service.generate(artifact('image'));

    expect(generateImage).toHaveBeenCalledWith('游戏周年庆主视觉');
    expect(result.contentType).toBe('image/png');
    expect(result.body.toString()).toBe('png-content');
  });
});
