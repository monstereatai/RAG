/**
 * SpeechProvider 抽象接口
 * 实现：腾讯云 ASR/TTS（含流式）
 */
export interface ISpeechProvider {
  /**
   * ASR：音频文件 → 文字
   * @param audioBuffer PCM/WAV/MP3 音频 Buffer
   * @param format 音频格式，默认 'wav'
   */
  transcribe(audioBuffer: Buffer, format?: string): Promise<string>;

  /**
   * TTS：文字 → 音频（全量返回）
   * @param text 待合成文本
   * @param voiceType 音色类型（腾讯云 VoiceType，默认 101001）
   */
  synthesize(text: string, voiceType?: number): Promise<Buffer>;

  /**
   * TTS 流式：文字 → 音频流（AsyncGenerator，用于 SSE 推送）
   * @param text 待合成文本
   * @param voiceType 音色类型
   */
  synthesizeStream(
    text: string,
    voiceType?: number,
  ): AsyncGenerator<Buffer, void, unknown>;
}
