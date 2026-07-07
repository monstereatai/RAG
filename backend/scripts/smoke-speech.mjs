const baseUrl = (process.env.SPEECH_SMOKE_BASE_URL ?? 'http://localhost:3000')
  .replace(/\/$/, '');
const text = process.env.SPEECH_SMOKE_TEXT ?? '你好，RAG 语音联调。';

const token = await login();
const audio = await synthesize();
const asrText = await transcribe(audio);
const ok = audio.length > 44 && asrText.trim().length > 0;

console.log(
  JSON.stringify(
    {
      ok,
      baseUrl,
      ttsBytes: audio.length,
      asrTextLength: asrText.length,
      asrContainsRag: /rag/i.test(asrText),
    },
    null,
    2,
  ),
);

if (!ok) {
  process.exitCode = 1;
}

async function login() {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: process.env.SPEECH_SMOKE_USERNAME ?? 'user',
      password: process.env.SPEECH_SMOKE_PASSWORD ?? 'user1234',
    }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`login failed: ${response.status}`);
  }
  return unwrap(body).accessToken;
}

async function synthesize() {
  const response = await fetch(
    `${baseUrl}/api/v1/speech/tts/stream?text=${encodeURIComponent(text)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    throw new Error(`tts failed: ${response.status}`);
  }
  const sse = await response.text();
  const chunks = [];
  for (const event of parseSse(sse)) {
    if (event.type === 'error') {
      throw new Error(`tts failed: ${event.data?.message ?? 'unknown error'}`);
    }
    if (event.type === 'chunk' && event.data?.chunk) {
      chunks.push(Buffer.from(event.data.chunk, 'base64'));
    }
  }
  return Buffer.concat(chunks);
}

async function transcribe(audioBuffer) {
  const form = new FormData();
  form.append(
    'audio',
    new Blob([audioBuffer], { type: 'audio/wav' }),
    'speech-smoke.wav',
  );

  const response = await fetch(`${baseUrl}/api/v1/speech/asr`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(
      `asr failed: ${response.status} ${JSON.stringify(redactBody(body))}`,
    );
  }
  return unwrap(body).text ?? '';
}

function redactBody(body) {
  if (!body || typeof body !== 'object') return body;
  const text = JSON.stringify(body);
  return JSON.parse(
    text.replace(/[A-Za-z0-9+/=]{80,}/g, '[redacted-long-value]'),
  );
}

function parseSse(text) {
  return text
    .split('\n\n')
    .map((block) => {
      const type = block
        .split('\n')
        .find((line) => line.startsWith('event:'))
        ?.slice('event:'.length)
        .trim();
      const dataText = block
        .split('\n')
        .find((line) => line.startsWith('data:'))
        ?.slice('data:'.length)
        .trim();
      if (!dataText) return null;
      try {
        const data = JSON.parse(dataText);
        if (type) {
          return { type, data };
        }
        if (data?.type && data?.data) {
          return { type: data.type, data: data.data };
        }
        return null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function unwrap(body) {
  return body && typeof body === 'object' && 'data' in body ? body.data : body;
}
