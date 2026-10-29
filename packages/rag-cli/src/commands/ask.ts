import type { Command } from 'commander';
import { addBaseOptions, createRuntime, runCommand, withSpinner, type CommandDeps } from './shared.js';
import { chatModeSchema, type AskResult, type RagReference } from '../core/schemas.js';

export function registerAskCommand(program: Command, deps: CommandDeps): void {
  addBaseOptions(
    program
      .command('ask')
      .description('Ask RAG knowledge base')
      .argument('<query>', 'question')
      .option('-m, --mode <mode>', 'simple, agentic, auto', 'auto')
      .option('--stream', 'stream backend SSE events', false)
      .option('--thread-id <threadId>', 'conversation thread id'),
  ).action(async (query: string, rawOptions) => {
    const runtime = await createRuntime(deps, rawOptions);
    await runCommand(async () => {
      const mode = chatModeSchema.parse(rawOptions.mode);
      if (rawOptions.stream === true) {
        await streamAsk(runtime, {
          query,
          mode,
          threadId: typeof rawOptions.threadId === 'string' ? rawOptions.threadId : undefined,
        });
        return;
      }
      const result = await withSpinner(runtime.options, 'Asking RAG', () =>
        runtime.apiClient.ask({
          query,
          mode,
          threadId: typeof rawOptions.threadId === 'string' ? rawOptions.threadId : undefined,
        }),
      );
      runtime.output.write({
        status: 'ok',
        data:
          runtime.options.format === 'markdown'
            ? formatAskMarkdown(result)
            : result,
      });
    }, runtime.output);
  });
}

async function streamAsk(
  runtime: Awaited<ReturnType<typeof createRuntime>>,
  input: { query: string; mode: ReturnType<typeof chatModeSchema.parse>; threadId?: string },
): Promise<void> {
  if (runtime.options.format === 'json') {
    for await (const event of runtime.apiClient.streamChat(input)) {
      process.stdout.write(`${JSON.stringify({ status: 'ok', data: event })}\n`);
    }
    return;
  }

  let wroteAnswer = false;
  for await (const event of runtime.apiClient.streamChat(input)) {
    const payload = event.data;
    const record =
      payload && typeof payload === 'object'
        ? (payload as Record<string, unknown>)
        : undefined;
    const type = String(record?.type ?? event.type ?? '');
    const data = record?.data ?? record ?? payload;

    if (type === 'token' || type === 'TEXT_MESSAGE_CONTENT') {
      const text = extractText(data);
      if (text) {
        process.stdout.write(text);
        wroteAnswer = true;
      }
      continue;
    }

    if (type === 'final' || type === 'TEXT_MESSAGE_END') {
      const text = extractText(data);
      if (text && !wroteAnswer) {
        process.stdout.write(text);
      }
      if (wroteAnswer || text) {
        process.stdout.write('\n');
      }
      continue;
    }

    if (type === 'error') {
      const message = extractText(data) || 'stream error';
      process.stdout.write(`\nError: ${message}\n`);
    }
  }
}

function extractText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  const candidates = [
    record.text,
    record.content,
    record.answer,
    record.message,
    record.delta,
  ];
  const found = candidates.find((item) => typeof item === 'string');
  return typeof found === 'string' ? found : '';
}

function formatAskMarkdown(result: AskResult): string {
  const lines = [result.answer?.trim() || '(empty answer)'];
  const meta = [
    result.mode ? `mode=${result.mode}` : null,
    result.route ? `route=${result.route}` : null,
    typeof result.retrievalSufficient === 'boolean'
      ? `retrieval=${result.retrievalSufficient ? 'sufficient' : 'insufficient'}`
      : null,
  ].filter(Boolean);

  if (meta.length > 0 || result.retrievalReason) {
    lines.push('', '---', `Status: ${meta.join(', ') || 'ok'}`);
    if (result.retrievalReason) {
      lines.push(`Reason: ${result.retrievalReason}`);
    }
  }

  const references = (result.references ?? []).slice(0, 8);
  if (references.length > 0) {
    lines.push('', 'Sources:');
    references.forEach((reference, index) => {
      lines.push(formatReference(reference, index + 1));
    });
  }

  const obsidianPaths = (result.obsidianPaths ?? []).slice(0, 5);
  if (obsidianPaths.length > 0) {
    lines.push('', 'Obsidian:');
    obsidianPaths.forEach((path, index) => {
      lines.push(`${index + 1}. ${path}`);
    });
  }

  return lines.join('\n');
}

function formatReference(reference: RagReference, index: number): string {
  const title =
    reference.title ??
    reference.source?.documentName?.toString() ??
    reference.docId ??
    reference.id ??
    'unknown';
  const score = reference.totalScore ?? reference.score;
  const scoreText =
    typeof score === 'number' ? ` score=${Number(score.toFixed(4))}` : '';
  const authority = reference.sourceAuthority ? ` source=${reference.sourceAuthority}` : '';
  return `${index}. ${title}${scoreText}${authority}`;
}
