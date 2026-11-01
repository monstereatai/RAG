#!/usr/bin/env node
/**
 * 视频 MP4 入库链路冒烟脚本（离线，不依赖任何外部服务）
 *
 * 覆盖链路：
 *   1. kind 判定：mp4 / mov / m4v / webm 识别为 video；
 *   2. 完整链路：本机 ffmpeg 现场生成短视频（testsrc 画面 + sine 音轨）→
 *      校验容器与视频流 → 按 55 秒切分音轨、按间隔抽关键帧 →
 *      注入 stub ASR / Vision / 对象存储委托 → 结构化 ParsedDocument；
 *   3. 关键帧总数上限（VIDEO_MAX_KEYFRAMES）生效；
 *   4. ASR / Vision 未配置时记录失败状态与告警，不生成占位正文；
 *   5. 长音轨分段转写，保留每段源时间范围并报告局部失败；
 *   6. 超过 VIDEO_MAX_BYTES 大小护栏的视频报明确错误。
 *
 * 夹具与产物在运行时生成到系统临时目录：
 *   - sample-video.mp4：ffmpeg 生成的 3 秒测试视频；
 *   - output/：stub 委托真实收到的 WAV 音轨与关键帧 JPG（落盘供人工检查）。
 *
 * 前置：本机安装 ffmpeg/ffprobe；先执行 `pnpm --filter backend run build`
 * （脚本 import dist 编译产物）。
 * 通过标准：全部断言通过，exit 0。
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const distParserPath = resolve(
  scriptDir,
  '../dist/src/modules/document/document-parser.util.js',
);
const distMediaParserPath = resolve(
  scriptDir,
  '../dist/src/modules/document/document-parser.media.js',
);

if (!existsSync(distParserPath)) {
  console.error(
    `[smoke-video-parse] dist 编译产物不存在：${distParserPath}\n` +
      '请先执行 `pnpm --filter backend run build` 再运行本脚本。',
  );
  process.exit(1);
}

// 本机 ffmpeg 可用性前置检查（解析器运行时也会再探测一次）
const ffmpegBin = '/opt/homebrew/bin/ffmpeg';
const ffmpegInPath =
  spawnSync('which', ['ffmpeg'], { encoding: 'utf-8' }).status === 0;
const ffmpegToUse = existsSync(ffmpegBin) ? ffmpegBin : 'ffmpeg';
if (!existsSync(ffmpegBin) && !ffmpegInPath) {
  console.error(
    '[smoke-video-parse] 未找到 ffmpeg，请先安装（brew install ffmpeg）。',
  );
  process.exit(1);
}

// dist 产物为 CommonJS，走 ESM-CJS 互操作
const parserModule = await import(distParserPath);
const { detectDocumentKind } = parserModule;
const mediaParserModule = await import(distMediaParserPath);
const { parseVideoDocument } = mediaParserModule;

const fixturesDir = mkdtempSync(join(tmpdir(), 'rag-video-parse-smoke-'));
process.on('exit', () => {
  rmSync(fixturesDir, { recursive: true, force: true });
});
const outputDir = join(fixturesDir, 'output');

const failures = [];
function check(condition, label) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}`);
    failures.push(label);
  }
}

async function expectRejected(label, action, messagePattern) {
  try {
    await action();
    check(false, `${label}（实际未抛错）`);
  } catch (err) {
    const matched = messagePattern
      ? messagePattern.test(err?.message ?? '')
      : true;
    check(
      matched,
      `${label} — 抛错信息：${String(err?.message).slice(0, 160)}`,
    );
  }
}

/* ── 夹具生成：本机 ffmpeg 现场渲染测试视频 ────────────────── */

function generateFixtureVideo(path, durationSeconds = 3) {
  const result = spawnSync(
    ffmpegToUse,
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `testsrc=duration=${durationSeconds}:size=320x240:rate=10`,
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:duration=${durationSeconds}`,
      '-shortest',
      '-pix_fmt',
      'yuv420p',
      path,
    ],
    { encoding: 'utf-8' },
  );
  if (result.status !== 0) {
    throw new Error(
      `ffmpeg fixture generation failed: ${String(result.stderr).slice(-400)}`,
    );
  }
}

/* ── 注入的 stub 委托（storage / ASR / vision）───────────────── */

/** 对象存储 stub：记录每次上传并把字节落盘，返回固定外链 */
function createStubStorage() {
  const objects = [];
  return {
    objects,
    async putObject(params) {
      objects.push({ ...params });
      await writeFile(join(outputDir, basename(params.key)), params.body);
      return { key: params.key, url: `https://minio.test/${params.key}` };
    },
  };
}

/** ASR stub：记录每次转写调用（含音频字节），返回固定转写文本 */
function createStubAsr({ text, emptyOnCall, emptyBelowBytes } = {}) {
  const calls = [];
  return {
    calls,
    async transcribe(audioBuffer, format) {
      calls.push({ size: audioBuffer.length, format, buffer: audioBuffer });
      if (
        calls.length === emptyOnCall ||
        (emptyBelowBytes && audioBuffer.length < emptyBelowBytes)
      ) {
        return '';
      }
      return (
        text ??
        '【Stub ASR】音轨转写内容：新产品发布计划由 PMO 在下周一评审，预算上限 300 万。'
      );
    },
  };
}

/** Vision stub：记录每次图片描述调用（含帧图字节），返回带帧序号的描述 */
function createStubVision() {
  const calls = [];
  let seq = 0;
  return {
    calls,
    async describeImage(imageBuffer, mimeType) {
      seq += 1;
      const call = {
        seq,
        size: imageBuffer.length,
        mimeType,
        buffer: imageBuffer,
      };
      calls.push(call);
      return {
        description: `【Stub Vision】第 ${seq} 帧画面：testsrc 彩条与移动十字线。`,
        tags: ['test-pattern'],
      };
    },
  };
}

/** 断言 buffer 是合法 WAV（RIFF/WAVE 头）且非空 */
function isWav(buffer) {
  return (
    Buffer.isBuffer(buffer) &&
    buffer.length > 44 &&
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WAVE'
  );
}

/** 断言 buffer 是合法 JPEG（SOI 头）且非空 */
function isJpeg(buffer) {
  return (
    Buffer.isBuffer(buffer) &&
    buffer.length > 4 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8
  );
}

function setEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

/* ── 主流程 ─────────────────────────────────────────────── */

async function main() {
  console.log(`[smoke-video-parse] dist parser: ${distParserPath}`);
  console.log(`[smoke-video-parse] ffmpeg used for fixtures: ${ffmpegToUse}`);

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  const videoPath = join(fixturesDir, 'sample-video.mp4');
  generateFixtureVideo(videoPath, 3);
  const videoBuffer = await readFile(videoPath);
  console.log(
    `[smoke-video-parse] fixture ready: sample-video.mp4 = ${videoBuffer.length}B\n`,
  );

  // 用例 1：kind 判定（mp4 / mov / m4v / webm → video）
  console.log('[case 1] detectDocumentKind recognizes video extensions');
  check(detectDocumentKind('demo.mp4') === 'video', 'demo.mp4 → video');
  check(detectDocumentKind('DEMO.MOV') === 'video', 'DEMO.MOV → video');
  check(detectDocumentKind('demo.m4v') === 'video', 'demo.m4v → video');
  check(detectDocumentKind('demo.webm') === 'video', 'demo.webm → video');

  // 用例 2：解析短 MP4 并保留转写/关键帧结构与时间戳
  console.log(
    '[case 2] structured parse: real container, ASR, Vision, and frame times',
  );
  setEnv('VIDEO_KEYFRAME_INTERVAL_SECONDS', '1');
  setEnv('VIDEO_MAX_KEYFRAMES', '12');
  setEnv('VIDEO_ASR_MAX_SECONDS', '55');
  const storage = createStubStorage();
  const asr = createStubAsr();
  const vision = createStubVision();
  const parsed = await parseVideoDocument(videoBuffer, {
    storage,
    asr,
    vision,
    docId: 'video-doc-1',
    filename: 'sample-video.mp4',
  });
  const markdown = parsed.markdown;

  check(parsed.status === 'complete', 'ASR/Vision 均可用时状态为 complete');
  check(markdown.includes('# 视频 sample-video.mp4'), 'Markdown 含视频标题');
  check(
    parsed.blocks.some((block) => block.type === 'transcript'),
    'ParsedDocument 包含真实音轨转写块',
  );
  const frames = parsed.blocks.filter((block) => block.type === 'frame');
  check(
    frames.length === 3 &&
      frames.map((frame) => frame.startSeconds).join(',') === '0,1,2',
    'ParsedDocument 保留 3 帧的源时间戳',
  );
  check(
    frames.every((frame) =>
      frame.asset?.url?.includes('documents/video-doc-1/frames/'),
    ),
    '关键帧块保留对象存储地址',
  );
  check(
    storage.objects.length === 3 &&
      storage.objects.every((obj) =>
        obj.key.startsWith('documents/video-doc-1/frames/'),
      ),
    '关键帧通过对象存储委托上传',
  );
  check(
    asr.calls.length === 1 &&
      isWav(asr.calls[0].buffer) &&
      asr.calls[0].format === 'wav' &&
      asr.calls[0].size > 44,
    '短音轨分成 1 个有效 WAV ASR 请求',
  );
  await writeFile(join(outputDir, 'captured-audio.wav'), asr.calls[0].buffer);
  check(
    vision.calls.length === 3 &&
      vision.calls.every(
        (call) => isJpeg(call.buffer) && call.mimeType === 'image/jpeg',
      ),
    'Vision stub 收到 3 张有效 JPG 关键帧',
  );
  check(
    markdown.includes('【Stub ASR】音轨转写内容') &&
      markdown.includes('【Stub Vision】第 1 帧画面') &&
      markdown.includes('【Stub Vision】第 3 帧画面'),
    'Markdown 只包含 ASR 转写与 Vision 描述正文',
  );

  // 用例 3：关键帧总数上限（VIDEO_MAX_KEYFRAMES）
  console.log('[case 3] VIDEO_MAX_KEYFRAMES caps extracted frames');
  setEnv('VIDEO_KEYFRAME_INTERVAL_SECONDS', '1');
  setEnv('VIDEO_MAX_KEYFRAMES', '2');
  const cappedStorage = createStubStorage();
  const cappedParsed = await parseVideoDocument(videoBuffer, {
    storage: cappedStorage,
    asr: createStubAsr(),
    vision: createStubVision(),
    docId: 'video-doc-2',
    filename: 'sample-video.mp4',
  });
  const cappedFrames = cappedParsed.blocks.filter(
    (block) => block.type === 'frame',
  );
  check(cappedFrames.length === 2, '关键帧数受 VIDEO_MAX_KEYFRAMES=2 限制');
  check(
    cappedFrames.map((frame) => frame.startSeconds).join(',') === '0,1',
    '保留前两帧的源时间戳',
  );

  // 用例 4：ASR / Vision 未配置时记录失败状态与解析告警
  console.log('[case 4] unconfigured ASR/Vision return status and warnings');
  setEnv('VIDEO_KEYFRAME_INTERVAL_SECONDS', '1');
  setEnv('VIDEO_MAX_KEYFRAMES', '12');
  const bareStorage = createStubStorage();
  const bareParsed = await parseVideoDocument(videoBuffer, {
    storage: bareStorage,
    docId: 'video-doc-3',
    filename: 'sample-video.mp4',
  });
  check(
    bareParsed.status === 'failed',
    '无 ASR/Vision 正文时解析状态为 failed',
  );
  check(bareParsed.markdown === '', '失败解析不生成占位正文');
  check(
    bareParsed.warnings.some((warning) => warning.code === 'asr_unavailable') &&
      bareParsed.warnings.some(
        (warning) => warning.code === 'vision_unavailable',
      ),
    '解析结果分别记录 ASR 与 Vision 缺失告警',
  );
  check(
    bareStorage.objects.length === 3,
    '即使缺少转写/描述，真实关键帧仍保存供后续处理',
  );

  // 用例 5：66 秒音轨分段转写，保留完整时间范围与尾段告警
  console.log(
    '[case 5] 66-second audio is segmented without truncating its tail',
  );
  setEnv('VIDEO_KEYFRAME_INTERVAL_SECONDS', '55');
  setEnv('VIDEO_MAX_KEYFRAMES', '1');
  setEnv('VIDEO_ASR_MAX_SECONDS', '55');
  const longVideoPath = join(fixturesDir, 'sample-long-video.mp4');
  generateFixtureVideo(longVideoPath, 66);
  const longVideoBuffer = await readFile(longVideoPath);
  const segmentedAsr = createStubAsr();
  const segmentedParsed = await parseVideoDocument(longVideoBuffer, {
    storage: createStubStorage(),
    asr: segmentedAsr,
    vision: createStubVision(),
    docId: 'video-doc-4',
    filename: 'sample-long-video.mp4',
  });
  const transcripts = segmentedParsed.blocks.filter(
    (block) => block.type === 'transcript',
  );
  check(
    segmentedAsr.calls.length === 2 && transcripts.length === 2,
    '66 秒音轨分成两段并调用两次 ASR',
  );
  check(
    transcripts[0]?.startSeconds === 0 &&
      (transcripts[0]?.endSeconds ?? 0) > 54 &&
      Math.abs(
        (transcripts[1]?.startSeconds ?? 0) - (transcripts[0]?.endSeconds ?? 0),
      ) < 0.01 &&
      (transcripts[1]?.endSeconds ?? 0) > 65,
    '两个转写块时间连续，第二段覆盖 60 秒之后的尾段',
  );
  check(
    segmentedParsed.status === 'complete' && segmentedParsed.completeness === 1,
    '所有分段完成时状态为 complete 且完整度为 1',
  );

  const partialAsr = createStubAsr({ emptyBelowBytes: 1_000_000 });
  const partialParsed = await parseVideoDocument(longVideoBuffer, {
    storage: createStubStorage(),
    asr: partialAsr,
    vision: createStubVision(),
    docId: 'video-doc-4-partial',
    filename: 'sample-long-video.mp4',
  });
  const partialTranscript = partialParsed.blocks.find(
    (block) => block.type === 'transcript',
  );
  const tailWarning = partialParsed.warnings.find(
    (warning) => warning.code === 'asr_segment_empty',
  );
  check(
    partialAsr.calls.length === 2 &&
      tailWarning?.startSeconds === partialTranscript?.endSeconds &&
      (tailWarning?.endSeconds ?? 0) > 65,
    '未识别的末段告警包含从上一段结尾到 60 秒之后的源范围',
  );
  check(
    partialParsed.status === 'partial' && partialParsed.completeness < 1,
    '未处理尾段会降低解析完整度并标记 partial',
  );

  // 用例 6：超过 VIDEO_MAX_BYTES 大小护栏 → 明确报错
  console.log('[case 6] oversize video rejected with a clear error');
  setEnv('VIDEO_MAX_BYTES', '100');
  await expectRejected(
    '超限视频抛出带 VIDEO_MAX_BYTES 语义的错误',
    () =>
      parseVideoDocument(videoBuffer, {
        storage: createStubStorage(),
        docId: 'video-doc-5',
        filename: 'sample-video.mp4',
      }),
    /VIDEO_MAX_BYTES/,
  );

  // 恢复环境变量，避免影响同进程后续用例
  [
    'VIDEO_MAX_BYTES',
    'VIDEO_KEYFRAME_INTERVAL_SECONDS',
    'VIDEO_MAX_KEYFRAMES',
    'VIDEO_ASR_MAX_SECONDS',
  ].forEach((name) => setEnv(name, undefined));

  console.log('');
  if (failures.length > 0) {
    console.error(
      `[smoke-video-parse] FAILED: ${failures.length} assertion(s)`,
    );
    process.exit(1);
  }
  console.log('[smoke-video-parse] ALL CHECKS PASSED');
  process.exit(0);
}

main().catch((err) => {
  console.error(`[smoke-video-parse] unexpected error: ${err?.stack ?? err}`);
  process.exit(1);
});
