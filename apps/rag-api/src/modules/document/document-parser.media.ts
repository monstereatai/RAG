import { BadRequestException } from '@nestjs/common';
import { spawn, spawnSync } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sanitizeObjectKeyPart } from './document-parser.image';
import {
  mapWithConcurrency,
  envPositiveNumber,
} from './document-parser.shared';
import type {
  DocumentAsrDelegate,
  DocumentVideoExtractionOptions,
  ParsedBlock,
  ParsedDocument,
  ParsedDocumentWarning,
  VideoProbeResult,
  VideoFrameAsset,
  UploadedVideoFrame,
  VideoProbeJson,
} from './document-parser.types';

const MEDIA_ASR_SEGMENT_SECONDS = 55;

/** 解析独立音频；转写段带原文件时间范围，缺失/失败结果进入状态与告警。 */
export async function parseAudioDocument(
  buffer: Buffer,
  filename: string,
  asr?: DocumentAsrDelegate,
): Promise<ParsedDocument> {
  if (buffer.length === 0) {
    throw new BadRequestException('audio file is empty');
  }
  if (buffer.length > AUDIO_MAX_BYTES_DEFAULT) {
    throw new BadRequestException(
      `audio file is too large: ${formatBytes(buffer.length)} exceeds 200 MB`,
    );
  }

  assertFfmpegToolsAvailable();
  const dir = await mkdtemp(join(tmpdir(), 'audio-parse-'));
  try {
    const extension = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase();
    const inputPath = join(dir, `input.${extension || 'audio'}`);
    await writeFile(inputPath, buffer);
    const containerName = await probeVideoContainerName(inputPath);
    assertContainerMatchesExtension(extension, containerName, 'audio');
    const probe = await probeVideoMetadata(inputPath);
    if (probe.hasVideoStream) {
      throw new BadRequestException(
        'audio file contains a video stream; use a video file extension',
      );
    }
    if (!probe.hasAudioStream) {
      throw new BadRequestException('audio file has no audio stream');
    }
    const maxDurationSeconds = 60 * 60;
    if (
      probe.durationSeconds !== null &&
      probe.durationSeconds > maxDurationSeconds
    ) {
      throw new BadRequestException(
        'audio file exceeds the 60-minute ingestion limit',
      );
    }

    const warnings: ParsedDocumentWarning[] = [];
    const blocks: ParsedBlock[] = [];
    let sourceDurationSeconds = probe.durationSeconds ?? 0;
    let coveredDurationSeconds = 0;
    if (!isAsrEnabled(asr)) {
      warnings.push({
        code: 'asr_unavailable',
        message: '未配置可用的 ASR，音频未生成可检索转写。',
      });
    } else {
      const segments = await splitAudioFile(inputPath, dir);
      sourceDurationSeconds =
        sourceDurationSeconds ||
        segments.reduce((sum, segment) => sum + segment.durationSeconds, 0);
      const transcribed = await transcribeAudioSegments(segments, asr);
      warnings.push(...transcribed.warnings);
      blocks.push(...transcribed.blocks);
      coveredDurationSeconds = transcribed.blocks.reduce(
        (sum, block) =>
          sum + (block.endSeconds ?? 0) - (block.startSeconds ?? 0),
        0,
      );
      if (
        sourceDurationSeconds > 0 &&
        sourceDurationSeconds - coveredDurationSeconds > 0.1 &&
        transcribed.blocks.length > 0
      ) {
        warnings.push({
          code: 'audio_transcription_incomplete',
          message:
            '仅转写了 ' +
            coveredDurationSeconds.toFixed(2) +
            ' / ' +
            sourceDurationSeconds.toFixed(2) +
            ' 秒音频。',
          startSeconds: coveredDurationSeconds,
          endSeconds: sourceDurationSeconds,
        });
      }
    }

    const status =
      blocks.length === 0 ? 'failed' : warnings.length ? 'partial' : 'complete';
    return createMediaDocument({
      kind: 'audio',
      title: `音频转写：${filename}`,
      blocks,
      status,
      warnings,
      completeness:
        sourceDurationSeconds > 0
          ? coveredDurationSeconds / sourceDurationSeconds
          : 0,
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** 兼容旧调用方：只返回真实转写正文；解析失败时拒绝，不生成说明性占位内容。 */
export async function extractAudioDocumentText(
  buffer: Buffer,
  filename: string,
  asr?: DocumentAsrDelegate,
): Promise<string> {
  const parsed = await parseAudioDocument(buffer, filename, asr);
  if (parsed.status === 'failed' || !parsed.markdown.trim()) {
    throw new BadRequestException(
      parsed.warnings[0]?.message ?? 'ASR returned an empty transcript',
    );
  }
  return parsed.markdown;
}

/* ── 视频解析：ffmpeg 分段转写与关键帧提取 ──
 *
 * 音轨按 ASR 单次时长上限拆分，每段记录原视频时间范围；画面按间隔抽帧，
 * 交给对象存储与 Vision 委托。缺少委托或部分处理失败会写入状态和告警，
 * 解析正文只包含真实转写、画面描述和已保存的帧资源。
 */
/** 超过该大小的视频直接拒绝入库（默认 200MB，可用 VIDEO_MAX_BYTES 覆盖） */
export const VIDEO_MAX_BYTES_DEFAULT = 200 * 1024 * 1024;

/** 独立音频入库大小上限；音频与视频采用相同的默认上限。 */
export const AUDIO_MAX_BYTES_DEFAULT = 200 * 1024 * 1024;

/** 关键帧抽帧间隔秒数（默认 10s，可用 VIDEO_KEYFRAME_INTERVAL_SECONDS 覆盖） */
export const VIDEO_KEYFRAME_INTERVAL_SECONDS_DEFAULT = 10;

/** 关键帧总数上限（默认 12 帧，可用 VIDEO_MAX_KEYFRAMES 覆盖） */
export const VIDEO_MAX_KEYFRAMES_DEFAULT = 12;

/** 每个送转写音轨片段的最大时长（秒，默认 60，可用 VIDEO_ASR_MAX_SECONDS 覆盖）。 */
export const VIDEO_ASR_MAX_SECONDS_DEFAULT = 60;

/** 关键帧画面描述的并发上限（视觉模型调用温和节流，与图片 alt 生成一致） */
export const VIDEO_FRAME_DESCRIPTION_CONCURRENCY = 2;

/** WAV 头部标准长度：判断 ffmpeg 产物是否含有效音频数据 */
export const WAV_HEADER_BYTES = 44;

/** 视频解析：必须通过容器/视频流校验；只把真实转写和画面描述放入正文。 */
export async function parseVideoDocument(
  buffer: Buffer,
  video?: DocumentVideoExtractionOptions,
): Promise<ParsedDocument> {
  if (
    !video ||
    !video.storage ||
    typeof video.storage.putObject !== 'function'
  ) {
    throw new BadRequestException(
      '视频解析需要有效的存储配置；未解析的视频不会建立文本索引。',
    );
  }

  const maxBytes = Math.max(
    1,
    envPositiveNumber('VIDEO_MAX_BYTES', VIDEO_MAX_BYTES_DEFAULT),
  );
  if (buffer.length > maxBytes) {
    throw new BadRequestException(
      `video file is too large to ingest: ${formatBytes(buffer.length)} exceeds ` +
        `VIDEO_MAX_BYTES (${formatBytes(maxBytes)}). ` +
        'Compress the video or raise the VIDEO_MAX_BYTES limit.',
    );
  }

  // ffmpeg/ffprobe 缺失时抛出带安装提示的明确错误，不让视频解析静默退化
  assertFfmpegToolsAvailable();

  const dir = await mkdtemp(join(tmpdir(), 'video-parse-'));
  try {
    const inputPath = join(dir, 'input.mp4');
    await writeFile(inputPath, buffer);

    const containerName = await probeVideoContainerName(inputPath);
    if (!containerName) {
      throw new BadRequestException(
        'Video container validation failed; the file may be corrupted or mislabeled.',
      );
    }
    const extension = /\.([a-z0-9]+)$/i
      .exec(video.filename ?? '')?.[1]
      ?.toLowerCase();
    assertContainerMatchesExtension(extension, containerName, 'video');
    const probe = await probeVideoMetadata(inputPath);
    if (!probe.hasVideoStream) {
      throw new BadRequestException('video file has no video stream');
    }
    if (probe.durationSeconds !== null && probe.durationSeconds > 60 * 60) {
      throw new BadRequestException(
        'video file exceeds the 60-minute ingestion limit',
      );
    }
    const intervalSeconds = Math.max(
      1,
      envPositiveNumber(
        'VIDEO_KEYFRAME_INTERVAL_SECONDS',
        VIDEO_KEYFRAME_INTERVAL_SECONDS_DEFAULT,
      ),
    );
    const maxFrames = Math.max(
      1,
      envPositiveNumber('VIDEO_MAX_KEYFRAMES', VIDEO_MAX_KEYFRAMES_DEFAULT),
    );

    const frameAssets = probe.hasVideoStream
      ? await extractVideoKeyframes(inputPath, dir, intervalSeconds, maxFrames)
      : [];
    const audio = probe.hasAudioStream
      ? await extractVideoAudioTrack(
          inputPath,
          dir,
          await probeAudioStreamDuration(inputPath),
        )
      : {
          buffer: null as Buffer | null,
          truncatedSeconds: null as number | null,
          durationSeconds: null as number | null,
          sourceDurationSeconds: null as number | null,
        };

    const warnings: ParsedDocumentWarning[] = [];
    const uploadedFrames = await uploadVideoFrames(frameAssets, video);
    if (frameAssets.length === 0) {
      warnings.push({
        code: 'video_no_frames',
        message: '视频有效但未抽取到关键帧。',
      });
    }
    if (uploadedFrames.some((frame) => !frame.url)) {
      warnings.push({
        code: 'video_frame_storage_failed',
        message: '部分关键帧未能保存到对象存储。',
      });
    }
    warnings.push(
      ...(await describeVideoFrames(uploadedFrames, frameAssets, video)),
    );
    if (!isAsrEnabled(video.asr) && probe.hasAudioStream) {
      warnings.push({
        code: 'asr_unavailable',
        message: '未配置可用的 ASR，视频音轨未生成可检索转写。',
      });
    }
    if (!video.vision || typeof video.vision.describeImage !== 'function') {
      warnings.push({
        code: 'vision_unavailable',
        message: '未配置可用的 Vision，视频画面未生成文字描述。',
      });
    }
    const videoSegmentSeconds = Math.min(
      MEDIA_ASR_SEGMENT_SECONDS,
      Math.max(
        1,
        envPositiveNumber(
          'VIDEO_ASR_MAX_SECONDS',
          VIDEO_ASR_MAX_SECONDS_DEFAULT,
        ),
      ),
    );
    const audioParse =
      audio.buffer && isAsrEnabled(video.asr)
        ? await transcribeAudioBuffer(
            audio.buffer,
            dir,
            video.asr,
            videoSegmentSeconds,
          )
        : {
            blocks: [] as ParsedBlock[],
            warnings: [] as ParsedDocumentWarning[],
          };
    warnings.push(...audioParse.warnings);
    if (probe.hasAudioStream && !audio.buffer) {
      warnings.push({
        code: 'video_audio_extraction_failed',
        message: '视频音轨未能提取。',
      });
    }
    if (audio.truncatedSeconds !== null) {
      warnings.push({
        code: 'video_audio_truncated',
        message: `视频音轨只处理到 ${audio.truncatedSeconds} 秒。`,
        startSeconds: audio.truncatedSeconds,
        endSeconds: audio.sourceDurationSeconds ?? undefined,
      });
    }
    const frameBlocks: ParsedBlock[] = uploadedFrames.map((frame) => ({
      type: 'frame',
      text: frame.description ?? '',
      startSeconds: frame.timestampSeconds,
      endSeconds: frame.timestampSeconds,
      asset: {
        ...(frame.url ? { url: frame.url } : {}),
        mimeType: 'image/jpeg',
        ...(frame.description ? { alt: frame.description } : {}),
      },
      metadata: { frameIndex: frame.index },
    }));
    const contentBlocks = [...audioParse.blocks, ...frameBlocks];
    const hasSearchableText = contentBlocks.some((block) => block.text.trim());
    if (!hasSearchableText) {
      warnings.push({
        code: 'video_no_searchable_content',
        message: '视频没有生成有效的转写文本或画面描述。',
      });
    }
    const status = !hasSearchableText
      ? 'failed'
      : warnings.length
        ? 'partial'
        : 'complete';
    const coverageParts: number[] = [];
    if (probe.hasAudioStream) {
      const audioDuration =
        audio.sourceDurationSeconds ??
        audio.durationSeconds ??
        probe.durationSeconds ??
        0;
      const transcribedSeconds = audioParse.blocks.reduce(
        (sum, block) =>
          sum + (block.endSeconds ?? 0) - (block.startSeconds ?? 0),
        0,
      );
      coverageParts.push(
        audioDuration > 0
          ? Math.min(1, transcribedSeconds / audioDuration)
          : audioParse.blocks.length > 0
            ? 1
            : 0,
      );
    }
    if (probe.hasVideoStream) {
      coverageParts.push(
        frameAssets.length > 0
          ? uploadedFrames.filter((frame) => frame.description).length /
              frameAssets.length
          : 0,
      );
    }
    const mediaCompleteness =
      status === 'complete'
        ? 1
        : coverageParts.length > 0
          ? coverageParts.reduce((sum, part) => sum + part, 0) /
            coverageParts.length
          : 0;
    const title = `视频 ${video.filename?.trim() || 'Document'}`;
    return createMediaDocument({
      kind: 'video',
      title,
      blocks: contentBlocks,
      status,
      warnings,
      completeness: mediaCompleteness,
      heading: title,
      extraMarkdown: renderVideoFrameAssets(frameBlocks),
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** 兼容旧调用方：只返回真实转写/画面描述，解析失败时拒绝占位正文。 */
export async function extractVideoDocumentText(
  buffer: Buffer,
  video?: DocumentVideoExtractionOptions,
): Promise<string> {
  const parsed = await parseVideoDocument(buffer, video);
  if (parsed.status === 'failed' || !parsed.markdown.trim()) {
    throw new BadRequestException(
      parsed.warnings[0]?.message ?? 'video produced no searchable content',
    );
  }
  return parsed.markdown;
}

export let ffmpegToolsAvailable: boolean | null = null;

/** 探测 ffmpeg / ffprobe 是否在 PATH 上（结果进程内缓存），缺失时抛出明确错误 */
export function assertFfmpegToolsAvailable(): void {
  if (ffmpegToolsAvailable === null) {
    const ffmpeg = spawnSync('which', ['ffmpeg'], { encoding: 'utf-8' });
    const ffprobe = spawnSync('which', ['ffprobe'], { encoding: 'utf-8' });
    ffmpegToolsAvailable =
      ffmpeg.status === 0 &&
      Boolean(ffmpeg.stdout?.trim()) &&
      ffprobe.status === 0 &&
      Boolean(ffprobe.stdout?.trim());
  }
  if (!ffmpegToolsAvailable) {
    throw new BadRequestException(
      'Audio/video ingestion requires ffmpeg/ffprobe on the server, but neither was found in PATH. ' +
        'Install ffmpeg (e.g. `brew install ffmpeg` or `apt-get install ffmpeg`) ' +
        'to ingest media documents.',
    );
  }
}

async function probeVideoContainerName(inputPath: string): Promise<string> {
  const { stdout } = await runFfmpegTool(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=format_name',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      inputPath,
    ],
    'Media container validation',
  );
  return stdout.trim().split(',').filter(Boolean).join(',');
}

function assertContainerMatchesExtension(
  extension: string | undefined,
  containerName: string,
  mediaKind: 'audio' | 'video',
): void {
  const allowedContainers: Record<string, string[]> =
    mediaKind === 'video'
      ? {
          mp4: ['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2'],
          mov: ['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2'],
          m4v: ['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2'],
          webm: ['matroska', 'webm'],
        }
      : {
          mp3: ['mp3'],
          wav: ['wav'],
          m4a: ['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2'],
          aac: ['aac'],
          flac: ['flac'],
          ogg: ['ogg'],
          opus: ['ogg'],
        };
  const expected = extension ? allowedContainers[extension] : undefined;
  if (!expected || !containerName) {
    throw new BadRequestException(
      'Unsupported or missing ' +
        mediaKind +
        ' file extension: ' +
        (extension ?? '(none)'),
    );
  }
  const actual = containerName.split(',');
  if (!expected.some((name) => actual.includes(name))) {
    throw new BadRequestException(
      'File extension .' +
        extension +
        ' does not match its ' +
        mediaKind +
        ' container (' +
        containerName +
        ').',
    );
  }
}

async function probeAudioDuration(inputPath: string): Promise<number> {
  const { stdout } = await runFfmpegTool(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      inputPath,
    ],
    'Audio segment duration probe',
  );
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new BadRequestException(
      'Audio segment has no valid duration; source positions cannot be preserved.',
    );
  }
  return duration;
}

async function probeAudioStreamDuration(
  inputPath: string,
): Promise<number | null> {
  const { stdout } = await runFfmpegTool(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type,duration',
      '-of',
      'json',
      inputPath,
    ],
    'Source audio duration probe',
  );
  let parsed: { streams?: Array<{ codec_type?: string; duration?: string }> };
  try {
    parsed = JSON.parse(stdout || '{}') as typeof parsed;
  } catch {
    throw new BadRequestException(
      'Source audio duration probe returned invalid output.',
    );
  }
  const duration = Number(
    parsed.streams?.find((stream) => stream.codec_type === 'audio')?.duration,
  );
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

async function splitAudioFile(
  inputPath: string,
  dir: string,
  segmentSeconds = MEDIA_ASR_SEGMENT_SECONDS,
): Promise<Array<{ path: string; durationSeconds: number }>> {
  const segmentsDir = join(dir, 'transcription-segments');
  await mkdir(segmentsDir, { recursive: true });
  const pattern = join(segmentsDir, 'segment-%04d.wav');
  await runFfmpegTool(
    'ffmpeg',
    [
      '-nostdin',
      '-y',
      '-i',
      inputPath,
      '-map',
      '0:a:0',
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'pcm_s16le',
      '-f',
      'segment',
      '-segment_time',
      String(segmentSeconds),
      '-reset_timestamps',
      '1',
      '-segment_format',
      'wav',
      pattern,
    ],
    'Audio normalization and segmentation',
  );
  const names = (await readdir(segmentsDir))
    .filter((name) => /^segment-\d+\.wav$/.test(name))
    .sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }),
    );
  if (names.length === 0) {
    throw new BadRequestException(
      'audio file produced no transcription segments',
    );
  }
  return Promise.all(
    names.map(async (name) => {
      const path = join(segmentsDir, name);
      const statBuffer = await readFile(path);
      if (
        statBuffer.length <= WAV_HEADER_BYTES ||
        statBuffer.length > 3 * 1024 * 1024
      ) {
        throw new BadRequestException(
          `normalized audio segment is outside Tencent ASR limits: ${name}`,
        );
      }
      return { path, durationSeconds: await probeAudioDuration(path) };
    }),
  );
}

async function transcribeAudioSegments(
  segments: Array<{ path: string; durationSeconds: number }>,
  asr: DocumentAsrDelegate,
): Promise<{ blocks: ParsedBlock[]; warnings: ParsedDocumentWarning[] }> {
  let offsetSeconds = 0;
  const ranges = segments.map((segment, index) => {
    const range = {
      ...segment,
      index,
      startSeconds: offsetSeconds,
      endSeconds: offsetSeconds + segment.durationSeconds,
    };
    offsetSeconds = range.endSeconds;
    return range;
  });
  const results = await mapWithConcurrency(ranges, 2, async (segment) => {
    try {
      const wav = await readFile(segment.path);
      const text = (await asr.transcribe(wav, 'wav')).trim();
      return { text, error: null as string | null };
    } catch (error) {
      return {
        text: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  const blocks: ParsedBlock[] = [];
  const warnings: ParsedDocumentWarning[] = [];
  results.forEach((result, index) => {
    const range = ranges[index];
    if (result.error) {
      warnings.push({
        code: 'asr_segment_failed',
        message: `第 ${index + 1} 段 ASR 转写失败：${result.error}`,
        startSeconds: range.startSeconds,
        endSeconds: range.endSeconds,
      });
      return;
    }
    if (!result.text) {
      warnings.push({
        code: 'asr_segment_empty',
        message: `第 ${index + 1} 段 ASR 未识别到有效文本。`,
        startSeconds: range.startSeconds,
        endSeconds: range.endSeconds,
      });
      return;
    }
    blocks.push({
      type: 'transcript',
      text: result.text,
      startSeconds: range.startSeconds,
      endSeconds: range.endSeconds,
      metadata: { segmentIndex: index + 1 },
    });
  });
  return { blocks, warnings };
}

async function transcribeAudioBuffer(
  buffer: Buffer,
  dir: string,
  asr: DocumentAsrDelegate,
  segmentSeconds: number,
): Promise<{ blocks: ParsedBlock[]; warnings: ParsedDocumentWarning[] }> {
  const sourcePath = join(dir, 'transcription-source.wav');
  await writeFile(sourcePath, buffer);
  return transcribeAudioSegments(
    await splitAudioFile(sourcePath, dir, segmentSeconds),
    asr,
  );
}

function isAsrEnabled(asr?: DocumentAsrDelegate): asr is DocumentAsrDelegate {
  return Boolean(
    asr &&
    typeof asr.transcribe === 'function' &&
    (typeof asr.isEnabled !== 'function' || asr.isEnabled()),
  );
}

function createMediaDocument(params: {
  kind: 'audio' | 'video';
  title: string;
  blocks: ParsedBlock[];
  status: ParsedDocument['status'];
  warnings: ParsedDocumentWarning[];
  completeness?: number;
  heading?: string;
  extraMarkdown?: string;
}): ParsedDocument {
  const lines = [`# ${params.heading ?? params.title}`];
  for (const [index, block] of params.blocks.entries()) {
    if (block.type === 'transcript' && block.text.trim()) {
      const start = block.startSeconds ?? 0;
      const end = block.endSeconds ?? start;
      lines.push(
        '',
        `## 音频片段 ${index + 1}（${formatClock(start)}–${formatClock(end)}）`,
        '',
        block.text.trim(),
      );
    } else if (block.type === 'frame' && block.text.trim()) {
      const time = formatClock(block.startSeconds ?? 0);
      lines.push('', `## 画面 ${time}`, '', block.text.trim());
      if (block.asset?.url) {
        lines.push('', `![${block.asset.alt ?? '视频帧'}](${block.asset.url})`);
      }
    }
  }
  if (params.extraMarkdown?.trim()) {
    lines.push('', params.extraMarkdown.trim());
  }
  const markdown = params.status === 'failed' ? '' : lines.join('\n').trim();
  const hasText = params.blocks.some((block) => block.text.trim());
  return {
    kind: params.kind,
    title: params.title,
    blocks: params.blocks,
    markdown,
    status: params.status,
    completeness:
      params.status === 'failed'
        ? 0
        : params.completeness !== undefined
          ? Math.min(1, Math.max(0, params.completeness))
          : params.status === 'complete'
            ? 1
            : hasText
              ? 0.5
              : 0,
    warnings: params.warnings,
  };
}

function renderVideoFrameAssets(blocks: ParsedBlock[]): string {
  const frames = blocks.filter(
    (block) => block.type === 'frame' && block.asset?.url && !block.text.trim(),
  );
  if (frames.length === 0) return '';
  return frames
    .map(
      (frame) =>
        `### 视频帧 ${formatClock(frame.startSeconds ?? 0)}\n\n![${frame.asset?.alt ?? '视频帧'}](${frame.asset?.url})`,
    )
    .join('\n\n');
}

/** 通用 ffmpeg/ffprobe 子进程调用：启动失败 / 非零退出抛出带 stderr 摘要的明确错误 */
export function runFfmpegTool(
  tool: 'ffmpeg' | 'ffprobe',
  args: string[],
  stepLabel: string,
): Promise<{ stdout: string }> {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(tool, args);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: string | Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: string | Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      rejectP(
        new BadRequestException(
          `${stepLabel} failed: ${tool} could not be started (${err.message}). ` +
            'Install ffmpeg on the server to ingest video documents.',
        ),
      );
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolveP({ stdout });
        return;
      }
      rejectP(
        new BadRequestException(
          `${stepLabel} failed (${tool} exited with code ${code}): ${summarizeProcessStderr(stderr)}`,
        ),
      );
    });
  });
}

/** stderr 摘要：ffmpeg 的进度日志都在 stderr，仅保留尾部避免真实错误被刷屏淹没 */
export function summarizeProcessStderr(stderr: string): string {
  const tail = stderr.trim().split('\n').filter(Boolean).slice(-6).join(' | ');
  return tail.length > 600 ? tail.slice(-600) : tail;
}

/** ffprobe 取时长 / 分辨率 / 流构成；封装损坏等异常由 runFfmpegTool 抛出明确错误 */
export async function probeVideoMetadata(
  inputPath: string,
): Promise<VideoProbeResult> {
  const { stdout } = await runFfmpegTool(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=codec_type,width,height',
      '-of',
      'json',
      inputPath,
    ],
    'Video metadata probe',
  );

  let parsed: VideoProbeJson;
  try {
    parsed = JSON.parse(stdout || '{}') as VideoProbeJson;
  } catch {
    throw new BadRequestException(
      'Video metadata probe returned unparseable output; the file may be corrupted.',
    );
  }
  const duration = Number(parsed.format?.duration);
  const streams = parsed.streams ?? [];
  const videoStream = streams.find((stream) => stream.codec_type === 'video');
  return {
    durationSeconds:
      Number.isFinite(duration) && duration > 0 ? duration : null,
    width: videoStream?.width ?? null,
    height: videoStream?.height ?? null,
    hasVideoStream: Boolean(videoStream),
    hasAudioStream: streams.some((stream) => stream.codec_type === 'audio'),
  };
}

/**
 * 抽音轨：`ffmpeg -vn -ac 1 -ar 16000 -f wav`（腾讯 ASR 16k 引擎要求 16kHz 单声道）。
 * 音轨长于 VIDEO_ASR_MAX_SECONDS 时用 `-t` 截断，返回截断秒数供 Markdown 标注。
 */
export async function extractVideoAudioTrack(
  inputPath: string,
  dir: string,
  durationSeconds: number | null,
): Promise<{
  buffer: Buffer | null;
  truncatedSeconds: number | null;
  durationSeconds: number | null;
  sourceDurationSeconds: number | null;
}> {
  const args = [
    '-y',
    '-i',
    inputPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-f',
    'wav',
  ];
  args.push(join(dir, 'audio.wav'));
  await runFfmpegTool('ffmpeg', args, 'Video audio track extraction');

  let buffer: Buffer | null = null;
  try {
    const wav = await readFile(join(dir, 'audio.wav'));
    buffer = wav.length > WAV_HEADER_BYTES ? wav : null;
  } catch {
    buffer = null;
  }
  let extractedDuration: number | null = null;
  if (buffer) {
    extractedDuration = await probeAudioDuration(join(dir, 'audio.wav'));
  }
  const truncatedSeconds =
    durationSeconds !== null &&
    extractedDuration !== null &&
    extractedDuration + 0.1 < durationSeconds
      ? extractedDuration
      : null;
  return {
    buffer,
    truncatedSeconds,
    durationSeconds: extractedDuration,
    sourceDurationSeconds: durationSeconds,
  };
}

/**
 * 按间隔抽关键帧：fps 滤镜一次完成（帧时刻 ≈ 序号 × 间隔），
 * `-frames:v` 兜底总数上限；产物统一为 JPG（时间戳写进对象存储 key）。
 */
export async function extractVideoKeyframes(
  inputPath: string,
  dir: string,
  intervalSeconds: number,
  maxFrames: number,
): Promise<VideoFrameAsset[]> {
  const framesDir = join(dir, 'frames');
  await mkdir(framesDir, { recursive: true });
  await runFfmpegTool(
    'ffmpeg',
    [
      '-y',
      '-i',
      inputPath,
      '-map',
      '0:v:0',
      '-vf',
      `fps=1/${intervalSeconds}`,
      '-frames:v',
      String(maxFrames),
      '-q:v',
      '3',
      '-threads:v',
      '1',
      join(framesDir, 'frame-%03d.jpg'),
    ],
    'Video keyframe extraction',
  );

  const names = (await readdir(framesDir))
    .filter((name) => /^frame-\d+\.jpg$/.test(name))
    .sort();
  const assets: VideoFrameAsset[] = [];
  for (const [offset, name] of names.entries()) {
    const buffer = await readFile(join(framesDir, name));
    if (buffer.length === 0) {
      continue;
    }
    assets.push({
      index: offset + 1,
      timestampSeconds: offset * intervalSeconds,
      buffer,
    });
  }
  return assets;
}

/** 帧图上传：与内嵌图片同款 putObject（key 形如 documents/{docId}/frames/frame-001-00m00s.jpg） */
export async function uploadVideoFrames(
  assets: VideoFrameAsset[],
  video: DocumentVideoExtractionOptions,
): Promise<UploadedVideoFrame[]> {
  const folder = video.docId?.trim() || `doc-${Date.now()}`;
  const ownerPrefix = video.ownerUserId
    ? `${sanitizeObjectKeyPart(video.ownerUserId)}/`
    : '';
  const uploaded: UploadedVideoFrame[] = [];
  try {
    for (const asset of assets) {
      const stored = await video.storage.putObject({
        key: `documents/${ownerPrefix}${folder}/frames/${videoFrameFilename(asset)}`,
        body: asset.buffer,
        contentType: 'image/jpeg',
      });
      uploaded.push({
        index: asset.index,
        timestampSeconds: asset.timestampSeconds,
        url: video.urlResolver ? video.urlResolver(stored) : stored.url,
        description: null,
      });
    }
  } catch (err) {
    // 帧图上传失败：降级为仅保留时间戳与元数据，不阻塞入库（与内嵌图片提取降级语义一致）
    console.warn(
      `video frame upload failed, keeping timestamp-only markdown: ${
        (err as Error).message
      }`,
    );
    return assets.map((asset) => ({
      index: asset.index,
      timestampSeconds: asset.timestampSeconds,
      url: null,
      description: null,
    }));
  }
  return uploaded;
}

/** 帧图对象存储文件名：帧序号 + 时间戳（00m10s，避免冒号进入 key） */
export function videoFrameFilename(asset: VideoFrameAsset): string {
  return `frame-${String(asset.index).padStart(3, '0')}-${formatClockCompact(asset.timestampSeconds)}.jpg`;
}

/** 批量生成关键帧描述：并发 ≤2，单帧失败回退 null，绝不阻塞入库 */
export async function describeVideoFrames(
  uploaded: UploadedVideoFrame[],
  assets: VideoFrameAsset[],
  video: DocumentVideoExtractionOptions,
): Promise<ParsedDocumentWarning[]> {
  const vision =
    video.vision && typeof video.vision.describeImage === 'function'
      ? video.vision
      : null;
  if (!vision || uploaded.length === 0) {
    return [];
  }
  const warnings: ParsedDocumentWarning[] = [];
  const descriptions = await mapWithConcurrency(
    assets,
    VIDEO_FRAME_DESCRIPTION_CONCURRENCY,
    async (asset) => {
      try {
        const result = await vision.describeImage(asset.buffer, 'image/jpeg');
        return (result?.description ?? '').trim() || null;
      } catch (err) {
        console.warn(
          `video frame description failed for frame-${asset.index}: ${
            (err as Error).message
          }`,
        );
        return null;
      }
    },
  );
  uploaded.forEach((frame, index) => {
    frame.description = descriptions[index] ?? null;
    if (!frame.description) {
      warnings.push({
        code: 'vision_frame_missing',
        message: '第 ' + frame.index + ' 帧未生成有效画面描述。',
        startSeconds: frame.timestampSeconds,
        endSeconds: frame.timestampSeconds,
      });
    }
  });
  return warnings;
}

/** 将视频音轨按上限分段转写并保留每段在原视频中的时间范围。 */
export async function transcribeVideoAudio(
  wavBuffer: Buffer | null,
  truncatedSeconds: number | null,
  video: DocumentVideoExtractionOptions,
): Promise<{
  transcript: string | null;
  note: string | null;
  truncatedSeconds: number | null;
}> {
  if (!wavBuffer) {
    return { transcript: null, note: null, truncatedSeconds: null };
  }
  if (!isAsrEnabled(video.asr)) {
    return {
      transcript: null,
      note: '未配置可用的 ASR。',
      truncatedSeconds: null,
    };
  }
  const dir = await mkdtemp(join(tmpdir(), 'video-asr-'));
  try {
    const maxSegmentSeconds = Math.min(
      MEDIA_ASR_SEGMENT_SECONDS,
      Math.max(
        1,
        envPositiveNumber(
          'VIDEO_ASR_MAX_SECONDS',
          VIDEO_ASR_MAX_SECONDS_DEFAULT,
        ),
      ),
    );
    const parsed = await transcribeAudioBuffer(
      wavBuffer,
      dir,
      video.asr,
      maxSegmentSeconds,
    );
    const transcript = parsed.blocks
      .map((block) => {
        const start = block.startSeconds ?? 0;
        const end = block.endSeconds ?? start;
        return (
          '### ' +
          formatClock(start) +
          '–' +
          formatClock(end) +
          '\\n\\n' +
          block.text
        );
      })
      .join('\\n\\n');
    return {
      transcript: transcript || null,
      note: transcript
        ? null
        : (parsed.warnings[0]?.message ?? 'ASR returned an empty transcript'),
      truncatedSeconds: truncatedSeconds ?? null,
    };
  } catch (error) {
    return {
      transcript: null,
      note: error instanceof Error ? error.message : String(error),
      truncatedSeconds: truncatedSeconds ?? null,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** 合成视频 Markdown 时只保留真实转写、画面描述或帧资源。 */
export function composeVideoMarkdown(params: {
  filename: string;
  sizeBytes: number;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  hasAudioStream: boolean;
  hasVideoStream: boolean;
  intervalSeconds: number;
  maxFrames: number;
  frames: UploadedVideoFrame[];
  transcript: string | null;
  asrNote: string | null;
  asrTruncatedSeconds: number | null;
  visionConfigured: boolean;
}): string {
  const sections: string[] = [];
  if (params.transcript?.trim()) {
    sections.push('## 音频转写\\n\\n' + params.transcript.trim());
  }
  for (const frame of params.frames) {
    if (frame.description?.trim()) {
      sections.push(
        '## 画面 ' +
          formatClock(frame.timestampSeconds) +
          '\\n\\n' +
          frame.description.trim(),
      );
    }
    if (frame.url) {
      sections.push(
        '### 视频帧 ' +
          formatClock(frame.timestampSeconds) +
          '\\n\\n![视频帧](' +
          frame.url +
          ')',
      );
    }
  }
  if (sections.length === 0) return '';
  return '# 视频 ' + params.filename + '\\n\\n' + sections.join('\\n\\n');
}

/** mm:ss 时钟格式（帧标题 / 概览用） */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/** 00m10s 紧凑格式（对象存储 key 文件名用，避免冒号） */
export function formatClockCompact(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}m${ss}s`;
}

/** 字节数人类可读格式（概览 / 报错信息用） */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}
