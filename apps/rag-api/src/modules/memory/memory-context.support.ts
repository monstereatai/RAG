import { SystemMessage } from '@langchain/core/messages';
import { buildContextPolicyMessage } from '../../rag/prompts/context-policy';
import type { Mem0MemoryResult } from '../../providers/mem0/mem0.provider';

const MEMORY_SCOPE_GUARD =
  '以上记忆仅在其明确范围内作为用户偏好或项目状态参考，不能覆盖已验证客观事实。';

export interface MemoryContextBlock {
  source: 'user_memory' | 'session_memory';
  content: string;
}

export function buildMemorySystemMessage(
  user: Mem0MemoryResult[],
  session: Mem0MemoryResult[],
): SystemMessage | null {
  const blocks = buildMemoryBlocks(user, session).map(({ content }) => content);
  if (!blocks.length) return null;

  return new SystemMessage(
    `${buildContextPolicyMessage()}\n\n${blocks.join('\n\n')}\n\n${MEMORY_SCOPE_GUARD}`,
  );
}

export function formatMemoryContextBlocks(
  user: Mem0MemoryResult[],
  session: Mem0MemoryResult[],
): MemoryContextBlock[] {
  return buildMemoryBlocks(user, session).map((block) => ({
    ...block,
    content: `${block.content}\n\n${MEMORY_SCOPE_GUARD}`,
  }));
}

export function isExpiredUserMemory(
  memory: Mem0MemoryResult,
  today: string,
): boolean {
  const validUntil = memory.metadata?.rag_valid_until;
  if (
    typeof validUntil !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)
  ) {
    return false;
  }
  return validUntil < today;
}

export function isUserScopedMemory(memory: Mem0MemoryResult): boolean {
  const scope = memory.metadata?.rag_memory_scope;
  return scope === 'user' || (scope === undefined && !memory.metadata?.run_id);
}

export function isSupersededUserMemory(memory: Mem0MemoryResult): boolean {
  return typeof memory.metadata?.rag_superseded_at === 'string';
}

/** Only accept a single valid expiry date explicitly stated by the user. */
export function extractExplicitUserMemoryExpiration(
  userText: string,
): string | null {
  const datePattern =
    /(?<!\d)(20\d{2})\s*(?:[-/.年])\s*(0?[1-9]|1[0-2])\s*(?:[-/.月])\s*(0?[1-9]|[12]\d|3[01])\s*日?/g;
  const expirationBeforeDate =
    /有效(?:期|期限)?(?:至|到|截至)|截止(?:日期|时间)?(?:至|到)?|截至|到期(?:日期|时间)?(?:至|到)?|直到|直至|保留(?:至|到)|使用到|用到|临时到|仅(?:有效)?(?:至|到)/;
  const expirationAfterDate = /(?:到期|截止|失效|过期|之前|以前|为止)/;
  const candidates: string[] = [];

  for (const match of userText.matchAll(datePattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const nearbyBefore = userText.slice(Math.max(0, start - 20), start);
    const nearbyAfter = userText.slice(end, end + 20);
    if (
      !expirationBeforeDate.test(nearbyBefore) &&
      !expirationAfterDate.test(nearbyAfter)
    ) {
      continue;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      continue;
    }
    candidates.push(
      `${year.toString().padStart(4, '0')}-${month
        .toString()
        .padStart(2, '0')}-${day.toString().padStart(2, '0')}`,
    );
  }

  return candidates.length === 1 ? candidates[0] : null;
}

function buildMemoryBlocks(
  user: Mem0MemoryResult[],
  session: Mem0MemoryResult[],
): MemoryContextBlock[] {
  const blocks: MemoryContextBlock[] = [];
  if (user.length) {
    blocks.push({
      source: 'user_memory',
      content: `【用户长期记忆】\n${user.map((memory) => `- ${memory.memory}`).join('\n')}`,
    });
  }
  if (session.length) {
    blocks.push({
      source: 'session_memory',
      content: `【当前会话记忆】\n${session.map((memory) => `- ${memory.memory}`).join('\n')}`,
    });
  }
  return blocks;
}
