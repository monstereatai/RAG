/**
 * Mock 视觉 Provider
 *
 * 不依赖任何外部服务，返回 fixture 预设文本。
 * 用于开发、测试、和视觉 key 未配置时的降级运行。
 */

import { Injectable } from '@nestjs/common';
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
export class MockVisionProvider implements IVisionProvider {
  async ocr(_imageBuffer: Buffer, _mimeType: string): Promise<OcrResult> {
    return {
      text: 'Mock OCR: Dashboard 截图识别结果。包含模块：SLA、工单统计、响应时间。',
      confidence: 0.85,
      blocks: [
        { text: '客户 SLA 概览', boundingBox: [10, 10, 200, 40], confidence: 0.9 },
        { text: '一级工单响应时间: 1.2h', boundingBox: [10, 50, 250, 70], confidence: 0.88 },
        { text: '待处理工单: 4', boundingBox: [10, 80, 180, 100], confidence: 0.82 },
      ],
    };
  }

  async describeImage(
    _imageBuffer: Buffer,
    _mimeType: string,
    _prompt?: string,
  ): Promise<ImageDescription> {
    return {
      description:
        'Mock 图片描述：这是一个企业管理后台 Dashboard 截图，' +
        '展示了客户 SLA 概览看板，包含一级工单响应时间、待处理工单数量和升级状态。',
      tags: ['dashboard', 'SLA', '工单', '企业后台'],
      confidence: 0.82,
    };
  }

  async describeVideo(
    _videoBuffer: Buffer,
    _mimeType: string,
  ): Promise<VideoDescription> {
    return {
      summary:
        'Mock 视频理解：这是一个审批培训视频。' +
        '讲解了采购合同超过 50 万元时需要法务复核和财务复核，以及新供应商准入的材料要求。',
      keyframes: [
        { timestampMs: 0, description: '培训视频开始，标题：审批流程培训' },
        { timestampMs: 5000, description: '讲解采购合同审批流程' },
        { timestampMs: 15000, description: '讲解供应商准入材料要求' },
      ],
      transcript:
        '采购合同超过 50 万元时，需要法务复核和财务复核。' +
        '新供应商准入必须提供营业执照、对公账户证明和近一年合规承诺书。',
      entities: ['法务复核', '财务复核', '供应商准入', '合规承诺书'],
      confidence: 0.78,
    };
  }

  async generateImage(_request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    return {
      base64: '',
      mimeType: 'image/png',
    };
  }

  getCapabilities(): VisionCapabilities {
    return {
      ocr: true,
      imageUnderstanding: true,
      videoUnderstanding: true,
      imageGeneration: false,
      providerName: 'mock',
    };
  }
}
