#!/usr/bin/env node
/**
 * 视频 MP4 入库链路冒烟脚本（离线，不依赖任何外部服务）
 *
 * 覆盖链路：
 *   1. kind 判定：mp4 / mov / m4v / webm 识别为 video；
 *   2. 完整链路：本机 ffmpeg 现场生成 3s 测试视频（testsrc 画面 + sine 音轨）→
 *      ffprobe 元数据 → 抽 16kHz WAV 音轨 + 按间隔抽关键帧 →
 *      注入的 stub ASR / Vision / 对象存储委托 → 合成 Markdown；
 *   3. 关键帧总数上限（VIDEO_MAX_KEYFRAMES）生效；
 *   4. ASR / Vision 未配置时降级文案（帧图仍上传，不阻塞入库）；
 *   5. 长音轨按 VIDEO_ASR_MAX_SECONDS 截断并在 Markdown 标注；
 *   6. 超过 VIDEO_MAX_BYTES 大小护栏的视频报明确错误。
 *
 * 夹具与产物在运行时生成到 scripts/fixtures/：
 *   - sample-video.mp4：ffmpeg 生成的 3 秒测试视频；
 *   - output/：stub 委托真实收到的 WAV 音轨与关键帧 JPG（落盘供人工检查）。
 *
 * 前置：本机安装 ffmpeg/ffprobe；先执行 `pnpm --filter backend run build`
 * （脚本 import dist 编译产物）。
 * 通过标准：全部断言通过，exit 0。
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const distParserPath = resolve(
  scriptDir,
  '../dist/src/modules/document/document-parser.util.js',
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
  console.error('[smoke-video-parse] 未找到 ffmpeg，请先安装（brew install ffmpeg）。');
  process.exit(1);
}

// dist 产物为 CommonJS，走 ESM-CJS 互操作
const parserModule = await import(distParserPath);
const { detectDocumentKind, extractDocumentText } = parserModule;

const fixturesDir = join(scriptDir, 'fixtures');
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
function createStubAsr({ text } = {}) {
  const calls = [];
  return {
    calls,
    async transcribe(audioBuffer, format) {
      calls.push({ size: audioBuffer.length, format, buffer: audioBuffer });
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
      const call = { seq, size: imageBuffer.length, mimeType, buffer: imageBuffer };
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

  // 用例 2：完整链路（间隔 1s 抽帧 → 3 帧；stub 委托真实收到 WAV / JPG）
  console.log('[case 2] full pipeline: kind → ffmpeg → stub delegates → markdown');
  setEnv('VIDEO_KEYFRAME_INTERVAL_SECONDS', '1');
  setEnv('VIDEO_MAX_KEYFRAMES', '12');
  setEnv('VIDEO_ASR_MAX_SECONDS', '60');
  const storage = createStubStorage();
  const asr = createStubAsr();
  const vision = createStubVision();
  const markdown = await extractDocumentText(videoBuffer, 'video', undefined, undefined, {
    storage,
    asr,
    vision,
    docId: 'video-doc-1',
    filename: 'sample-video.mp4',
  });

  check(
    markdown.includes('# 视频 sample-video.mp4'),
    'Markdown 含 `# 视频 {filename}` 标题',
  );
  check(markdown.includes('## 概览'), 'Markdown 含 `## 概览`');
  check(markdown.includes('## 音频转写'), 'Markdown 含 `## 音频转写`');
  check(markdown.includes('## 画面要点'), 'Markdown 含 `## 画面要点`');
  check(
    markdown.includes('分辨率：320x240'),
    '概览写入 ffprobe 分辨率（320x240）',
  );
  check(
    /时长：00:0[23]（[23]\.\d 秒）/.test(markdown),
    '概览写入 ffprobe 时长（约 3 秒）',
  );
  check(
    markdown.includes('### 第 1 帧（00:00）') &&
      markdown.includes('### 第 2 帧（00:01）') &&
      markdown.includes('### 第 3 帧（00:02）'),
    '画面要点按 `### 第 N 帧（mm:ss）` 分段（3 帧，时间戳随间隔递增）',
  );
  check(
    /!\[frame\]\(https:\/\/minio\.test\/documents\/video-doc-1\/frames\/frame-001-00m00s\.jpg\)/.test(
      markdown,
    ),
    '帧图渲染为 `![frame](minio url)` 外链（documents/{docId}/frames/）',
  );
  check(
    storage.objects.length === 3 &&
      storage.objects.every((obj) => obj.key.startsWith('documents/video-doc-1/frames/')),
    `帧图全部经对象存储委托上传（objects=${storage.objects.length}，key 前缀正确）`,
  );
  check(
    asr.calls.length === 1 &&
      isWav(asr.calls[0].buffer) &&
      asr.calls[0].format === 'wav' &&
      asr.calls[0].size > 44,
    `ASR stub 恰好收到 1 次非空 WAV 音轨（size=${asr.calls[0]?.size}B, format=${asr.calls[0]?.format}）`,
  );
  await writeFile(join(outputDir, 'captured-audio.wav'), asr.calls[0].buffer);
  check(
    vision.calls.length === 3 &&
      vision.calls.every((call) => isJpeg(call.buffer) && call.mimeType === 'image/jpeg'),
    `Vision stub 恰好收到 3 张真实 JPG 关键帧（sizes=${vision.calls
      .map((call) => `${call.seq}:${call.size}B`)
      .join(', ')}）`,
  );
  check(
    markdown.includes('【Stub ASR】音轨转写内容') &&
      markdown.includes('【Stub Vision】第 1 帧画面') &&
      markdown.includes('【Stub Vision】第 3 帧画面'),
    'Markdown 按帧合成了 stub 转写与画面描述',
  );
  check(
    markdown.includes('实际抽取 3 帧'),
    '概览写入了抽帧间隔/上限与实际帧数',
  );

  // 用例 3：关键帧总数上限（VIDEO_MAX_KEYFRAMES）
  console.log('[case 3] VIDEO_MAX_KEYFRAMES caps extracted frames');
  setEnv('VIDEO_KEYFRAME_INTERVAL_SECONDS', '1');
  setEnv('VIDEO_MAX_KEYFRAMES', '2');
  const cappedStorage = createStubStorage();
  const cappedMarkdown = await extractDocumentText(
    videoBuffer,
    'video',
    undefined,
    undefined,
    {
      storage: cappedStorage,
      asr: createStubAsr(),
      vision: createStubVision(),
      docId: 'video-doc-2',
      filename: 'sample-video.mp4',
    },
  );
  check(
    cappedStorage.objects.length === 2,
    `帧数被 VIDEO_MAX_KEYFRAMES=2 截断（objects=${cappedStorage.objects.length}）`,
  );
  check(
    cappedMarkdown.includes('### 第 2 帧（00:01）') &&
      !cappedMarkdown.includes('### 第 3 帧'),
    'Markdown 只保留前 2 帧的分段画面',
  );

  // 用例 4：ASR / Vision 未配置 → 降级文案，帧图仍上传
  console.log('[case 4] unconfigured ASR/vision degrade without blocking');
  setEnv('VIDEO_KEYFRAME_INTERVAL_SECONDS', '1');
  setEnv('VIDEO_MAX_KEYFRAMES', '12');
  const bareStorage = createStubStorage();
  const bareMarkdown = await extractDocumentText(
    videoBuffer,
    'video',
    undefined,
    undefined,
    { storage: bareStorage, docId: 'video-doc-3', filename: 'sample-video.mp4' },
  );
  check(
    bareMarkdown.includes('未配置转写 provider（ASR），仅保留帧图与元数据。'),
    '音频转写段写入 ASR 未配置降级文案',
  );
  check(
    bareMarkdown.includes('未配置视觉 provider（Vision），仅保留帧图与元数据。'),
    '画面要点段写入 Vision 未配置降级文案',
  );
  check(
    bareStorage.objects.length === 3,
    '降级路径下帧图仍全部上传（不阻塞入库）',
  );
  check(
    /!\[frame\]\(https:\/\/minio\.test\/documents\/video-doc-3\/frames\//.test(bareMarkdown),
    '降级路径下 Markdown 仍含帧图外链',
  );

  // 用例 5：长音轨按 VIDEO_ASR_MAX_SECONDS 截断并在 Markdown 标注
  console.log('[case 5] long audio track truncated with a markdown note');
  setEnv('VIDEO_ASR_MAX_SECONDS', '2');
  const truncatedAsr = createStubAsr();
  const truncatedMarkdown = await extractDocumentText(
    videoBuffer,
    'video',
    undefined,
    undefined,
    {
      storage: createStubStorage(),
      asr: truncatedAsr,
      docId: 'video-doc-4',
      filename: 'sample-video.mp4',
    },
  );
  check(
    truncatedMarkdown.includes('已截断后送转写'),
    'Markdown 标注了长音轨截断',
  );
  check(
    truncatedAsr.calls.length === 1 &&
      truncatedAsr.calls[0].size < asr.calls[0].size,
    `截断后的 WAV 明显小于完整音轨（${truncatedAsr.calls[0]?.size}B < ${asr.calls[0]?.size}B）`,
  );

  // 用例 6：超过 VIDEO_MAX_BYTES 大小护栏 → 明确报错
  console.log('[case 6] oversize video rejected with a clear error');
  setEnv('VIDEO_MAX_BYTES', '100');
  await expectRejected(
    '超限视频抛出带 VIDEO_MAX_BYTES 语义的错误',
    () =>
      extractDocumentText(videoBuffer, 'video', undefined, undefined, {
        storage: createStubStorage(),
        docId: 'video-doc-5',
        filename: 'sample-video.mp4',
      }),
    /VIDEO_MAX_BYTES/,
  );

  // 恢复环境变量，避免影响同进程后续用例
  ['VIDEO_MAX_BYTES', 'VIDEO_KEYFRAME_INTERVAL_SECONDS', 'VIDEO_MAX_KEYFRAMES', 'VIDEO_ASR_MAX_SECONDS'].forEach(
    (name) => setEnv(name, undefined),
  );

  console.log('');
  if (failures.length > 0) {
    console.error(`[smoke-video-parse] FAILED: ${failures.length} assertion(s)`);
    process.exit(1);
  }
  console.log('[smoke-video-parse] ALL CHECKS PASSED');
  process.exit(0);
}

main().catch((err) => {
  console.error(`[smoke-video-parse] unexpected error: ${err?.stack ?? err}`);
  process.exit(1);
});
