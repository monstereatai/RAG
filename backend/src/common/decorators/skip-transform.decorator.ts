import { SetMetadata } from '@nestjs/common';

export const SKIP_TRANSFORM_KEY = 'skip_transform';

/**
 * 跳过全局 TransformInterceptor 的 { code, data, message } 包裹。
 * 适用于必须返回非 JSON 原文的接口（如 Prometheus 指标文本）。
 */
export const SkipTransform = () => SetMetadata(SKIP_TRANSFORM_KEY, true);
