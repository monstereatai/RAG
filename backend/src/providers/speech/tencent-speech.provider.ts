import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as https from 'node:https';
import * as crypto from 'node:crypto';
import { ISpeechProvider } from './speech-provider.interface';

/**
 * 腾讯云 ASR / TTS Provider
 *
 * 接口文档：
 * - ASR 一句话识别：https://cloud.tencent.com/document/product/1093/35646
 * - TTS 语音合成：https://cloud.tencent.com/document/product/1073/37995
 *
 * 若 TENCENT_SECRET_ID 未配置，所有方法抛出明确错误，不阻断启动。
 */
@Injectable()
export class TencentSpeechProvider implements ISpeechProvider {
  private readonly logger = new Logger(TencentSpeechProvider.name);
  private readonly secretId: string;
  private readonly secretKey: string;
  private readonly region: string;
  private readonly enabled: boolean;

  constructor(private readonly config: ConfigService) {
    this.secretId = config.get<string>('speech.tencent.secretId') ?? '';
    this.secretKey = config.get<string>('speech.tencent.secretKey') ?? '';
    this.region = config.get<string>('speech.tencent.region') ?? 'ap-shanghai';
    this.enabled = !!(this.secretId && this.secretKey);

    if (!this.enabled) {
      this.logger.warn(
        'TencentSpeechProvider: TENCENT_SECRET_ID/KEY not configured, ASR/TTS disabled',
      );
    } else {
      this.logger.log(
        `TencentSpeechProvider initialized (region=${this.region})`,
      );
    }
  }

  private assertEnabled(): void {
    if (!this.enabled) {
      throw new Error(
        'TencentSpeechProvider is not configured (missing TENCENT_SECRET_ID/KEY)',
      );
    }
  }

  /**
   * 生成腾讯云 API v3 签名
   */
  private sign(
    service: string,
    action: string,
    version: string,
    payload: object,
  ): {
    authorization: string;
    timestamp: string;
    host: string;
  } {
    const host = `${service}.tencentcloudapi.com`;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const date = new Date(Number(timestamp) * 1000).toISOString().split('T')[0];

    const payloadStr = JSON.stringify(payload);
    const hashedPayload = crypto
      .createHash('sha256')
      .update(payloadStr)
      .digest('hex');

    const canonicalRequest = [
      'POST',
      '/',
      '',
      `content-type:application/json\nhost:${host}\n`,
      'content-type;host',
      hashedPayload,
    ].join('\n');

    const credentialScope = `${date}/${service}/tc3_request`;
    const stringToSign = [
      'TC3-HMAC-SHA256',
      timestamp,
      credentialScope,
      crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    const hmac = (key: Buffer | string, data: string) =>
      crypto.createHmac('sha256', key).update(data).digest();

    const secretDate = hmac(`TC3${this.secretKey}`, date);
    const secretService = hmac(secretDate, service);
    const secretSigning = hmac(secretService, 'tc3_request');
    const signature = hmac(secretSigning, stringToSign).toString('hex');

    const authorization = `TC3-HMAC-SHA256 Credential=${this.secretId}/${credentialScope}, SignedHeaders=content-type;host, Signature=${signature}`;

    return { authorization, timestamp, host };
  }

  /**
   * 调用腾讯云 API（通用 JSON 请求）
   */
  private callApi<T>(
    service: string,
    action: string,
    version: string,
    payload: object,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const { authorization, timestamp, host } = this.sign(
        service,
        action,
        version,
        payload,
      );
      const body = JSON.stringify(payload);

      const req = https.request(
        {
          hostname: host,
          path: '/',
          method: 'POST',
          headers: {
            Authorization: authorization,
            'Content-Type': 'application/json',
            Host: host,
            'X-TC-Action': action,
            'X-TC-Version': version,
            'X-TC-Region': this.region,
            'X-TC-Timestamp': timestamp,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (d: Buffer) => chunks.push(d));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(
                Buffer.concat(chunks).toString('utf-8'),
              ) as {
                Response: T & { Error?: { Code: string; Message: string } };
              };
              if (parsed.Response.Error) {
                reject(
                  new Error(
                    `${parsed.Response.Error.Code}: ${parsed.Response.Error.Message}`,
                  ),
                );
              } else {
                resolve(parsed.Response);
              }
            } catch (e) {
              reject(e instanceof Error ? e : new Error(String(e)));
            }
          });
        },
      );

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  /**
   * ASR 一句话识别（base64 音频 → 文字）
   */
  async transcribe(audioBuffer: Buffer, format = 'wav'): Promise<string> {
    this.assertEnabled();

    this.logger.log(
      `ASR transcribe: ${audioBuffer.length} bytes, format=${format}`,
    );

    // 腾讯云一句话识别：SentenceRecognition
    const res = await this.callApi<{
      Result: string;
      RequestId: string;
    }>('asr', 'SentenceRecognition', '2019-06-14', {
      EngSerViceType: '16k_zh', // 16k 中文普通话
      SourceType: 1, // 1=音频数据
      VoiceFormat: format,
      ProjectId: 0,
      SubServiceType: 2, // 一句话识别
      Data: audioBuffer.toString('base64'),
      DataLen: audioBuffer.length,
    });

    this.logger.log(`ASR result: ${res.Result}`);
    return res.Result ?? '';
  }

  /**
   * TTS 语音合成（文字 → Base64 音频）
   */
  async synthesize(text: string, voiceType = 101001): Promise<Buffer> {
    this.assertEnabled();

    this.logger.log(
      `TTS synthesize: ${text.slice(0, 50)}..., voiceType=${voiceType}`,
    );

    const res = await this.callApi<{
      Audio: string; // base64
      SessionId: string;
    }>('tts', 'TextToVoice', '2019-08-23', {
      Text: text,
      SessionId: crypto.randomUUID(),
      VoiceType: voiceType,
      Codec: 'wav',
      SampleRate: 16000,
    });

    return Buffer.from(res.Audio, 'base64');
  }

  /**
   * TTS 流式合成（简化版：全量合成后分块 yield）
   * 真正的流式 TTS 需要 WebSocket，此为 REST 降级方案。
   */
  async *synthesizeStream(
    text: string,
    voiceType = 101001,
  ): AsyncGenerator<Buffer, void, unknown> {
    const audio = await this.synthesize(text, voiceType);
    // 分 8KB 块推送，模拟流式
    const chunkSize = 8192;
    for (let offset = 0; offset < audio.length; offset += chunkSize) {
      yield audio.subarray(offset, offset + chunkSize);
    }
  }
}
