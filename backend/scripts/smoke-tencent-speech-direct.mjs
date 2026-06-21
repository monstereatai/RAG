import 'dotenv/config';
import https from 'node:https';
import crypto from 'node:crypto';

const secretId = process.env.TENCENT_SECRET_ID ?? '';
const secretKey = process.env.TENCENT_SECRET_KEY ?? '';
const region = process.env.TENCENT_REGION ?? 'ap-shanghai';
const text = process.env.TENCENT_SPEECH_SMOKE_TEXT ?? '你好，RAG 语音联调。';

if (!secretId || !secretKey) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        skipped: true,
        reason: 'TENCENT_SECRET_ID or TENCENT_SECRET_KEY is empty',
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const tts = await callTencent('tts', 'TextToVoice', '2019-08-23', {
  Text: text,
  SessionId: crypto.randomUUID(),
  VoiceType: Number(process.env.TENCENT_SPEECH_SMOKE_VOICE_TYPE ?? '101001'),
  Codec: 'wav',
  SampleRate: 16000,
});

const audio = Buffer.from(tts.Audio ?? '', 'base64');
const asr = await callTencent('asr', 'SentenceRecognition', '2019-06-14', {
  EngSerViceType: '16k_zh',
  SourceType: 1,
  VoiceFormat: 'wav',
  ProjectId: 0,
  SubServiceType: 2,
  Data: audio.toString('base64'),
  DataLen: audio.length,
});

const result = asr.Result ?? '';
const ok = audio.length > 44 && result.trim().length > 0;
console.log(
  JSON.stringify(
    {
      ok,
      region,
      ttsBytes: audio.length,
      asrTextLength: result.length,
      asrContainsRag: /rag/i.test(result),
    },
    null,
    2,
  ),
);
if (!ok) {
  process.exitCode = 1;
}

function callTencent(service, action, version, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const { authorization, timestamp, host } = sign(
      service,
      action,
      version,
      body,
    );

    const request = https.request(
      {
        hostname: host,
        path: '/',
        method: 'POST',
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json',
          Host: host,
          'X-TC-Action': action,
          'X-TC-Version': version,
          'X-TC-Region': region,
          'X-TC-Timestamp': timestamp,
        },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const result = parsed.Response;
            if (result?.Error) {
              reject(
                new Error(`${result.Error.Code}: ${result.Error.Message}`),
              );
              return;
            }
            resolve(result);
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

function sign(service, action, version, body) {
  const host = `${service}.tencentcloudapi.com`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const date = new Date(Number(timestamp) * 1000).toISOString().split('T')[0];
  const hashedPayload = crypto.createHash('sha256').update(body).digest('hex');
  const canonicalRequest = [
    'POST',
    '/',
    '',
    `content-type:application/json\nhost:${host}\n`,
    'content-type;host',
    hashedPayload,
  ].join('\n');
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = [
    'TC3-HMAC-SHA256',
    timestamp,
    credentialScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const hmac = (key, value) =>
    crypto.createHmac('sha256', key).update(value).digest();
  const secretDate = hmac(`TC3${secretKey}`, date);
  const secretService = hmac(secretDate, service);
  const secretSigning = hmac(secretService, 'tc3_request');
  const signature = hmac(secretSigning, stringToSign).toString('hex');

  return {
    host,
    timestamp,
    authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=content-type;host, Signature=${signature}`,
  };
}
