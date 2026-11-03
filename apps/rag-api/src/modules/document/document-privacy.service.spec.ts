import { ServiceUnavailableException } from '@nestjs/common';
import { DocumentPrivacyService } from './document-privacy.service';

const examples = {
  phone: '13800138000',
  prefixedPhone: '+86 13800138000',
  id: '11010519491231002X',
  lowercaseId: '11010519491231002x',
  invalidId: '110105194912310029',
  card: '4111111111111111',
  invalidCard: '4111111111111112',
  email: 'reader@example.com',
  credential: 'password=abc12345long',
};

describe('DocumentPrivacyService', () => {
  it('redacts valid structured PII and obvious credentials in nested fields', async () => {
    const service = new DocumentPrivacyService();
    const fetchMock = jest.fn(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(bodyText(init)) as { text: string[] };
        const results = body.text.map((text) => findingsFor(text));
        return Promise.resolve(
          new Response(JSON.stringify(results), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      },
    );
    (service as unknown as { http: typeof fetch }).http =
      fetchMock as typeof fetch;

    const source = `😀 电话 ${examples.phone}; 邮箱 ${examples.email}; 身份证 ${examples.id}; 卡 ${examples.card}; ${examples.credential}`;
    const result = await service.redactTextFields({
      markdown: source,
      blocks: [{ text: source, metadata: { note: examples.email } }],
    });

    expect(result.value.markdown).toBe(
      '😀 电话 [手机号]; 邮箱 [邮箱]; 身份证 [身份证号]; 卡 [银行卡号]; [凭据]',
    );
    expect(result.value.blocks[0].text).toBe(result.value.markdown);
    expect(result.value.blocks[0].metadata?.note).toBe('[邮箱]');
    expect(result.entityTypes).toEqual(
      expect.arrayContaining([
        'CN_MOBILE_PHONE',
        'CN_RESIDENT_ID',
        'CN_BANK_CARD',
        'CUSTOM_EMAIL',
        'CREDENTIAL',
      ]),
    );

    const request = JSON.parse(bodyText(fetchMock.mock.calls[0][1])) as {
      language: string;
      entities: string[];
      ad_hoc_recognizers: Array<{ supported_entity: string }>;
    };
    expect(request.language).toBe('en');
    expect(request.entities).toContain('CN_RESIDENT_ID');
    expect(request.ad_hoc_recognizers).toHaveLength(5);
  });

  it('keeps ID and bank-card candidates that fail checksum validation', async () => {
    const service = new DocumentPrivacyService();
    installAnalyzer(service);

    const source = `${examples.invalidId} ${examples.invalidCard}`;
    const result = await service.redactText(source);

    expect(result.text).toBe(source);
    expect(result.entityTypes).toEqual([]);
  });

  it('accepts a country-prefixed mobile number and lowercase ID check digit', async () => {
    const service = new DocumentPrivacyService();
    installAnalyzer(service);

    const result = await service.redactText(
      `${examples.prefixedPhone} ${examples.lowercaseId}`,
    );

    expect(result.text).toBe('[手机号] [身份证号]');
    expect(result.entityTypes).toEqual(
      expect.arrayContaining(['CN_MOBILE_PHONE', 'CN_RESIDENT_ID']),
    );
  });

  it('fails closed if the local Analyzer is unavailable', async () => {
    const service = new DocumentPrivacyService();
    (service as unknown as { http: typeof fetch }).http = jest.fn(() =>
      Promise.resolve(new Response('unavailable', { status: 503 })),
    ) as typeof fetch;

    await expect(service.redactText(examples.phone)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('rejects non-loopback Analyzer endpoints before sending document text', async () => {
    const original = process.env.PII_ANALYZER_URL;
    process.env.PII_ANALYZER_URL = 'https://example.com';
    const service = new DocumentPrivacyService();
    const fetchMock = jest.fn();
    (service as unknown as { http: typeof fetch }).http =
      fetchMock as typeof fetch;

    try {
      await expect(service.redactText(examples.phone)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      if (original === undefined) delete process.env.PII_ANALYZER_URL;
      else process.env.PII_ANALYZER_URL = original;
    }
  });
});

function installAnalyzer(service: DocumentPrivacyService): void {
  (service as unknown as { http: typeof fetch }).http = jest.fn(
    (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(bodyText(init)) as { text: string[] };
      return Promise.resolve(
        new Response(
          JSON.stringify(body.text.map((text) => findingsFor(text))),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    },
  ) as typeof fetch;
}

function bodyText(init?: RequestInit): string {
  if (typeof init?.body !== 'string') {
    throw new Error('Analyzer request did not contain a JSON body.');
  }
  return init.body;
}

function findingsFor(text: string) {
  const candidates: Array<[string, string]> = [
    [examples.phone, 'CN_MOBILE_PHONE'],
    [examples.prefixedPhone, 'CN_MOBILE_PHONE'],
    [examples.id, 'CN_RESIDENT_ID'],
    [examples.lowercaseId, 'CN_RESIDENT_ID'],
    [examples.invalidId, 'CN_RESIDENT_ID'],
    [examples.card, 'CN_BANK_CARD'],
    [examples.invalidCard, 'CN_BANK_CARD'],
    [examples.email, 'CUSTOM_EMAIL'],
    [examples.credential, 'CREDENTIAL'],
  ];
  const codePoints = Array.from(text);
  const results: Array<{ start: number; end: number; entity_type: string }> =
    [];
  for (const [candidate, entity_type] of candidates) {
    const startCodeUnit = text.indexOf(candidate);
    if (startCodeUnit < 0) continue;
    const start = Array.from(text.slice(0, startCodeUnit)).length;
    results.push({
      start,
      end: start + Array.from(candidate).length,
      entity_type,
    });
  }
  expect(codePoints.join('')).toBe(text);
  return results;
}
