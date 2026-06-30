/**
 * OpenAI 兼容视觉 Provider
 *
 * 接入 Qwen-VL / GPT-4V 等兼容 OpenAI Chat Completions API 的视觉模型。
 * 无需额外 npm 依赖，直接使用原生 fetch。
 * 需配置 VISION_API_KEY 或 QWEN_VL_API_KEY。
 *
 * 如果环境中没有 vision key，构造时自动标记为不可用，
 * 调用方法时会抛出明确错误，不会静默失败。
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IVisionProvider,
  OcrResult,
  ImageDescription,
  VideoDescription,
  ImageGenerationRequest,
  ImageGenerationResult,
  VisionCapabilities,
} from './vision-provider.interface';

@Injectable()
export class OpenAiVisionProvider implements IVisionProvider {
  private readonly logger = new Logger(OpenAiVisionProvider.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly enabled: boolean;

  constructor(config: ConfigService) {
    this.apiKey =
      config.get<string>('vision.apiKey') ||
      config.get<string>('vision.qwenVlApiKey') ||
      '';
    this.baseUrl =
      config.get<string>('vision.baseUrl') ||
      'https://dashscope.aliyuncs.com/compatible-mode/v1';
    this.model = config.get<string>('vision.model') || 'qwen-vl-max';
    this.enabled = Boolean(this.apiKey);

    if (this.enabled) {
      this.logger.log(
        `OpenAiVisionProvider ready: model=${this.model}`,
      );
    } else {
      this.logger.warn(
        'OpenAiVisionProvider created WITHOUT api key — ' +
        'all vision calls will fail until VISION_API_KEY or QWEN_VL_API_KEY is configured. ' +
        'Use VISION_PROVIDER=mock for development without a key.',
      );
    }
  }

  async ocr(imageBuffer: Buffer, mimeType: string): Promise<OcrResult> {
    this.assertEnabled();
    const body = this.buildChatBody([
      { type: 'text', text: '请识别这张图片中的所有文字，按原文顺序输出。只输出文字内容，不要额外说明。' },
      { type: 'image_url', image_url: { url: this.imageToDataUrl(imageBuffer, mimeType) } },
    ]);
    const text = await this.postChat(body);
    return { text, confidence: 0.9 };
  }

  async describeImage(
    imageBuffer: Buffer,
    mimeType: string,
    prompt?: string,
  ): Promise<ImageDescription> {
    this.assertEnabled();
    const userPrompt = prompt || '请描述这张图片的内容，包括主要对象、场景、文字信息和关键细节。';
    const body = this.buildChatBody([
      { type: 'text', text: userPrompt },
      { type: 'image_url', image_url: { url: this.imageToDataUrl(imageBuffer, mimeType) } },
    ]);
    const description = await this.postChat(body);
    return { description, tags: [], confidence: 0.88 };
  }

  async describeVideo(
    _videoBuffer: Buffer,
    _mimeType: string,
  ): Promise<VideoDescription> {
    throw new Error(
      'Direct video understanding not supported by this provider. ' +
      'Use ffmpeg to extract keyframes and audio first, then call describeImage/ocr individually.',
    );
  }

  async generateImage(_request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    throw new Error('Image generation not supported by this provider.');
  }

  getCapabilities(): VisionCapabilities {
    return {
      ocr: this.enabled,
      imageUnderstanding: this.enabled,
      videoUnderstanding: false,
      imageGeneration: false,
      providerName: 'openai-compatible',
    };
  }

  /* ── private helpers ────────────────────────────────────── */

  private assertEnabled(): void {
    if (!this.enabled) {
      throw new Error(
        'Vision provider not configured. Set VISION_API_KEY or QWEN_VL_API_KEY, ' +
        'or use VISION_PROVIDER=mock for development.',
      );
    }
  }

  private imageToDataUrl(buffer: Buffer, mimeType: string): string {
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  }

  private buildChatBody(content: Array<Record<string, unknown>>): object {
    return {
      model: this.model,
      messages: [{ role: 'user', content }],
      max_tokens: 1024,
    };
  }

  private async postChat(body: object): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `Vision API error: ${response.status} ${response.statusText} — ${text.slice(0, 200)}`,
      );
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
    };
    return data.choices?.[0]?.message?.content ?? '';
  }
}
