export type SupportedDocumentKind =
  | 'markdown'
  | 'text'
  | 'pdf'
  | 'docx'
  | 'doc'
  | 'xlsx'
  | 'xls'
  | 'pptx'
  | 'ppt'
  | 'csv'
  | 'json'
  | 'html'
  | 'image'
  | 'audio'
  | 'video';

export type ParsedDocumentStatus = 'complete' | 'partial' | 'failed';

export type ParsedBlockType =
  | 'title'
  | 'heading'
  | 'paragraph'
  | 'table'
  | 'image'
  | 'chart'
  | 'transcript'
  | 'frame';

/** 文档解析后保留的一个可定位内容块。 */
export interface ParsedBlock {
  type: ParsedBlockType;
  text: string;
  level?: number;
  headingPath?: string[];
  pageNumber?: number;
  slideNumber?: number;
  sheetName?: string;
  sourceStart?: number;
  sourceEnd?: number;
  startSeconds?: number;
  endSeconds?: number;
  asset?: {
    url?: string;
    mimeType?: string;
    alt?: string;
  };
  metadata?: Record<string, string | number | boolean | null>;
}

export interface ParsedDocumentWarning {
  code: string;
  message: string;
  pageNumber?: number;
  slideNumber?: number;
  sheetName?: string;
  startSeconds?: number;
  endSeconds?: number;
}

/** 解析结果只描述文件内容，不持有入库、权限或索引行为。 */
export interface ParsedDocument {
  kind: SupportedDocumentKind;
  title: string;
  blocks: ParsedBlock[];
  markdown: string;
  status: ParsedDocumentStatus;
  completeness: number;
  warnings: ParsedDocumentWarning[];
}

export interface UrlExtractionResult {
  content: string;
  title?: string;
  description?: string;
  finalUrl: string;
  contentType: string;
  fetchedAt: string;
  snapshot: Buffer;
  extractionMode: 'static' | 'dynamic';
  renderError?: string;
}

/**
 * 扫描件 PDF 兜底 OCR 所需的最小能力接口。
 *
 * 只要实现方带 `ocr(imageBuffer, mimeType)` 并返回含 `text` 的结果即可，
 * VisionProvider（mock / openai-compatible）天然满足该结构，
 * 因此控制器可以直接把 visionProvider 传入 extractDocumentText。
 */
export interface DocumentOcrDelegate {
  ocr(imageBuffer: Buffer, mimeType: string): Promise<{ text: string }>;
}

/** 渲染出的一页页图，供 OCR 按顺序识别 */
export interface PdfPageImage {
  num: number;
  buffer: Buffer;
  mimeType: string;
}

/* ── 内嵌图片提取：对象存储 / alt 描述的注入接口 ──
 *
 * 与 DocumentOcrDelegate 同一风格：解析器只依赖最小能力接口，
 * Nest 侧直接把 ObjectStorageProvider / VisionProvider 传入（方法签名天然对齐）。
 */
/**
 * 内嵌图片上传所需的对象存储最小能力接口。
 * ObjectStorageProvider.putObject 天然满足该结构。
 */
export interface DocumentImageStorageDelegate {
  putObject(params: {
    key: string;
    body: Buffer;
    contentType?: string;
  }): Promise<{ key: string; url: string }>;
}

/**
 * 内嵌图片 alt 描述所需的最小能力接口。
 * VisionProvider.describeImage 天然满足该结构（返回值只需含 description）。
 */
export interface DocumentImageAltDelegate {
  describeImage(
    imageBuffer: Buffer,
    mimeType: string,
    prompt?: string,
  ): Promise<{ description: string; tags?: string[] }>;
}

export interface DocumentImageUnderstandingDelegate
  extends DocumentOcrDelegate, DocumentImageAltDelegate {
  getCapabilities(): { ocr: boolean; imageUnderstanding: boolean };
}

/** 内嵌图片提取的注入参数（由控制器组装后传入 extractDocumentText） */
export interface DocumentImageExtractionOptions {
  /** 对象存储上传委托；缺省或调用异常时整个提取功能静默跳过，不影响主入库链路 */
  storage: DocumentImageStorageDelegate;
  /** 可选的图片描述委托（通常传 VisionProvider）；未提供时 alt 直接使用文件名 */
  vision?: DocumentImageAltDelegate;
  /** 对象存储路径中的文档标识；缺省用时间戳占位 */
  docId?: string;
  /** 对象存储路径中的用户/租户标识；用于生成受控代理可校验的 key 前缀 */
  ownerUserId?: string;
  /** 把对象存储返回的真实地址改写为后端受控代理地址 */
  urlResolver?: (stored: { key: string; url: string }) => string;
}

/**
 * 视频音轨转写所需的最小能力接口。
 *
 * 只要实现方带 `transcribe(audioBuffer, format)` 并返回文本即可，
 * TencentSpeechProvider（腾讯云一句话识别）天然满足该结构，
 * 因此控制器可以直接把 speechProvider 传入 extractDocumentText。
 */
export interface DocumentAsrDelegate {
  transcribe(audioBuffer: Buffer, format: string): Promise<string>;
  isEnabled?(): boolean;
}

/**
 * 视频入库（ffmpeg 抽音轨 + 关键帧）的注入参数（由控制器组装后传入 extractDocumentText）。
 *
 * 与 DocumentImageExtractionOptions 同一风格：解析器只依赖最小能力接口，
 * 委托缺省时对应段落降级为提示文案，不阻塞入库。
 */
export interface DocumentVideoExtractionOptions {
  /** 对象存储上传委托（帧图上传到 documents/{docId}/frames/） */
  storage: DocumentImageStorageDelegate;
  /** 音轨转写委托（通常传 TencentSpeechProvider）；未提供时转写段落写降级文案 */
  asr?: DocumentAsrDelegate;
  /** 关键帧画面描述委托（通常传 VisionProvider）；未提供时只保留帧图 */
  vision?: DocumentImageAltDelegate;
  /** 对象存储路径中的文档标识；缺省用时间戳占位 */
  docId?: string;
  /** 对象存储路径中的用户/租户标识；用于生成受控代理可校验的 key 前缀 */
  ownerUserId?: string;
  /** 把对象存储返回的真实地址改写为后端受控代理地址 */
  urlResolver?: (stored: { key: string; url: string }) => string;
  /** 视频文件名（写入 Markdown 标题与概览）；缺省用 Document 占位 */
  filename?: string;
}

/** 提取到的内嵌图片（已归属到页/slide，等待上传） */
export interface EmbeddedImageAsset {
  /** 归属标签，同时用于对象存储 key（如 page-2 / slide-3 / misc） */
  placement: string;
  /** 归属序号：PDF 页码或 PPTX slide 序号；0 表示无法归属（统一进「文稿插图」） */
  position: number;
  buffer: Buffer;
  mimeType: string;
  /** 兜底文件名（未配置 vision 或 alt 生成失败时用作 alt） */
  filename: string;
}

/** 上传完成并生成 alt 后的内嵌图片，可直接渲染为 `![alt](url)` */
export interface UploadedEmbeddedImage {
  position: number;
  url: string;
  alt: string;
}

export interface PlaywrightModule {
  chromium: {
    launch(options: { headless: boolean }): Promise<PlaywrightBrowser>;
  };
}

export interface PlaywrightBrowser {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

export interface PlaywrightPage {
  route(
    pattern: string,
    handler: (route: PlaywrightRoute) => Promise<void>,
  ): Promise<void>;
  goto(
    url: string,
    options: {
      waitUntil: 'load' | 'domcontentloaded' | 'networkidle';
      timeout: number;
    },
  ): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  content(): Promise<string>;
  url(): string;
}

export interface PlaywrightRoute {
  request(): { url(): string };
  abort(errorCode?: string): Promise<void>;
  continue(): Promise<void>;
}

/** ffprobe 探测结果（时长 + 分辨率 + 流构成） */
export interface VideoProbeResult {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  hasVideoStream: boolean;
  hasAudioStream: boolean;
}

/** 抽出的关键帧（等待上传与描述） */
export interface VideoFrameAsset {
  /** 1-based 帧序号 */
  index: number;
  /** 抽帧时刻（秒，约等于 (序号-1) × 抽帧间隔） */
  timestampSeconds: number;
  buffer: Buffer;
}

/** 上传后的关键帧，可渲染为 `### 第 N 帧（mm:ss）` + `![frame](url)` */
export interface UploadedVideoFrame {
  index: number;
  timestampSeconds: number;
  /** 对象存储外链；上传整体失败时为 null（降级为仅保留时间戳） */
  url: string | null;
  /** 画面描述；未配置 vision 或生成失败时为 null（由合成阶段写降级文案） */
  description: string | null;
}

/** ffprobe -of json 的最小输出结构 */
export interface VideoProbeJson {
  format?: { duration?: string };
  streams?: Array<{
    codec_type?: string;
    width?: number;
    height?: number;
  }>;
}

/**
 * pdfjs-dist legacy build 用到的最小 API 面。
 * 该包为 ESM-only 且版本迭代快，此处只声明渲染扫描页、
 * 遍历内嵌图片算子（getOperatorList/objs）所需的方法与常量。
 */
export interface PdfjsModule {
  GlobalWorkerOptions: { workerSrc: string };
  OPS: Record<string, number>;
  getDocument(params: Record<string, unknown>): {
    promise: Promise<PdfjsDocument>;
    destroy(): Promise<void>;
  };
}

export interface PdfjsDocument {
  numPages: number;
  getPage(num: number): Promise<PdfjsPage>;
}

export interface PdfjsPage {
  getViewport(params: { scale: number }): { width: number; height: number };
  render(params: Record<string, unknown>): { promise: Promise<unknown> };
  cleanup(): Promise<void>;
  /** 页面算子表：内嵌图片经 paintImageXObject 等算子引用，args 里带 objId */
  getOperatorList(): Promise<{
    fnArray: number[];
    argsArray: unknown[][];
  }>;
  /** 页面级对象仓库：图片解码结果按 objId 存放，getOperatorList 后可能尚未就绪 */
  objs: PdfjsObjects;
  commonObjs?: PdfjsObjects;
}

/** pdfjs 对象仓库（页内 objs / 文档级 commonObjs 的最小能力面） */
export interface PdfjsObjects {
  get(objId: string, callback?: (data: unknown) => void): unknown;
  has?(objId: string): boolean;
}

/** pdfjs 解码后的图片对象：kind 见 PDFJS_IMAGE_KIND，ref 为 PDF 对象引用 */
export interface PdfjsImageData {
  width: number;
  height: number;
  kind?: number;
  data?: Uint8Array | Uint8ClampedArray;
  ref?: unknown;
}

/** @napi-rs/canvas 用到的最小 API 面（画布创建 + DOM 对象 polyfill） */
export interface NapiCanvasModule {
  createCanvas(width: number, height: number): NapiCanvas;
  DOMMatrix?: unknown;
  Path2D?: unknown;
  ImageData?: unknown;
}

export interface NapiCanvas {
  width: number;
  height: number;
  getContext(kind: '2d'): unknown;
  toBuffer(format: 'image/png'): Buffer;
}

/** PPTX 内嵌图提取结果：按 slide 归属 + 无法归属的统一段 */
export interface PptxImageAssets {
  bySlide: Map<number, EmbeddedImageAsset[]>;
  unattributed: EmbeddedImageAsset[];
}
