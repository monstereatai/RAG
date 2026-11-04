import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export const DOCUMENT_PII_ENTITIES = [
  'CN_MOBILE_PHONE',
  'CN_RESIDENT_ID',
  'CN_BANK_CARD',
  'CUSTOM_EMAIL',
  'CREDENTIAL',
] as const;

export type DocumentPiiEntity = (typeof DOCUMENT_PII_ENTITIES)[number];

interface AnalyzerResult {
  start: number;
  end: number;
  entity_type: string;
}

interface AnalyzerSegment {
  valueIndex: number;
  start: number;
  text: string;
}

interface Redaction {
  start: number;
  end: number;
  entity: DocumentPiiEntity;
}

const MAX_ANALYSIS_CHARS = 20_000_000;
const SEGMENT_CHARS = 4_000;
const SEGMENT_OVERLAP = 64;
const BATCH_SIZE = 2;
const ENTITY_LABELS: Record<DocumentPiiEntity, string> = {
  CN_MOBILE_PHONE: '[手机号]',
  CN_RESIDENT_ID: '[身份证号]',
  CN_BANK_CARD: '[银行卡号]',
  CUSTOM_EMAIL: '[邮箱]',
  CREDENTIAL: '[凭据]',
};
const ENTITY_PRIORITY: Record<DocumentPiiEntity, number> = {
  CREDENTIAL: 5,
  CN_RESIDENT_ID: 4,
  CN_BANK_CARD: 3,
  CUSTOM_EMAIL: 2,
  CN_MOBILE_PHONE: 1,
};

const AD_HOC_RECOGNIZERS = [
  {
    name: 'Chinese mobile phone recognizer',
    supported_language: 'en',
    supported_entity: 'CN_MOBILE_PHONE',
    patterns: [
      {
        name: 'mainland mobile phone',
        regex:
          '(?<![0-9])(?:\\+?86[ -]?)?1[3-9][0-9](?:[ -]?)[0-9]{4}(?:[ -]?)[0-9]{4}(?![0-9])',
        score: 0.9,
      },
    ],
  },
  {
    name: 'Chinese resident identity card recognizer',
    supported_language: 'en',
    supported_entity: 'CN_RESIDENT_ID',
    patterns: [
      {
        name: '18 digit resident identity card',
        regex:
          '(?<![0-9])[1-9][0-9]{5}(?:18|19|20)[0-9]{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12][0-9]|3[01])[0-9]{3}[0-9Xx](?![0-9])',
        score: 0.9,
      },
    ],
  },
  {
    name: 'bank card recognizer',
    supported_language: 'en',
    supported_entity: 'CN_BANK_CARD',
    patterns: [
      {
        name: 'bank card candidate',
        regex: '(?<![0-9])[0-9](?:[0-9 -]{13,25})[0-9](?![0-9])',
        score: 0.8,
      },
    ],
  },
  {
    name: 'email recognizer',
    supported_language: 'en',
    supported_entity: 'CUSTOM_EMAIL',
    patterns: [
      {
        name: 'email address',
        regex:
          '(?i)(?<![A-Z0-9._%+-])[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}(?![A-Z0-9.-])',
        score: 0.9,
      },
    ],
  },
  {
    name: 'obvious credential recognizer',
    supported_language: 'en',
    supported_entity: 'CREDENTIAL',
    context: [
      'password',
      'passwd',
      'pwd',
      'api_key',
      'access_token',
      'refresh_token',
      'client_secret',
      'bearer',
    ],
    patterns: [
      {
        name: 'credential assignment',
        regex:
          '(?i)\\b(?:password|passwd|pwd|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret)\\b\\s*[:=]\\s*["\\x27]?[A-Za-z0-9._~+/-]{8,}={0,2}',
        score: 0.9,
      },
      {
        name: 'quoted password assignment',
        regex:
          '(?i)\\b(?:password|passwd|pwd)\\b\\s*[:=]\\s*["\\x27][^"\\x27\\r\\n]{8,}["\\x27]',
        score: 0.9,
      },
      {
        name: 'bearer token',
        regex: '(?i)\\bBearer\\s+[A-Za-z0-9._~+/-]{16,}={0,2}',
        score: 0.9,
      },
      {
        name: 'common provider key',
        regex:
          '(?<![A-Za-z0-9])(?:sk-(?:ant-)?[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{22,}|AKIA[0-9A-Z]{16})(?![A-Za-z0-9])',
        score: 0.9,
      },
      {
        name: 'JWT token',
        regex:
          '(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{12,}\\.[A-Za-z0-9_-]{12,}\\.[A-Za-z0-9_-]{12,}(?![A-Za-z0-9_-])',
        score: 0.9,
      },
    ],
  },
];

@Injectable()
export class DocumentPrivacyService {
  private http: typeof fetch = fetch;

  async redactTextFields<T>(input: T): Promise<{
    value: T;
    entityTypes: DocumentPiiEntity[];
  }> {
    const uniqueValues = Array.from(
      new Set(collectStrings(input).filter((value) => value.length > 0)),
    );
    if (uniqueValues.length === 0) {
      return { value: input, entityTypes: [] };
    }

    const totalChars = uniqueValues.reduce(
      (total, value) => total + value.length,
      0,
    );
    if (totalChars > MAX_ANALYSIS_CHARS) {
      throw new ServiceUnavailableException(
        'Local privacy analysis input limit exceeded; document ingestion was blocked.',
      );
    }

    const { redactions, entityTypes } = await this.analyzeValues(uniqueValues);
    const replacements = new Map<string, string>();
    for (let index = 0; index < uniqueValues.length; index += 1) {
      replacements.set(
        uniqueValues[index],
        redactValue(uniqueValues[index], redactions[index] ?? []),
      );
    }

    return {
      value: replaceStrings(input, replacements) as T,
      entityTypes,
    };
  }

  async redactText(value: string): Promise<{
    text: string;
    entityTypes: DocumentPiiEntity[];
  }> {
    const result = await this.redactTextFields(value);
    return { text: result.value, entityTypes: result.entityTypes };
  }

  private async analyzeValues(values: string[]): Promise<{
    redactions: Redaction[][];
    entityTypes: DocumentPiiEntity[];
  }> {
    const redactions = values.map(() => [] as Redaction[]);
    const segments: AnalyzerSegment[] = [];
    for (let valueIndex = 0; valueIndex < values.length; valueIndex += 1) {
      const value = values[valueIndex];
      let start = 0;
      while (start < value.length) {
        let end = Math.min(start + SEGMENT_CHARS, value.length);
        if (end < value.length && isHighSurrogate(value.charCodeAt(end - 1))) {
          end -= 1;
        }
        segments.push({ valueIndex, start, text: value.slice(start, end) });
        if (end === value.length) break;
        start = Math.max(start + 1, end - SEGMENT_OVERLAP);
        if (isLowSurrogate(value.charCodeAt(start))) start -= 1;
      }
    }

    for (let offset = 0; offset < segments.length; offset += BATCH_SIZE) {
      const batch = segments.slice(offset, offset + BATCH_SIZE);
      const batchResults = await this.analyzeBatch(
        batch.map(({ text }) => text),
      );
      for (let index = 0; index < batch.length; index += 1) {
        const segment = batch[index];
        for (const result of batchResults[index]) {
          const entity = asDocumentPiiEntity(result.entity_type);
          if (!entity || !validRange(result, segment.text)) continue;
          const startCodeUnit = codePointOffsetToCodeUnit(
            segment.text,
            result.start,
          );
          const endCodeUnit = codePointOffsetToCodeUnit(
            segment.text,
            result.end,
          );
          const matched = segment.text.slice(startCodeUnit, endCodeUnit);
          if (!isValidFinding(entity, matched)) continue;
          redactions[segment.valueIndex].push({
            start: segment.start + startCodeUnit,
            end: segment.start + endCodeUnit,
            entity,
          });
        }
      }
    }

    const entityTypes = new Set<DocumentPiiEntity>();
    for (let index = 0; index < redactions.length; index += 1) {
      redactions[index] = selectNonOverlapping(redactions[index]);
      redactions[index].forEach(({ entity }) => entityTypes.add(entity));
    }
    return { redactions, entityTypes: Array.from(entityTypes) };
  }

  private async analyzeBatch(texts: string[]): Promise<AnalyzerResult[][]> {
    let response: Response;
    try {
      response = await this.http(this.getAnalyzerUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: texts,
          language: 'en',
          entities: [...DOCUMENT_PII_ENTITIES],
          return_decision_process: false,
          ad_hoc_recognizers: AD_HOC_RECOGNIZERS,
        }),
        signal: AbortSignal.timeout(30_000),
        redirect: 'error',
      });
    } catch {
      throw new ServiceUnavailableException(
        'Local privacy analyzer is unavailable; document ingestion was blocked.',
      );
    }

    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Local privacy analyzer returned HTTP ${response.status}; document ingestion was blocked.`,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ServiceUnavailableException(
        'Local privacy analyzer returned an invalid response; document ingestion was blocked.',
      );
    }
    if (
      !Array.isArray(payload) ||
      payload.length !== texts.length ||
      payload.some((items) => !Array.isArray(items))
    ) {
      throw new ServiceUnavailableException(
        'Local privacy analyzer returned an incomplete response; document ingestion was blocked.',
      );
    }
    return payload as AnalyzerResult[][];
  }

  private getAnalyzerUrl(): string {
    const configured = process.env.PII_ANALYZER_URL?.trim();
    let url: URL;
    try {
      url = new URL(configured || 'http://127.0.0.1:5002');
    } catch {
      throw new ServiceUnavailableException(
        'PII_ANALYZER_URL must point to the local privacy analyzer.',
      );
    }
    const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
    if (
      url.protocol !== 'http:' ||
      !loopbackHosts.has(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new ServiceUnavailableException(
        'PII_ANALYZER_URL must point to a loopback HTTP privacy analyzer.',
      );
    }
    url.pathname = '/analyze';
    return url.toString();
  }
}

function collectStrings(value: unknown, strings: string[] = []): string[] {
  if (typeof value === 'string') {
    strings.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, strings));
  } else if (value && typeof value === 'object' && !(value instanceof Date)) {
    Object.values(value).forEach((item) => collectStrings(item, strings));
  }
  return strings;
}

function replaceStrings(
  value: unknown,
  replacements: Map<string, string>,
): unknown {
  if (typeof value === 'string') {
    return replacements.get(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => replaceStrings(item, replacements));
  }
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        replaceStrings(item, replacements),
      ]),
    );
  }
  return value;
}

function validRange(result: AnalyzerResult, text: string): boolean {
  return (
    Number.isInteger(result.start) &&
    Number.isInteger(result.end) &&
    result.start >= 0 &&
    result.end > result.start &&
    result.end <= Array.from(text).length
  );
}

function asDocumentPiiEntity(value: string): DocumentPiiEntity | undefined {
  return (DOCUMENT_PII_ENTITIES as readonly string[]).includes(value)
    ? (value as DocumentPiiEntity)
    : undefined;
}

function codePointOffsetToCodeUnit(text: string, offset: number): number {
  let codePoints = 0;
  let codeUnits = 0;
  for (const character of text) {
    if (codePoints === offset) return codeUnits;
    codePoints += 1;
    codeUnits += character.length;
  }
  return codeUnits;
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

function isValidFinding(entity: DocumentPiiEntity, value: string): boolean {
  switch (entity) {
    case 'CN_MOBILE_PHONE':
      return /^(?:861[3-9][0-9]{9}|1[3-9][0-9]{9})$/.test(
        value.replace(/[^0-9]/g, ''),
      );
    case 'CN_RESIDENT_ID':
      return isValidChineseResidentId(value);
    case 'CN_BANK_CARD':
      return passesLuhn(value);
    case 'CUSTOM_EMAIL':
      return /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(
        value,
      );
    case 'CREDENTIAL':
      return true;
  }
}

function isValidChineseResidentId(value: string): boolean {
  const id = value.toUpperCase();
  if (
    !/^[1-9][0-9]{5}(?:18|19|20)[0-9]{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12][0-9]|3[01])[0-9]{3}[0-9X]$/.test(
      id,
    )
  ) {
    return false;
  }
  const year = Number(id.slice(6, 10));
  const month = Number(id.slice(10, 12));
  const day = Number(id.slice(12, 14));
  const birthDate = new Date(Date.UTC(year, month - 1, day));
  if (
    birthDate.getUTCFullYear() !== year ||
    birthDate.getUTCMonth() !== month - 1 ||
    birthDate.getUTCDate() !== day
  ) {
    return false;
  }
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checks = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  const sum = weights.reduce(
    (total, weight, index) => total + Number(id[index]) * weight,
    0,
  );
  return checks[sum % 11] === id[17];
}

function passesLuhn(value: string): boolean {
  const digits = value.replace(/[^0-9]/g, '');
  if (digits.length < 16 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function selectNonOverlapping(redactions: Redaction[]): Redaction[] {
  const unique = new Map<string, Redaction>();
  for (const item of redactions) {
    unique.set(`${item.start}:${item.end}:${item.entity}`, item);
  }
  const ordered = Array.from(unique.values()).sort(
    (left, right) =>
      left.start - right.start ||
      ENTITY_PRIORITY[right.entity] - ENTITY_PRIORITY[left.entity] ||
      right.end - left.end,
  );
  const selected: Redaction[] = [];
  let lastEnd = -1;
  for (const item of ordered) {
    if (item.start < lastEnd) continue;
    selected.push(item);
    lastEnd = item.end;
  }
  return selected;
}

function redactValue(value: string, redactions: Redaction[]): string {
  let output = value;
  for (const item of [...redactions].sort(
    (left, right) => right.start - left.start,
  )) {
    output =
      output.slice(0, item.start) +
      ENTITY_LABELS[item.entity] +
      output.slice(item.end);
  }
  return output;
}
