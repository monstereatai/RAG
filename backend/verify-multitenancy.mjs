import { Buffer } from 'node:buffer';

const BACKEND_URL = 'http://localhost:3000/api';

async function test() {
  console.log('--- Starting Multi-Tenancy Isolation Verification ---');

  // 1. Login admin
  console.log('\n[1] Logging in as admin...');
  const resAdmin = await fetch(`${BACKEND_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  if (!resAdmin.ok) throw new Error('Admin login failed: ' + await resAdmin.text());
  const { data: adminTokenData } = await resAdmin.json();
  const adminToken = adminTokenData.accessToken;
  console.log('Admin token obtained successfully.');

  // 2. Login user
  console.log('\n[2] Logging in as user...');
  const resUser = await fetch(`${BACKEND_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'user', password: 'user1234' })
  });
  if (!resUser.ok) throw new Error('User login failed: ' + await resUser.text());
  const { data: userTokenData } = await resUser.json();
  const userToken = userTokenData.accessToken;
  console.log('User token obtained successfully.');

  // 3. Admin profile check
  const resAdminProfile = await fetch(`${BACKEND_URL}/auth/profile`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const adminProfile = await resAdminProfile.json();
  console.log('Admin Profile payload:', adminProfile);

  // 4. User profile check
  const resUserProfile = await fetch(`${BACKEND_URL}/auth/profile`, {
    headers: { 'Authorization': `Bearer ${userToken}` }
  });
  const userProfile = await resUserProfile.json();
  console.log('User Profile payload:', userProfile);

  // 5. Test Chat conversation isolation
  console.log('\n[3] Testing chat conversation isolation...');
  // Let's create a conversation for admin
  const resAdminChat = await fetch(`${BACKEND_URL}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({ query: 'Hello this is Admin thread', mode: 'simple' })
  });
  if (!resAdminChat.ok) throw new Error('Admin chat failed: ' + await resAdminChat.text());
  const adminChatData = await resAdminChat.json();
  const threadId = adminChatData.data.threadId;
  console.log(`Created admin thread: ${threadId}`);

  // Try to retrieve admin conversation with user's token (should fail or return not found)
  console.log('Trying to access admin conversation using user token...');
  const resUserGetAdminConv = await fetch(`${BACKEND_URL}/chat/conversations/${threadId}`, {
    headers: { 'Authorization': `Bearer ${userToken}` }
  });
  console.log('Status of accessing admin conversation with user token:', resUserGetAdminConv.status);
  if (resUserGetAdminConv.status === 200) {
    const data = await resUserGetAdminConv.json();
    console.error('Leaked conversation data:', data);
    throw new Error('Leak! User can access admin conversation.');
  } else {
    console.log('OK! User cannot access admin conversation (returned non-200 status).');
  }

  // List conversations for user, should not see admin thread
  console.log('Listing conversations for user...');
  const resUserListConv = await fetch(`${BACKEND_URL}/chat/conversations`, {
    headers: { 'Authorization': `Bearer ${userToken}` }
  });
  const userConvs = await resUserListConv.json();
  const foundAdminThread = userConvs.data.some(c => c.threadId === threadId);
  if (foundAdminThread) {
    throw new Error('Leak! Admin thread found in user conversation list.');
  }
  console.log('OK! User conversation list does not contain admin thread.');

  // List conversations for admin, should see admin thread
  console.log('Listing conversations for admin...');
  const resAdminListConv = await fetch(`${BACKEND_URL}/chat/conversations`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const adminConvs = await resAdminListConv.json();
  const foundInAdminList = adminConvs.data.some(c => c.threadId === threadId);
  if (!foundInAdminList) {
    throw new Error('Error! Admin conversation list does not contain the thread just created.');
  }
  console.log('OK! Admin conversation list correctly contains the thread.');

  // 6. Test Document isolation
  console.log('\n[4] Testing document isolation...');
  // Upload a document as admin
  const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
  const fileContent = 'The password to the secret vault is SUPER_SECRET_SECRET_SECRET.';
  const body = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="admin_secret.txt"',
    'Content-Type: text/plain',
    '',
    fileContent,
    `--${boundary}--`,
    ''
  ].join('\r\n');

  console.log('Uploading admin document...');
  const resUpload = await fetch(`${BACKEND_URL}/documents/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Authorization': `Bearer ${adminToken}`
    },
    body: Buffer.from(body, 'utf-8')
  });
  if (!resUpload.ok) throw new Error('Admin document upload failed: ' + await resUpload.text());
  const uploadData = await resUpload.json();
  const docId = uploadData.data.docId;
  console.log(`Uploaded document ID: ${docId}`);

  // List documents for user, should NOT see admin document
  console.log('Listing documents for user...');
  const resUserDocs = await fetch(`${BACKEND_URL}/documents`, {
    headers: { 'Authorization': `Bearer ${userToken}` }
  });
  const userDocs = await resUserDocs.json();
  const foundAdminDoc = userDocs.data.some(d => d.docId === docId);
  if (foundAdminDoc) {
    throw new Error('Leak! Admin document found in user documents list.');
  }
  console.log('OK! User document list does not contain admin document.');

  // Try to retrieve admin document with user token
  console.log('Retrieving admin document metadata with user token...');
  const resUserGetDoc = await fetch(`${BACKEND_URL}/documents/${docId}`, {
    headers: { 'Authorization': `Bearer ${userToken}` }
  });
  console.log('Status of retrieving doc with user token:', resUserGetDoc.status);
  if (resUserGetDoc.status === 200) {
    throw new Error('Leak! User can retrieve admin document metadata.');
  }
  console.log('OK! User cannot retrieve admin document metadata.');

  // Try to query as user for "SUPER_SECRET_SECRET_SECRET"
  console.log('Querying chat as user for the secret content...');
  const resUserChatSecret = await fetch(`${BACKEND_URL}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userToken}`
    },
    body: JSON.stringify({ query: 'What is the secret vault password?', mode: 'simple' })
  });
  const userChatSecretData = await resUserChatSecret.json();
  console.log('User RAG Answer:', userChatSecretData.data.answer);
  if (userChatSecretData.data.answer.includes('SUPER_SECRET') || userChatSecretData.data.references.length > 0) {
    throw new Error('Leak! User query retrieved admin document secret content or references!');
  }
  console.log('OK! User chat did not retrieve admin document content.');

  // Query as admin for "SUPER_SECRET_SECRET_SECRET"
  console.log('Querying chat as admin for the secret content...');
  const resAdminChatSecret = await fetch(`${BACKEND_URL}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    },
    body: JSON.stringify({ query: 'What is the secret vault password?', mode: 'simple' })
  });
  const adminChatSecretData = await resAdminChatSecret.json();
  console.log('Admin RAG Answer:', adminChatSecretData.data.answer);
  console.log('Admin references count:', adminChatSecretData.data.references.length);
  if (adminChatSecretData.data.references.length === 0) {
    throw new Error('Error! Admin query failed to retrieve references from its own document!');
  }
  console.log('OK! Admin query successfully retrieved its own document references.');

  // 7. Cleanup: Delete admin document
  console.log('\n[5] Cleaning up...');
  const resDelete = await fetch(`${BACKEND_URL}/documents/${docId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  console.log('Delete document status:', resDelete.status);

  // Clean up admin conversation
  const resDeleteConv = await fetch(`${BACKEND_URL}/chat/conversations/${threadId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  console.log('Delete conversation status:', resDeleteConv.status);

  console.log('\n=========================================');
  console.log('🏆 ALL MULTI-TENANCY ISOLATION TESTS PASSED SUCCESSFULLY!');
  console.log('=========================================');
}

test().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
