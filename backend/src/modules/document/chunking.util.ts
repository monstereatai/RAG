import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

/**
 * Markdown 文本切分器
 * 使用 RecursiveCharacterTextSplitter，按 Markdown 结构优先切分
 */
export class MarkdownChunker {
  private readonly splitter: RecursiveCharacterTextSplitter;

  constructor(chunkSize = 500, chunkOverlap = 50) {
    this.splitter = new RecursiveCharacterTextSplitter({
      chunkSize,
      chunkOverlap,
      separators: ['\n\n', '\n', '。', '！', '？', '.', '!', '?', ' ', ''],
    });
  }

  split(text: string): Promise<string[]> {
    return this.splitter.splitText(text);
  }
}
