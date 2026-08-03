import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface DashScopeTask {
  output?: {
    task_id?: string;
    task_status?: string;
    results?: Array<{ url?: string }>;
    message?: string;
  };
  message?: string;
}

@Injectable()
export class DashScopeImageService {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://dashscope.aliyuncs.com/api/v1';

  constructor(config: ConfigService) {
    this.apiKey =
      config.get<string>('DASHSCOPE_API_KEY') ??
      config.get<string>('QWEN_API_KEY') ??
      process.env.DASHSCOPE_API_KEY ??
      process.env.QWEN_API_KEY ??
      '';
  }

  async generate(prompt: string): Promise<Buffer> {
    if (!this.apiKey) {
      throw new Error(
        'DASHSCOPE_API_KEY or QWEN_API_KEY is required for image generation.',
      );
    }
    const created = await this.request<DashScopeTask>(
      `${this.baseUrl}/services/aigc/text2image/image-synthesis`,
      {
        method: 'POST',
        headers: {
          'X-DashScope-Async': 'enable',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'wanx2.1-t2i-turbo',
          input: { prompt },
          parameters: { size: '1024*1024', n: 1 },
        }),
      },
    );
    const taskId = created.output?.task_id;
    if (!taskId)
      throw new Error(created.message ?? 'DashScope did not return a task id.');

    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const task = await this.request<DashScopeTask>(
        `${this.baseUrl}/tasks/${taskId}`,
        { method: 'GET' },
      );
      const status = task.output?.task_status;
      if (status === 'SUCCEEDED') {
        const url = task.output?.results?.[0]?.url;
        if (!url)
          throw new Error(
            'DashScope image task completed without an image URL.',
          );
        const response = await fetch(url);
        if (!response.ok)
          throw new Error(
            `DashScope image download failed with ${response.status}.`,
          );
        return Buffer.from(await response.arrayBuffer());
      }
      if (
        status === 'FAILED' ||
        status === 'CANCELED' ||
        status === 'UNKNOWN'
      ) {
        throw new Error(
          task.output?.message ??
            task.message ??
            `DashScope image task ${status}.`,
        );
      }
    }
    throw new Error('DashScope image generation timed out after 120 seconds.');
  }

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    const response = await fetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${this.apiKey}` },
    });
    const data = (await response.json()) as T & { message?: string };
    if (!response.ok)
      throw new Error(
        data.message ?? `DashScope request failed with ${response.status}.`,
      );
    return data;
  }
}
