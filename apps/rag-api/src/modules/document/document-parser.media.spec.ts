import { BadRequestException } from '@nestjs/common';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  extractAudioDocumentText,
  extractVideoDocumentText,
  parseAudioDocument,
  parseVideoDocument,
} from './document-parser.media';
import type {
  DocumentVideoExtractionOptions,
  ParsedDocument,
} from './document-parser.types';

const fixtureRoot = resolve(__dirname, '../../../eval/private-fixtures/media');
const audioFixturePath = join(fixtureRoot, 'meeting-action-items.wav');
const videoFixturePath = join(fixtureRoot, 'document-parser-valid-short.mp4');

describe('audio/video document parsing with real media fixtures', () => {
  let tempDir: string;

  beforeAll(async () => {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    tempDir = await mkdtemp(join(tmpdir(), 'media-parser-spec-'));
  });

  afterAll(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it('parses the repository WAV and preserves the source time range', async () => {
    const buffer = await readFile(audioFixturePath);
    const asr = {
      transcribe: jest.fn().mockResolvedValue('会议结论：下周完成复核。'),
    };

    const parsed = await parseAudioDocument(
      buffer,
      'meeting-action-items.wav',
      asr,
    );

    expect(parsed.kind).toBe('audio');
    expect(parsed.status).toBe('complete');
    expect(parsed.completeness).toBe(1);
    const transcript = parsed.blocks.find(
      (block) => block.type === 'transcript',
    );
    expect(transcript?.text).toBe('会议结论：下周完成复核。');
    expect(transcript?.startSeconds).toBe(0);
    expect(transcript?.endSeconds).toBeGreaterThan(0);
    expect(parsed.markdown).toContain('会议结论：下周完成复核。');
    expect(asr.transcribe).toHaveBeenCalledWith(expect.any(Buffer), 'wav');
  });

  it('keeps exact segment ranges and warns when one audio segment fails', async () => {
    const longWavePath = join(tempDir, 'long-audio.wav');
    execFileSync(
      'ffmpeg',
      [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-stream_loop',
        '-1',
        '-i',
        audioFixturePath,
        '-t',
        '56',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-c:a',
        'pcm_s16le',
        longWavePath,
      ],
      { stdio: 'ignore' },
    );
    const asr = {
      transcribe: jest.fn((wav: Buffer) => {
        if (wav.length < 100_000) {
          return Promise.reject(new Error('temporary ASR failure'));
        }
        return Promise.resolve('第一段内容');
      }),
    };

    const parsed = await parseAudioDocument(
      await readFile(longWavePath),
      'long-audio.wav',
      asr,
    );
    const transcript = parsed.blocks.find(
      (block) => block.type === 'transcript',
    );
    const failedSegment = parsed.warnings.find(
      (warning) => warning.code === 'asr_segment_failed',
    );

    expect(parsed.status).toBe('partial');
    expect(parsed.completeness).toBeGreaterThan(0.9);
    expect(parsed.completeness).toBeLessThan(1);
    expect(asr.transcribe).toHaveBeenCalledTimes(2);
    expect(transcript?.startSeconds).toBe(0);
    expect(transcript?.endSeconds).toBeCloseTo(55, 0);
    expect(failedSegment?.startSeconds).toBeCloseTo(
      transcript?.endSeconds ?? 0,
      2,
    );
    expect(failedSegment?.endSeconds).toBeCloseTo(56, 1);
    expect(parsed.markdown).toContain('第一段内容');
    expect(parsed.markdown).not.toContain('temporary ASR failure');
  }, 30_000);

  it('marks missing ASR or empty recognition as failed without placeholder text', async () => {
    const buffer = await readFile(audioFixturePath);
    const withoutAsr = await parseAudioDocument(
      buffer,
      'meeting-action-items.wav',
    );
    const emptyAsr = await parseAudioDocument(
      buffer,
      'meeting-action-items.wav',
      { transcribe: jest.fn().mockResolvedValue('  ') },
    );

    expect(withoutAsr.status).toBe('failed');
    expect(withoutAsr.completeness).toBe(0);
    expect(withoutAsr.markdown).toBe('');
    expect(withoutAsr.warnings.map((warning) => warning.code)).toContain(
      'asr_unavailable',
    );
    expect(emptyAsr.status).toBe('failed');
    expect(emptyAsr.markdown).toBe('');
    expect(emptyAsr.warnings.map((warning) => warning.code)).toContain(
      'asr_segment_empty',
    );
    await expect(
      extractAudioDocumentText(buffer, 'meeting-action-items.wav'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parseAudioDocument(buffer, 'wrong-extension.mp3', {
        transcribe: jest.fn().mockResolvedValue('should not run'),
      }),
    ).rejects.toThrow('does not match its audio container');
  });

  it('parses the generated MP4, timestamps frames, and records real ASR/Vision content', async () => {
    const storage = {
      putObject: jest.fn().mockImplementation(({ key }: { key: string }) =>
        Promise.resolve({
          key,
          url: 'https://storage.test/' + key,
        }),
      ),
    };
    const options: DocumentVideoExtractionOptions = {
      storage,
      asr: { transcribe: jest.fn().mockResolvedValue('视频中的口头说明。') },
      vision: {
        describeImage: jest
          .fn()
          .mockResolvedValue({ description: '蓝色画面。' }),
      },
      filename: 'document-parser-valid-short.mp4',
      docId: 'media-test',
      ownerUserId: 'user-test',
    };

    const previousInterval = process.env.VIDEO_KEYFRAME_INTERVAL_SECONDS;
    process.env.VIDEO_KEYFRAME_INTERVAL_SECONDS = '1';
    let parsed;
    try {
      parsed = await parseVideoDocument(
        await readFile(videoFixturePath),
        options,
      );
    } finally {
      if (previousInterval === undefined) {
        delete process.env.VIDEO_KEYFRAME_INTERVAL_SECONDS;
      } else {
        process.env.VIDEO_KEYFRAME_INTERVAL_SECONDS = previousInterval;
      }
    }
    const frame = parsed.blocks.find((block) => block.type === 'frame');
    const transcript = parsed.blocks.find(
      (block) => block.type === 'transcript',
    );

    expect(parsed.kind).toBe('video');
    expect(parsed.status).toBe('complete');
    expect(parsed.completeness).toBe(1);
    expect(transcript?.text).toBe('视频中的口头说明。');
    expect(frame?.text).toBe('蓝色画面。');
    expect(frame?.startSeconds).toBe(0);
    expect(frame?.endSeconds).toBe(0);
    expect(frame?.asset?.mimeType).toBe('image/jpeg');
    expect(frame?.asset?.url).toContain('media-test');
    expect(parsed.markdown).toContain('视频中的口头说明。');
    expect(parsed.markdown).toContain('蓝色画面。');
    expect(storage.putObject).toHaveBeenCalled();
  });

  it('rejects absent options, invalid containers, and containers without video streams', async () => {
    const storage = { putObject: jest.fn() };
    const options: DocumentVideoExtractionOptions = { storage };

    await expect(
      parseVideoDocument(Buffer.from('not a video')),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      parseVideoDocument(Buffer.from('not a video'), options),
    ).rejects.toBeInstanceOf(BadRequestException);
    const audioOnlyVideoPath = join(tempDir, 'audio-only.mp4');
    execFileSync(
      'ffmpeg',
      [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        audioFixturePath,
        '-c:a',
        'aac',
        audioOnlyVideoPath,
      ],
      { stdio: 'ignore' },
    );
    await expect(
      parseVideoDocument(await readFile(audioOnlyVideoPath), {
        ...options,
        filename: 'audio-only.mp4',
      }),
    ).rejects.toThrow('video file has no video stream');
    await expect(
      parseVideoDocument(await readFile(videoFixturePath), {
        ...options,
        filename: 'wrong-extension.webm',
      }),
    ).rejects.toThrow('does not match its video container');
    await expect(
      extractVideoDocumentText(Buffer.from('not a video')),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('returns failed status and warnings when a valid video has no ASR or Vision text', async () => {
    const previousInterval = process.env.VIDEO_KEYFRAME_INTERVAL_SECONDS;
    process.env.VIDEO_KEYFRAME_INTERVAL_SECONDS = '1';
    let parsed: ParsedDocument;
    try {
      parsed = await parseVideoDocument(await readFile(videoFixturePath), {
        storage: {
          putObject: jest.fn().mockImplementation(({ key }: { key: string }) =>
            Promise.resolve({
              key,
              url: 'https://storage.test/' + key,
            }),
          ),
        },
        filename: 'document-parser-valid-short.mp4',
      });
    } finally {
      if (previousInterval === undefined) {
        delete process.env.VIDEO_KEYFRAME_INTERVAL_SECONDS;
      } else {
        process.env.VIDEO_KEYFRAME_INTERVAL_SECONDS = previousInterval;
      }
    }

    expect(parsed.status).toBe('failed');
    expect(parsed.completeness).toBe(0);
    expect(parsed.markdown).toBe('');
    expect(parsed.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        'asr_unavailable',
        'vision_unavailable',
        'video_no_searchable_content',
      ]),
    );
  });
});
