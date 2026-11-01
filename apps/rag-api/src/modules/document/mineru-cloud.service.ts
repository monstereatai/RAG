import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import type { DocumentImageExtractionOptions, ParsedDocument, SupportedDocumentKind } from './document-parser.types';
import { convertMineruResult } from './mineru-cloud.result';

// Distinct from self-hosted MinerU's /v1/tasks API.
const API_BASE = 'https://mineru.net/api/v4';
const MINERU_KINDS = new Set<SupportedDocumentKind>(['pdf','doc','docx','ppt','pptx','xlsx','xls']);
const MAX_UPLOAD = 200 * 1024 * 1024;
const MAX_ZIP_BYTES = 100 * 1024 * 1024;
const MAX_UNZIPPED_BYTES = 240 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30000;
const MAX_WAIT_MS = 300000;
const POLL_INTERVAL_MS = 2500;

interface ApiReply<T> { code: number; msg?: string; data?: T }
interface UploadReply { batch_id: string; file_urls: string[] }
interface TaskStatus { file_name?: string; data_id?: string; state?: string; full_zip_url?: string; err_msg?: string }
interface StatusReply { extract_result: TaskStatus[] }

type Fetcher = typeof fetch;

function numberEnv(key: string, fallback: number, max: number): number {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value),max) : fallback;
}
function allowedExternalUrl(raw: string, category: 'upload'|'result'): string {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) throw new Error('MinerU returned unsafe external URL');
  const host = url.hostname.toLowerCase();
  const uploadHosts = ['mineru.oss-cn-shanghai.aliyuncs.com'];
  const resultHosts = ['cdn-mineru.openxlab.org.cn'];
  if (!(category === 'upload' ? uploadHosts : resultHosts).includes(host)) throw new Error('MinerU returned unexpected external host');
  return url.toString();
}

async function boundedBytes(response: Response, maxBytes: number): Promise<Buffer> {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes) throw new Error('MinerU response exceeds byte limit');
  if (!response.body) throw new Error('MinerU response body is missing');
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const part of response.body) {
    const chunk = part instanceof Uint8Array ? part : new Uint8Array(part);
    total += chunk.length;
    if (total > maxBytes) {
      await response.body.cancel().catch(() => undefined);
      throw new Error('MinerU response exceeds byte limit');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks,total);
}

@Injectable()
export class MineruCloudService {
  private readonly logger = new Logger(MineruCloudService.name);
  // Argument injection allows a real HTTP integration test without using user credentials.
  private http: Fetcher = fetch;

  isEnabled(): boolean { return process.env.MINERU_ENABLED === 'true' && process.env.MINERU_PROVIDER === 'cloud_v4'; }
  accepts(kind: SupportedDocumentKind): boolean { return this.isEnabled() && MINERU_KINDS.has(kind); }
  fallbackEnabled(): boolean { return process.env.MINERU_FALLBACK_LOCAL === 'true'; }

  async parse(input: {
    buffer: Buffer;
    kind: SupportedDocumentKind;
    filename: string;
    images?: DocumentImageExtractionOptions;
  }): Promise<ParsedDocument> {
    if (!MINERU_KINDS.has(input.kind)) throw new Error(`MinerU does not support ${input.kind}`);
    if (input.buffer.length === 0 || input.buffer.length > MAX_UPLOAD) throw new Error('MinerU file is empty or exceeds 200MB');
    const token = process.env.MINERU_API_KEY?.trim();
    if (!token) throw new Error('MINERU_API_KEY is missing; cloud parsing is not configured');
    const started = Date.now();
    const timeout = numberEnv('MINERU_MAX_WAIT_MS', 180000, MAX_WAIT_MS);
    const filename = input.filename.replace(/[\\/\r\n\0]/g, '_').slice(0,180);
    const dataId = randomUUID();
    // A ZIP result is already the official final artifact; do not expose CDN image URLs downstream.
    const signed = await this.jsonRequest<UploadReply>(`${API_BASE}/file-urls/batch`, token, {
      method:'POST',
      body: JSON.stringify({
        files: [{name:filename,data_id:dataId}],
        model_version:process.env.MINERU_MODEL_VERSION === 'pipeline' ? 'pipeline':'vlm',
        enable_table:true,
        enable_formula:true,
        language:'ch',
      }),
    });
    if (!signed.batch_id || signed.file_urls?.length !== 1) throw new Error('MinerU did not return a valid single-file batch');
    const uploadUrl = allowedExternalUrl(signed.file_urls[0], 'upload');
    // Signed upload URL: never attach the Bearer token or a synthetic Content-Type.
    await this.request(uploadUrl, {method:'PUT',body:new Uint8Array(input.buffer)}, Math.min(timeout,120000));
    let zipUrl: string | undefined;
    while (Date.now() - started < timeout) {
      const result = await this.jsonRequest<StatusReply>(`${API_BASE}/extract-results/batch/${encodeURIComponent(signed.batch_id)}`,token,{method:'GET'});
      const matches = Array.isArray(result.extract_result) ? result.extract_result : [];
      const task = matches.find(x => x.data_id === dataId) ?? (matches.length === 1 ? matches[0] : undefined);
      if (task?.state === 'failed') throw new Error(`MinerU task failed${task.err_msg ? ': '+task.err_msg.slice(0,120):''}`);
      if (task?.state === 'done') {
        if (!task.full_zip_url) throw new Error('MinerU task completed without result URL');
        zipUrl = allowedExternalUrl(task.full_zip_url,'result');
        break;
      }
      if (task?.state && !['waiting-file','pending','running','converting'].includes(task.state)) throw new Error('MinerU returned unrecognized task state');
      await new Promise<void>(resolve => setTimeout(resolve,POLL_INTERVAL_MS));
    }
    if (!zipUrl) throw new Error('MinerU cloud parse exceeded the configured wait time');
    const zipResponse = await this.request(zipUrl,{method:'GET'},Math.min(timeout,120000));
    const zipBytes = await boundedBytes(zipResponse, MAX_ZIP_BYTES);
    const zip = await JSZip.loadAsync(zipBytes, {checkCRC32:true});
    let total = 0;
    for (const entry of Object.values(zip.files)) {
      const size = (entry as unknown as {_data?: {uncompressedSize?: number}})._data?.uncompressedSize ?? 0;
      total += size;
      if (total > MAX_UNZIPPED_BYTES) throw new Error('MinerU archive uncompressed size exceeds limit');
      if (entry.name.includes('..') || entry.name.startsWith('/') || entry.name.includes('\\')) throw new Error('MinerU archive has invalid member path');
    }
    const contentFiles = Object.values(zip.files).filter(f=>!f.dir);
    const mdFile = contentFiles.find(f=>/(^|\/)full\.md$/i.test(f.name)) ?? contentFiles.find(f=>/\.md$/i.test(f.name));
    if (!mdFile) throw new Error('MinerU archive contains no Markdown document');
    const markdown = await mdFile.async('string');
    if (markdown.length > 40 * 1024 * 1024) throw new Error('MinerU Markdown exceeds character limit');
    const candidates = contentFiles.filter(f=>f.name.endsWith('.json') && !/model|middle|layout/i.test(f.name));
    let json: unknown;
    for (const entry of candidates) {
      if ((entry as unknown as {_data?:{uncompressedSize?:number}})._data?.uncompressedSize &&
        (entry as unknown as {_data?:{uncompressedSize?:number}})._data!.uncompressedSize! > 30 * 1024 * 1024) continue;
      try {
        const data = JSON.parse(await entry.async('string')) as Record<string,unknown>;
        if (Array.isArray(data?.pdf_info)) {json=data;break;}
      } catch { /* MinerU JSON schema varies by version; Markdown remains the fallback. */ }
    }
    const parsed = await convertMineruResult({...input,filename,markdown,json,zip,originalBuffer:input.buffer});
    this.logger.log(`MinerU cloud parsed ${input.kind}: blocks=${parsed.blocks.length}, status=${parsed.status}`);
    if (parsed.status === 'failed') throw new Error('MinerU output did not contain indexable content');
    return parsed;
  }

  private async request(url: string, options: RequestInit, timeout: number): Promise<Response> {
    const response = await this.http(url,{...options,redirect:'error',signal:AbortSignal.timeout(timeout)});
    if (!response.ok) throw new Error(`MinerU HTTP request failed with status ${response.status}`);
    return response;
  }
  private async jsonRequest<T>(url: string, token: string, options: RequestInit): Promise<T> {
    const response = await this.request(url,{...options,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}},REQUEST_TIMEOUT_MS);
    const bytes = await boundedBytes(response, 4 * 1024 * 1024);
    let body: ApiReply<T>;
    try {body = JSON.parse(bytes.toString('utf8')) as ApiReply<T>;} catch {throw new Error('MinerU returned malformed JSON');}
    if (body.code !== 0 || !body.data) throw new Error(`MinerU API error code ${String(body.code)}`);
    return body.data;
  }
}
