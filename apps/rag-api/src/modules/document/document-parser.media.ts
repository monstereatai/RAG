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
import { mediaFallbackMarkdown } from './document-parser.office';
import {
  mapWithConcurrency,
  envPositiveNumber,
} from './document-parser.shared';
import type {
  DocumentAsrDelegate,
  DocumentVideoExtractionOptions,
  VideoProbeResult,
  VideoFrameAsset,
  UploadedVideoFrame,
  VideoProbeJson,
} from './document-parser.types';

/** 将独立音频转成检索正文；分段不超过腾讯云一句话识别的单次时长限制。 */
export async function extractAudioDocumentText(
  buffer: Buffer,
  filename: string,
  asr?: DocumentAsrDelegate,
): Promise<string> {
  if (
    !asr ||
    typeof asr.transcribe !== 'function' ||
    (typeof asr.isEnabled === 'function' && !asr.isEnabled())
  ) {
    throw new BadRequestException(
      '音频入库需要配置 ASR 转写服务，当前文件未建立文本索引。',
    );
  }
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
    const probe = await probeVideoMetadata(inputPath);
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

    const segmentSeconds = 55;
    const segmentPattern = join(dir, 'segment-%04d.wav');
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
        segmentPattern,
      ],
      'Audio normalization and segmentation',
    );

    const segmentNames = (await readdir(dir))
      .filter((name) => /^segment-\d+\.wav$/.test(name))
      .sort();
    if (segmentNames.length === 0) {
      throw new BadRequestException(
        'audio file produced no transcription segments',
      );
    }
    const transcripts = await mapWithConcurrency(
      segmentNames,
      2,
      async (name) => {
        const wav = await readFile(join(dir, name));
        if (wav.length <= WAV_HEADER_BYTES || wav.length > 3 * 1024 * 1024) {
          throw new BadRequestException(
            `normalized audio segment is outside Tencent ASR limits: ${name}`,
          );
        }
        return (await asr.transcribe(wav, 'wav')).trim();
      },
    );
    const sections = transcripts
      .map((transcript, index) => {
        const start = index * segmentSeconds;
        const end = Math.min(
          start + segmentSeconds,
          probe.durationSeconds ?? start + segmentSeconds,
        );
        return transcript
          ? `### 片段 ${index + 1}（${formatClock(start)}–${formatClock(end)}）\n\n${transcript}`
          : '';
      })
      .filter(Boolean);
    if (sections.length === 0) {
      throw new BadRequestException('ASR returned an empty transcript');
    }
    return [`# 音频转写：${filename}`, '', ...sections].join('\n\n');
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/* ── 视频入库：ffmpeg 抽音轨 + 关键帧 → ASR / Vision → 合成 Markdown ──
 *
 * 与 PDF/PPTX 内嵌图片提取同一套「解析器 + 委托注入」风格：
 *   - 音轨：ffmpeg 抽成 16kHz 单声道 WAV（腾讯云 16k 引擎要求）交给 ASR 委托；
 *   - 画面：按间隔抽关键帧（JPG）上传对象存储后交给 Vision 委托逐帧描述；
 *   - 合成：# 视频 {filename} + ## 概览 / ## 音频转写 / ## 画面要点。
 *
 * 错误语义（对照扫描件 OCR / 内嵌图片提取）：
 *   - 视频超过大小护栏、ffmpeg/ffprobe 缺失、封装损坏、抽轨/抽帧失败：
 *     抛出带明确语义的错误，绝不静默入库空文档；
 *   - ASR / Vision 委托未配置或调用失败：对应段落写降级文案，不阻塞入库。
 */
/** 超过该大小的视频直接拒绝入库（默认 200MB，可用 VIDEO_MAX_BYTES 覆盖） */
export const VIDEO_MAX_BYTES_DEFAULT = 200 * 1024 * 1024;

/** 独立音频入库大小上限；音频与视频采用相同的默认上限。 */
export const AUDIO_MAX_BYTES_DEFAULT = 200 * 1024 * 1024;

/** 关键帧抽帧间隔秒数（默认 10s，可用 VIDEO_KEYFRAME_INTERVAL_SECONDS 覆盖） */
export const VIDEO_KEYFRAME_INTERVAL_SECONDS_DEFAULT = 10;

/** 关键帧总数上限（默认 12 帧，可用 VIDEO_MAX_KEYFRAMES 覆盖） */
export const VIDEO_MAX_KEYFRAMES_DEFAULT = 12;

/**
 * 送转写的音轨最大时长（秒，默认 60，可用 VIDEO_ASR_MAX_SECONDS 覆盖）。
 * 腾讯云一句话识别（SentenceRecognition）单次上限 60s，超长音轨截断送转写
 * 并在 Markdown 的转写段标注，避免长视频入库直接失败。
 */
export const VIDEO_ASR_MAX_SECONDS_DEFAULT = 60;

/** 关键帧画面描述的并发上限（视觉模型调用温和节流，与图片 alt 生成一致） */
export const VIDEO_FRAME_DESCRIPTION_CONCURRENCY = 2;

/** WAV 头部标准长度：判断 ffmpeg 产物是否含有效音频数据 */
export const WAV_HEADER_BYTES = 44;

/**
 * 视频入库主流程：大小护栏 → ffprobe 元数据 → 抽帧/抽轨 → 上传/委托 → 合成 Markdown。
 *
 * 未提供视频入库参数（无对象存储委托）时退回元数据占位 Markdown，
 * 保持与其他媒体类型一致的兜底行为。
 */
export async function extractVideoDocumentText(
  buffer: Buffer,
  video?: DocumentVideoExtractionOptions,
): Promise<string> {
  if (
    !video ||
    !video.storage ||
    typeof video.storage.putObject !== 'function'
  ) {
    return mediaFallbackMarkdown('Video Document', buffer);
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

    const probe = await probeVideoMetadata(inputPath);
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
      ? await extractVideoAudioTrack(inputPath, dir, probe.durationSeconds)
      : {
          buffer: null as Buffer | null,
          truncatedSeconds: null as number | null,
        };

    const uploadedFrames = await uploadVideoFrames(frameAssets, video);
    await describeVideoFrames(uploadedFrames, frameAssets, video);

    const { transcript, note, truncatedSeconds } = await transcribeVideoAudio(
      audio.buffer,
      audio.truncatedSeconds,
      video,
    );

    return composeVideoMarkdown({
      filename: video.filename?.trim() || 'Document',
      sizeBytes: buffer.length,
      durationSeconds: probe.durationSeconds,
      width: probe.width,
      height: probe.height,
      hasAudioStream: probe.hasAudioStream,
      hasVideoStream: probe.hasVideoStream,
      intervalSeconds,
      maxFrames,
      frames: uploadedFrames,
      transcript,
      asrNote: note,
      asrTruncatedSeconds: truncatedSeconds,
      visionConfigured: Boolean(
        video.vision && typeof video.vision.describeImage === 'function',
      ),
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
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
): Promise<{ buffer: Buffer | null; truncatedSeconds: number | null }> {
  const maxSeconds = Math.max(
    1,
    envPositiveNumber('VIDEO_ASR_MAX_SECONDS', VIDEO_ASR_MAX_SECONDS_DEFAULT),
  );
  const truncated =
    durationSeconds !== null && durationSeconds > maxSeconds + 0.05;
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
  if (truncated) {
    args.push('-t', String(maxSeconds));
  }
  args.push(join(dir, 'audio.wav'));
  await runFfmpegTool('ffmpeg', args, 'Video audio track extraction');

  let buffer: Buffer | null = null;
  try {
    const wav = await readFile(join(dir, 'audio.wav'));
    buffer = wav.length > WAV_HEADER_BYTES ? wav : null;
  } catch {
    buffer = null;
  }
  return {
    buffer,
    truncatedSeconds: truncated && buffer ? maxSeconds : null,
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
      '-vf',
      `fps=1/${intervalSeconds}`,
      '-frames:v',
      String(maxFrames),
      '-q:v',
      '3',
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
): Promise<void> {
  const vision =
    video.vision && typeof video.vision.describeImage === 'function'
      ? video.vision
      : null;
  if (!vision || uploaded.length === 0) {
    return; // 未配置 vision：描述保持 null，由合成阶段写降级文案
  }
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
  });
}

/** 音轨转写：委托未配置 / 失败 / 空结果时返回降级说明，不阻塞入库 */
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
  const asr =
    video.asr && typeof video.asr.transcribe === 'function' ? video.asr : null;
  if (!asr) {
    return { transcript: null, note: null, truncatedSeconds: null };
  }
  try {
    const text = (await asr.transcribe(wavBuffer, 'wav'))?.trim();
    return {
      transcript: text || null,
      note: text ? null : 'ASR 返回了空转写结果。',
      truncatedSeconds,
    };
  } catch (err) {
    return {
      transcript: null,
      note: `音频转写失败（已保留帧图与元数据）：${(err as Error).message}`,
      truncatedSeconds,
    };
  }
}

/** 合成视频入库 Markdown：# 视频 {filename} + 概览 / 音频转写 / 画面要点 */
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
  const lines: string[] = [`# 视频 ${params.filename}`, '', '## 概览', ''];
  lines.push(`- 来源：${params.filename}（${formatBytes(params.sizeBytes)}）`);
  lines.push(
    `- 时长：${
      params.durationSeconds !== null
        ? `${formatClock(params.durationSeconds)}（${params.durationSeconds.toFixed(1)} 秒）`
        : '未知'
    }`,
  );
  lines.push(
    `- 分辨率：${
      params.width && params.height
        ? `${params.width}x${params.height}`
        : '未知'
    }`,
  );
  lines.push(
    `- 关键帧：每 ${params.intervalSeconds}s 抽帧、上限 ${params.maxFrames} 帧，` +
      `实际抽取 ${params.frames.length} 帧`,
  );

  // 音频转写段：优先转写文本，其次明确语义的降级说明
  lines.push('', '## 音频转写', '');
  if (params.transcript) {
    if (params.asrTruncatedSeconds !== null) {
      lines.push(
        `> 音轨长于 ${params.asrTruncatedSeconds}s（一句话识别上限），已截断后送转写。`,
        '',
      );
    }
    lines.push(params.transcript);
  } else if (params.asrNote) {
    lines.push(params.asrNote);
  } else if (!params.hasAudioStream) {
    lines.push('（本视频未检测到音轨。）');
  } else {
    lines.push('未配置转写 provider（ASR），仅保留帧图与元数据。');
  }

  // 画面要点段：每个关键帧一个三级标题 + 帧图 + 描述
  lines.push('', '## 画面要点', '');
  if (params.frames.length === 0) {
    lines.push(
      params.hasVideoStream
        ? '（未抽取到关键帧。）'
        : '（本视频未检测到视频轨，无关键帧。）',
    );
    return lines.join('\n').trim();
  }
  if (!params.visionConfigured) {
    lines.push('> 未配置视觉 provider（Vision），仅保留帧图与元数据。', '');
  }
  for (const frame of params.frames) {
    lines.push(
      '',
      `### 第 ${frame.index} 帧（${formatClock(frame.timestampSeconds)}）`,
      '',
      frame.url
        ? `![frame](${frame.url})`
        : '（帧图上传失败，仅保留时间戳与元数据。）',
      '',
    );
    lines.push(
      frame.description ??
        (params.visionConfigured ? '（本帧画面描述生成失败。）' : ''),
    );
  }
  return lines.join('\n').trimEnd();
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
