import { Injectable, ServiceUnavailableException } from '@nestjs/common';

const FEISHU_OPEN_API = 'https://open.feishu.cn/open-apis';
const PAGE_SIZE = 50;
const MAX_PAGES = 1000;

export interface FeishuWikiNode {
  node_token: string;
  obj_token?: string;
  obj_type?: string;
  title?: string;
  has_child?: boolean;
}

export interface FeishuDocumentContent {
  text: string;
  revisionId?: string;
}

interface FeishuPage<T> {
  items: T[];
  has_more: boolean;
  page_token?: string;
}

@Injectable()
export class FeishuWikiApiClient {
  private token?: string;
  private tokenExpiresAt = 0;
  private tokenPromise?: Promise<string>;

  async listNodes(
    spaceId: string,
    parentNodeToken?: string,
  ): Promise<FeishuWikiNode[]> {
    const nodes: FeishuWikiNode[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const query = new URLSearchParams({ page_size: String(PAGE_SIZE) });
      if (parentNodeToken) query.set('parent_node_token', parentNodeToken);
      if (pageToken) query.set('page_token', pageToken);
      const data = await this.getData<FeishuPage<FeishuWikiNode>>(
        `/wiki/v2/spaces/${encodeURIComponent(spaceId)}/nodes?${query.toString()}`,
      );
      this.assertPage(data, 'Wiki node list');
      if (
        data.items.some(
          (node) =>
            !isRecord(node) ||
            typeof node.node_token !== 'string' ||
            !node.node_token.trim() ||
            typeof node.has_child !== 'boolean',
        )
      ) {
        throw new ServiceUnavailableException(
          'Feishu Wiki node list contains an invalid node',
        );
      }
      nodes.push(...data.items);
      if (!data.has_more) return nodes;
      if (!data.page_token || data.page_token === pageToken) {
        throw new ServiceUnavailableException(
          'Feishu Wiki returned an invalid page cursor',
        );
      }
      pageToken = data.page_token;
    }
    throw new ServiceUnavailableException(
      'Feishu Wiki node pagination limit exceeded',
    );
  }

  async getNode(nodeToken: string): Promise<FeishuWikiNode> {
    const query = new URLSearchParams({ token: nodeToken });
    const data = await this.getData<{ node?: FeishuWikiNode }>(
      `/wiki/v2/spaces/get_node?${query.toString()}`,
    );
    if (!data.node?.node_token) {
      throw new ServiceUnavailableException(
        'Feishu Wiki node response is incomplete',
      );
    }
    return data.node;
  }

  async getDocumentContent(documentId: string): Promise<FeishuDocumentContent> {
    const root = await this.listBlocks(documentId);
    const lines: string[] = [];
    const visited = new Set<string>();
    const visit = async (
      blocks: FeishuBlock[],
      depth: number,
    ): Promise<void> => {
      if (depth > 30)
        throw new ServiceUnavailableException(
          'Feishu document nesting limit exceeded',
        );
      for (const block of blocks) {
        if (block.block_id && visited.has(block.block_id)) continue;
        if (block.block_id) visited.add(block.block_id);
        const text = extractBlockText(block);
        if (text) lines.push(text);
        if (block.has_child && block.block_id) {
          const children = await this.listBlocks(documentId, block.block_id);
          await visit(children.items, depth + 1);
        }
      }
    };
    await visit(root.items, 0);
    const text = lines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!text)
      throw new ServiceUnavailableException(
        'Feishu document has no extractable text',
      );
    return { text, revisionId: root.revisionId };
  }

  private async listBlocks(
    documentId: string,
    parentBlockId?: string,
  ): Promise<{ items: FeishuBlock[]; revisionId?: string }> {
    const blocks: FeishuBlock[] = [];
    let pageToken: string | undefined;
    let revisionId: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const base = `/docx/v1/documents/${encodeURIComponent(documentId)}/blocks`;
      const path = parentBlockId
        ? `${base}/${encodeURIComponent(parentBlockId)}/children`
        : base;
      const query = new URLSearchParams({ page_size: String(PAGE_SIZE) });
      if (pageToken) query.set('page_token', pageToken);
      const data = await this.getData<
        FeishuPage<FeishuBlock> & { document_revision_id?: number | string }
      >(`${path}?${query.toString()}`);
      this.assertPage(data, 'document block list');
      blocks.push(...data.items);
      revisionId ??=
        data.document_revision_id === undefined
          ? undefined
          : String(data.document_revision_id);
      if (!data.has_more) return { items: blocks, revisionId };
      if (!data.page_token || data.page_token === pageToken) {
        throw new ServiceUnavailableException(
          'Feishu document returned an invalid page cursor',
        );
      }
      pageToken = data.page_token;
    }
    throw new ServiceUnavailableException(
      'Feishu document pagination limit exceeded',
    );
  }

  private async getData<T>(path: string): Promise<T> {
    let response = await this.request(path);
    if (response.code === 99991663) {
      this.token = undefined;
      this.tokenExpiresAt = 0;
      response = await this.request(path);
    }
    if (response.code !== 0) {
      throw new ServiceUnavailableException(
        `Feishu API request failed (${String(response.code)}): ${safeMessage(response.msg)}`,
      );
    }
    if (!response.data || typeof response.data !== 'object') {
      throw new ServiceUnavailableException(
        'Feishu API returned an invalid response',
      );
    }
    return response.data as T;
  }

  private assertPage<T>(
    page: FeishuPage<T>,
    resource: string,
  ): asserts page is FeishuPage<T> {
    if (!Array.isArray(page.items) || typeof page.has_more !== 'boolean') {
      throw new ServiceUnavailableException(
        `Feishu ${resource} returned an invalid page`,
      );
    }
  }

  private async request(path: string): Promise<FeishuEnvelope> {
    const token = await this.getTenantAccessToken();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`${FEISHU_OPEN_API}${path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      const payload: unknown = await response.json();
      if (
        !response.ok ||
        !isRecord(payload) ||
        typeof payload.code !== 'number'
      ) {
        throw new ServiceUnavailableException(
          `Feishu API HTTP request failed (${response.status})`,
        );
      }
      return payload as unknown as FeishuEnvelope;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('Feishu API is unavailable');
    } finally {
      clearTimeout(timeout);
    }
  }

  private async getTenantAccessToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;
    if (this.tokenPromise) return this.tokenPromise;
    this.tokenPromise = this.fetchTenantAccessToken();
    try {
      return await this.tokenPromise;
    } finally {
      this.tokenPromise = undefined;
    }
  }

  private async fetchTenantAccessToken(): Promise<string> {
    const appId = process.env.FEISHU_APP_ID?.trim();
    const appSecret = process.env.FEISHU_APP_SECRET?.trim();
    if (!appId || !appSecret) {
      throw new ServiceUnavailableException(
        'FEISHU_APP_ID and FEISHU_APP_SECRET must be configured in the backend environment',
      );
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(
        `${FEISHU_OPEN_API}/auth/v3/tenant_access_token/internal`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            Accept: 'application/json',
          },
          body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
          signal: controller.signal,
        },
      );
      const payload: unknown = await response.json();
      if (
        !response.ok ||
        !isRecord(payload) ||
        payload.code !== 0 ||
        typeof payload.tenant_access_token !== 'string'
      ) {
        const code = isRecord(payload) ? payload.code : 'unknown';
        const message = isRecord(payload)
          ? safeMessage(payload.msg)
          : 'invalid response';
        throw new ServiceUnavailableException(
          `Feishu token request failed (${String(code)}): ${message}`,
        );
      }
      const expireSeconds =
        typeof payload.expire === 'number' ? payload.expire : 7200;
      this.token = payload.tenant_access_token;
      this.tokenExpiresAt =
        Date.now() + Math.max(60, expireSeconds - 300) * 1000;
      return this.token;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException(
        'Feishu token service is unavailable',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

interface FeishuEnvelope {
  code: number;
  msg?: unknown;
  data?: unknown;
}

interface FeishuBlock {
  block_id?: string;
  block_type?: number;
  has_child?: boolean;
  [key: string]: unknown;
}

function extractBlockText(block: FeishuBlock): string {
  const parts: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;
    if (
      isRecord(value.text_run) &&
      typeof value.text_run.content === 'string'
    ) {
      parts.push(value.text_run.content);
    }
    for (const [key, child] of Object.entries(value)) {
      if (key !== 'text_run') visit(child);
    }
  };
  visit(block);
  return parts.join('').trim();
}

function safeMessage(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 240) : 'unknown error';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
