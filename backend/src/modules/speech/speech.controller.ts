import {
  Controller,
  Post,
  Get,
  Query,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  Res,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { TencentSpeechProvider } from '../../providers/speech/tencent-speech.provider';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

/**
 * Speech Controller
 *
 * POST /api/speech/asr  — 上传音频文件 → 文字
 * GET  /api/speech/tts  — 文字 → 流式音频（SSE chunked）
 */
@Controller('speech')
@UseGuards(JwtAuthGuard)
export class SpeechController {
  private readonly logger = new Logger(SpeechController.name);

  constructor(private readonly speechProvider: TencentSpeechProvider) {}

  /**
   * ASR：上传音频文件 → 识别文字
   * Body: multipart/form-data, field: audio
   */
  @Post('asr')
  @UseInterceptors(FileInterceptor('audio'))
  async transcribe(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ text: string }> {
    if (!file) {
      throw new BadRequestException('audio file is required (field: audio)');
    }

    const format = this.detectAudioFormat(file.originalname);
    this.logger.log(
      `ASR request: ${file.originalname} (${file.size} bytes, format=${format})`,
    );

    const text = await this.speechProvider.transcribe(file.buffer, format);
    return { text };
  }

  /**
   * TTS：文字 → 流式音频响应
   * Query: text=..., voiceType=101001（可选）
   */
  @Get('tts')
  async synthesize(
    @Query('text') text: string,
    @Query('voiceType') voiceTypeStr: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!text || !text.trim()) {
      throw new BadRequestException('text query param is required');
    }

    const voiceType = voiceTypeStr ? Number(voiceTypeStr) : 101001;
    this.logger.log(
      `TTS request: "${text.slice(0, 50)}", voiceType=${voiceType}`,
    );

    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');

    try {
      for await (const chunk of this.speechProvider.synthesizeStream(
        text,
        voiceType,
      )) {
        res.write(chunk);
      }
      res.end();
    } catch (err) {
      this.logger.error(`TTS failed: ${(err as Error).message}`);
      if (!res.headersSent) {
        res.status(500).json({ message: (err as Error).message });
      } else {
        res.end();
      }
    }
  }

  private detectAudioFormat(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const formatMap: Record<string, string> = {
      wav: 'wav',
      mp3: 'mp3',
      ogg: 'ogg-opus',
      opus: 'ogg-opus',
      flac: 'flac',
      aac: 'aac',
      m4a: 'mp4',
    };
    return formatMap[ext] ?? 'wav';
  }
}
