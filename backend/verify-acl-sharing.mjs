const BASE_URL = (process.env.RAG_BASE_URL ?? 'http://localhost:3000/api/v1').replace(/\/$/, '');
const SERVICE_TOKEN = process.env.RAG_SERVICE_TOKEN ?? 'local-rag-service-token';
const ADMIN_USERNAME = process.env.RAG_ACL_ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD = process.env.RAG_ACL_ADMIN_PASSWORD ?? 'admin123';
const USER_USERNAME = process.env.RAG_ACL_USER_USERNAME ?? 'user';
const USER_PASSWORD = process.env.RAG_ACL_USER_PASSWORD ?? 'user1234';

function unwrap(body) {
  return body && typeof body === 'object' && 'data' in body ? body.data : body;
}

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, options);
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { response, body };
}

async function login(username, password) {
  const { response, body } = await request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (response.ok === false) {
    throw new Error(`login failed for ${username}: ${response.status} ${JSON.stringify(body)}`);
  }
  const tokens = unwrap(body);
  const profile = await request('/auth/profile', {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });
  const identity = unwrap(profile.body);
  return { ...tokens, ...identity };
}

async function listAdminDocuments(adminToken) {
  const { response, body } = await request('/documents', {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (response.ok === false) {
    throw new Error(`admin document list failed: ${response.status}`);
  }
  return unwrap(body);
}

async function downloadDocument(docId) {
  const { response, body } = await request(
    `/rag/ops-api/documents/${docId}/download`,
    { headers: { 'X-Service-Token': SERVICE_TOKEN } },
  );
  if (response.ok === false) {
    throw new Error(`document download failed: ${response.status}`);
  }
  return String(unwrap(body).content ?? '');
}

function chooseQuery(content, docId) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8 && line.includes('ACL_SHARED') === false);
  return lines.length > 0 ? `${lines[0].slice(0, 100)} 是什么？` : `文档 ${docId} 的内容是什么？`;
}

async function setPermissions(docId, subjects) {
  const { response, body } = await request(
    `/rag/ops-api/documents/${docId}/permissions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Token': SERVICE_TOKEN,
      },
      body: JSON.stringify({ subjects }),
    },
  );
  if (response.ok === false) {
    throw new Error(`set permissions failed: ${response.status} ${JSON.stringify(body)}`);
  }
}

async function main() {
  const admin = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  const user = await login(USER_USERNAME, USER_PASSWORD);
  const owner = user;
  const grantee = admin;
  const configuredDocId = process.env.RAG_ACL_DOC_ID?.trim();
  let docId = configuredDocId;
  if (docId == null || docId.length === 0) {
    const docs = await listAdminDocuments(owner.accessToken);
    const candidate = (Array.isArray(docs) ? docs : []).find(
      (doc) =>
        doc.chunkCount > 0 &&
        doc.lifecycleStatus !== 'draft' &&
        doc.lifecycleStatus !== 'archived',
    );
    if (candidate == null) {
      throw new Error(
        'No indexed user document is available. Set RAG_ACL_DOC_ID to an existing indexed document.',
      );
    }
    docId = candidate.docId;
  }
  const content = await downloadDocument(docId);
  const query = chooseQuery(content, docId);

  try {
    await setPermissions(docId, []);
    const beforeGrant = await request(`/documents/${docId}`, {
      headers: { Authorization: `Bearer ${grantee.accessToken}` },
    });
    if (beforeGrant.response.ok) {
      throw new Error('document was already visible to the grantee before grant');
    }
    await setPermissions(docId, [{ type: 'user', id: grantee.userId }]);

    const detail = await request(`/documents/${docId}`, {
      headers: { Authorization: `Bearer ${grantee.accessToken}` },
    });
    if (detail.response.ok === false) {
      throw new Error(`shared document detail failed: ${detail.response.status}`);
    }

    const list = await request('/documents', {
      headers: { Authorization: `Bearer ${grantee.accessToken}` },
    });
    const docs = unwrap(list.body);
    if (
      Array.isArray(docs) === false ||
      docs.some((item) => item.docId === docId) === false
    ) {
      throw new Error('shared document is missing from the grantee document list');
    }

    const chat = await request('/chat', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${grantee.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, mode: 'simple' }),
    });
    if (chat.response.ok === false) {
      throw new Error(`shared document retrieval failed: ${chat.response.status}`);
    }
    const answer = unwrap(chat.body);
    const references = Array.isArray(answer.references) ? answer.references : [];
    if (references.some((item) => item.docId === docId) === false) {
      throw new Error(
        'shared document was not recalled by the RAG reference list: ' +
          JSON.stringify({
            query,
            referenceDocIds: references.map((item) => item.docId),
            answerPreview: String(answer.answer ?? '').slice(0, 160),
            retrievalSufficient: answer.retrievalSufficient,
            retrievalReason: answer.retrievalReason,
          }),
      );
    }

    await setPermissions(docId, []);
    const revoked = await request(`/documents/${docId}`, {
      headers: { Authorization: `Bearer ${grantee.accessToken}` },
    });
    if (revoked.response.ok) {
      throw new Error('ACL revocation did not hide the shared document');
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          docId,
          ownerUserId: owner.userId,
          granteeUserId: grantee.userId,
          checks: ['detail', 'list', 'retrieval', 'revocation'],
        },
        null,
        2,
      ),
    );
  } finally {
    await setPermissions(docId, []).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
