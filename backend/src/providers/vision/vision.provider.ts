/**
 * Vision Provider 工厂
 *
 * 按 config.vision.provider 注入对应实现：
 *   - mock: MockVisionProvider（默认，无需外部依赖）
 *   - openai-compatible: OpenAiVisionProvider（需 VISION_API_KEY）
 */

import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IVisionProvider,
  VisionModelProvider,
  ImageGenerationRequest,
} from './vision-provider.interface';
import { MockVisionProvider } from './mock-vision.provider';
import { OpenAiVisionProvider } from './openai-vision.provider';

@Injectable()
export class VisionProvider implements IVisionProvider, OnModuleInit {
  private provider!: IVisionProvider;

  constructor(
    private readonly config: ConfigService,
    private readonly mockProvider: MockVisionProvider,
    private readonly openaiProvider: OpenAiVisionProvider,
  ) {}

  onModuleInit() {
    const providerName: VisionModelProvider =
      (this.config.get<string>('vision.provider') as VisionModelProvider) ??
      'mock';

    switch (providerName) {
      case 'openai-compatible':
        this.provider = this.openaiProvider;
        break;
      case 'mock':
      default:
        this.provider = this.mockProvider;
        break;
    }
  }

  async ocr(imageBuffer: Buffer, mimeType: string) {
    return this.provider.ocr(imageBuffer, mimeType);
  }

  async describeImage(imageBuffer: Buffer, mimeType: string, prompt?: string) {
    return this.provider.describeImage(imageBuffer, mimeType, prompt);
  }

  async describeVideo(videoBuffer: Buffer, mimeType: string) {
    if (!this.provider.describeVideo) {
      throw new Error('Video understanding not supported by current provider.');
    }
    return this.provider.describeVideo(videoBuffer, mimeType);
  }

  async generateImage(request: ImageGenerationRequest) {
    if (!this.provider.generateImage) {
      throw new Error('Image generation not supported by current provider.');
    }
    return this.provider.generateImage(request);
  }

  getCapabilities() {
    return this.provider.getCapabilities();
  }

  /** 获取当前激活的 provider 名称 */
  getActiveProviderName(): VisionModelProvider {
    return (
      (this.config.get<string>('vision.provider') as VisionModelProvider) ??
      'mock'
    );
  }
}
