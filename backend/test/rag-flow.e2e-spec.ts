import request from 'supertest';

const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:3001';

interface ApiEnvelope<T> {
  code?: number;
  data?: T;
  message?: string;
}

interface LoginResponse {
  accessToken: string;
}

interface UploadResponse {
  docId: string;
  chunkCount: number;
}

interface ChatResponse {
  answer: string;
  route?: string;
}

function hasData<T>(body: ApiEnvelope<T> | T): body is ApiEnvelope<T> {
  return (
    body !== null &&
    typeof body === 'object' &&
    'data' in body &&
    body.data !== undefined
  );
}

function unwrap<T>(body: ApiEnvelope<T> | T): T {
  if (hasData(body)) {
    return body.data;
  }
  return body;
}

function responseData<T>(body: unknown): T {
  return unwrap<T>(body as ApiEnvelope<T> | T);
}

describe('RAG user flow (external e2e)', () => {
  jest.setTimeout(120_000);

  let token: string;
  let docId: string;

  afterAll(async () => {
    if (!token || !docId) return;

    await request(baseUrl)
      .delete(`/api/v1/documents/${docId}`)
      .set('Authorization', `Bearer ${token}`);
  });

  it('login -> upload -> ask -> switch mode -> debug -> voice -> delete', async () => {
    const login = await request(baseUrl)
      .post('/api/v1/auth/login')
      .send({ username: 'user', password: 'user1234' })
      .expect(201);

    token = responseData<LoginResponse>(login.body).accessToken;
    expect(token).toBeTruthy();

    await request(baseUrl)
      .get('/api/v1/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const upload = await request(baseUrl)
      .post('/api/v1/documents/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach(
        'file',
        Buffer.from(
          'RAG smoke document: retrieval augmented generation uses chunk retrieval, citation, and generation.',
        ),
        'rag-smoke.txt',
      )
      .expect(201);

    const uploadData = responseData<UploadResponse>(upload.body);
    docId = uploadData.docId;
    expect(docId).toBeTruthy();
    expect(uploadData.chunkCount).toBeGreaterThan(0);

    const simple = await request(baseUrl)
      .post('/api/v1/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: 'RAG smoke document 说了什么？', mode: 'simple' })
      .expect(201);
    expect(responseData<ChatResponse>(simple.body).answer).toBeTruthy();

    const auto = await request(baseUrl)
      .post('/api/v1/chat')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: '请总结并判断这份 RAG 文档的核心步骤', mode: 'auto' })
      .expect(201);
    expect(responseData<ChatResponse>(auto.body).answer).toBeTruthy();

    const debug = await request(baseUrl)
      .get('/api/v1/debug/chunks')
      .query({ query: 'RAG smoke document', k: 3 })
      .expect(200);
    expect(
      responseData<{ chunks: unknown[] }>(debug.body).chunks.length,
    ).toBeGreaterThan(0);

    const tts = await request(baseUrl)
      .get('/api/v1/speech/tts/stream')
      .set('Authorization', `Bearer ${token}`)
      .query({ text: 'RAG smoke test' })
      .expect(200);
    expect(tts.text).toContain('data:');

    await request(baseUrl)
      .delete(`/api/v1/documents/${docId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    docId = '';
  });
});
