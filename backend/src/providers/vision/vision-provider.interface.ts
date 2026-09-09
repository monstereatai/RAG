/**
 * 视觉 / 视频理解 Provider 抽象接口
 *
 * 可插拔：mock | openai-compatible (qwen-vl)
 *
 * 当前实现：
 * - mock：不依赖任何外部服务，返回 fixture 预设文本
 * - openai-compatible：接入 Qwen-VL / GPT-4V 等视觉模型
 */

/** OCR 识别结果 */
export interface OcrResult {
  text: string;
  confidence: number;
  blocks?: Array<{
    text: string;
    boundingBox?: [number, number, number, number];
    confidence: number;
  }>;
}

/** 图片描述结果 */
export interface ImageDescription {
  description: string;
  tags: string[];
  confidence: number;
}

/** 视频理解结果 */
export interface VideoDescription {
  /** 视频整体描述 */
  summary: string;
  /** 关键帧描述（时间戳 → 描述） */
  keyframes: Array<{ timestampMs: number; description: string }>;
  /** 音频转写（如有） */
  transcript: string;
  /** 抽取的结构化信息 */
  entities: string[];
  confidence: number;
}

/** 图片生成请求 */
export interface ImageGenerationRequest {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  style?: string;
}

/** 图片生成结果 */
export interface ImageGenerationResult {
  /** base64 编码的图片数据 */
  base64: string;
  /** MIME 类型（如 image/png） */
  mimeType: string;
}

/** 视觉 Provider 能力声明 */
export interface VisionCapabilities {
  /** 是否支持 OCR */
  ocr: boolean;
  /** 是否支持图片理解 */
  imageUnderstanding: boolean;
  /** 是否支持视频理解 */
  videoUnderstanding: boolean;
  /** 是否支持图片生成 */
  imageGeneration: boolean;
  /** Provider 名称 */
  providerName: string;
}

export const VISION_PROVIDER_TOKEN = 'VISION_PROVIDER';

export interface IVisionProvider {
  /**
   * OCR 识别图片中的文字
   * @param imageBuffer 图片二进制数据
   * @param mimeType 图片 MIME 类型
   */
  ocr(imageBuffer: Buffer, mimeType: string): Promise<OcrResult>;

  /**
   * 图片理解：生成图片的自然语言描述
   * @param imageBuffer 图片二进制数据
   * @param mimeType 图片 MIME 类型
   * @param prompt 可选的自定义描述指令
   */
  describeImage(
    imageBuffer: Buffer,
    mimeType: string,
    prompt?: string,
  ): Promise<ImageDescription>;

  /**
   * 视频理解：解析视频的画面和音频内容
   * @param videoBuffer 视频二进制数据
   * @param mimeType 视频 MIME 类型
   */
  describeVideo?(
    videoBuffer: Buffer,
    mimeType: string,
  ): Promise<VideoDescription>;

  /**
   * 图片生成：根据文本描述生成图片
   */
  generateImage?(
    request: ImageGenerationRequest,
  ): Promise<ImageGenerationResult>;

  /**
   * 获取 provider 能力声明
   */
  getCapabilities(): VisionCapabilities;
}

/** 标准的 vision provider 类型 */
export type VisionModelProvider = 'mock' | 'openai-compatible';
