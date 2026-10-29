import { ConfigService } from '@nestjs/config';
import { TencentSpeechProvider } from './tencent-speech.provider';

describe('TencentSpeechProvider exception scenarios', () => {
  it('throws a clear error when credentials are missing for ASR', async () => {
    const provider = new TencentSpeechProvider({
      get: jest.fn().mockReturnValue(''),
    } as unknown as ConfigService);

    await expect(provider.transcribe(Buffer.from('audio'))).rejects.toThrow(
      'TencentSpeechProvider is not configured',
    );
  });

  it('throws a clear error when credentials are missing for TTS', async () => {
    const provider = new TencentSpeechProvider({
      get: jest.fn().mockReturnValue(''),
    } as unknown as ConfigService);

    await expect(provider.synthesize('hello')).rejects.toThrow(
      'TencentSpeechProvider is not configured',
    );
  });
});
