import type { Request, Response } from 'express';

/**
 * RAG 管理后台 Mock 数据
 * 开发阶段无需启动 admin-backend 即可使用前端
 */

const adminPermissions = [
  'admin:system:read',
  'admin:documents:read',
  'admin:documents:write',
  'admin:audit:read',
  'admin:role:create',
  'admin:role:read',
  'admin:role:update',
  'admin:role:delete',
  'admin:permission:create',
  'admin:permission:read',
  'admin:permission:update',
  'admin:permission:delete',
  'admin:search-ops:read',
  'admin:qa-ops:read',
  'admin:graph-ops:read',
  'admin:rag:read',
  'admin:rag:write',
  'admin:notifications:read',
  'admin:notifications:write',
  'admin:account-security:read',
];

const userPermissions = [
  'admin:documents:read',
  'admin:search-ops:read',
  'admin:qa-ops:read',
  'admin:graph-ops:read',
  'admin:notifications:read',
];

const users: any[] = [
  {
    id: '1',
    username: 'admin',
    email: 'admin@example.com',
    phone: '13800138000',
    status: 'active',
    roles: [{ id: '1', name: 'admin' }],
    permissions: adminPermissions,
    createdAt: '2026-01-01T00:00:00Z',
    lastLoginAt: '2026-06-24T10:00:00Z',
  },
  {
    id: '2',
    username: 'user',
    email: 'user@example.com',
    phone: '13800138001',
    status: 'active',
    roles: [{ id: '2', name: 'user' }],
    permissions: userPermissions,
    createdAt: '2026-03-01T00:00:00Z',
    lastLoginAt: '2026-06-23T15:00:00Z',
  },
];

const roles = [
  { id: '1', name: 'admin', description: '管理员', permissions: [], userCount: 1, createdAt: '2026-01-01T00:00:00Z' },
  { id: '2', name: 'user', description: '普通用户', permissions: [], userCount: 1, createdAt: '2026-01-01T00:00:00Z' },
];

const permissions = [
  { id: '1', code: 'admin:system:read', name: '系统读取', module: 'system', description: '查看系统管理' },
  { id: '2', code: 'admin:documents:read', name: '文档读取', module: 'documents', description: '查看文档' },
  { id: '3', code: 'admin:documents:write', name: '文档写入', module: 'documents', description: '上传/删除文档' },
  { id: '4', code: 'admin:search-ops:read', name: '搜索运营', module: 'search-ops', description: '查看搜索运营数据' },
  { id: '5', code: 'admin:qa-ops:read', name: '问答运营', module: 'qa-ops', description: '查看问答运营数据' },
  { id: '6', code: 'admin:graph-ops:read', name: '图谱运营', module: 'graph-ops', description: '查看图谱运营数据' },
  { id: '7', code: 'admin:audit:read', name: '审计日志', module: 'audit', description: '查看审计日志' },
  { id: '8', code: 'admin:notifications:read', name: '通知读取', module: 'notifications', description: '查看通知' },
  { id: '9', code: 'admin:notifications:write', name: '通知写入', module: 'notifications', description: '管理通知' },
  { id: '10', code: 'admin:role:*', name: '角色管理', module: 'roles', description: '角色全权限' },
  { id: '11', code: 'admin:permission:*', name: '权限管理', module: 'permissions', description: '权限全权限' },
];

const documents = Array.from({ length: 25 }, (_, i) => ({
  id: `doc-${i + 1}`,
  filename: [`RAG技术白皮书.pdf`, `产品需求文档.docx`, `架构设计.md`, `接口说明.txt`, `用户手册.pdf`][i % 5],
  fileType: ['pdf', 'docx', 'md', 'txt', 'pdf'][i % 5],
  fileSize: Math.floor(Math.random() * 5000000) + 10000,
  status: ['completed', 'processing', 'pending', 'failed'][i % 4],
  chunkCount: Math.floor(Math.random() * 200) + 10,
  uploadedBy: ['admin', 'user'][i % 2],
  createdAt: new Date(Date.now() - i * 86400000).toISOString(),
  updatedAt: new Date(Date.now() - i * 43200000).toISOString(),
}));

const searchRecords = Array.from({ length: 30 }, (_, i) => ({
  id: `search-${i + 1}`,
  query: ['如何优化RAG检索效果', '向量数据库选型', '文档切分策略', 'Embedding模型对比', '混合检索方案'][i % 5],
  mode: ['simple', 'agentic', 'auto'][i % 3],
  hitCount: Math.floor(Math.random() * 20),
  responseTime: Math.floor(Math.random() * 3000) + 200,
  userId: ['admin', 'user'][i % 2],
  createdAt: new Date(Date.now() - i * 3600000).toISOString(),
}));

const qaRecords = Array.from({ length: 30 }, (_, i) => ({
  id: `qa-${i + 1}`,
  question: ['RAG和微调有什么区别？', '如何提高检索准确率？', '什么是混合检索？', '文档分块的最佳大小是多少？', '如何评估RAG系统效果？'][i % 5],
  answer: '这是模拟的回答内容，用于展示问答运营页面的数据效果。实际数据需要从后端获取。',
  mode: ['simple', 'agentic', 'auto'][i % 3],
  confidence: 0.6 + Math.random() * 0.4,
  sourcesCount: Math.floor(Math.random() * 5) + 1,
  userId: ['admin', 'user'][i % 2],
  createdAt: new Date(Date.now() - i * 3600000).toISOString(),
  feedback: [null, 'positive', 'negative'][i % 3],
}));

const notifications = Array.from({ length: 10 }, (_, i) => ({
  id: `notif-${i + 1}`,
  title: ['系统维护通知', '文档处理完成', '搜索异常告警', '新用户注册', '权限变更通知'][i % 5],
  content: '这是一条模拟通知内容，用于展示通知中心页面的数据效果。',
  type: ['system', 'info', 'alert', 'info', 'system'][i % 5],
  read: i > 3,
  createdAt: new Date(Date.now() - i * 7200000).toISOString(),
}));

const auditLogs = Array.from({ length: 20 }, (_, i) => ({
  id: `log-${i + 1}`,
  userId: ['1', '2'][i % 2],
  username: ['admin', 'user'][i % 2],
  action: ['login', 'create', 'update', 'delete', 'export'][i % 5],
  resource: ['documents', 'users', 'roles', 'config', 'permissions'][i % 5],
  detail: `${['admin', 'user'][i % 2]} 执行了 ${['登录', '创建', '更新', '删除', '导出'][i % 5]} 操作`,
  ip: `192.168.1.${100 + i}`,
  createdAt: new Date(Date.now() - i * 1800000).toISOString(),
}));

const graphNodes = Array.from({ length: 20 }, (_, i) => ({
  id: `node-${i + 1}`,
  label: [`知识图谱`, `RAG系统`, `向量数据库`, `文档管理`, `检索引擎`][i % 5],
  type: ['Concept', 'System', 'Database', 'Module', 'Service'][i % 5],
  properties: { description: `节点${i + 1}的描述`, importance: Math.floor(Math.random() * 10) },
}));

let currentToken = '';

export default {
  // ========== 认证 ==========
  'POST /api/auth/login': (req: Request, res: Response) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'Admin@123') {
      currentToken = 'mock-access-token-admin';
      res.send({
        access_token: currentToken,
        refresh_token: 'mock-refresh-token',
        user: users[0],
      });
      return;
    }
    if (username === 'user' && password === 'User@123') {
      currentToken = 'mock-access-token-user';
      res.send({
        access_token: currentToken,
        refresh_token: 'mock-refresh-token',
        user: users[1],
      });
      return;
    }
    res.status(401).send({ message: '用户名或密码错误' });
  },

  'GET /api/users/me': (_req: Request, res: Response) => {
    if (currentToken.includes('admin')) {
      res.send({ data: users[0] });
    } else if (currentToken.includes('user')) {
      res.send({ data: users[1] });
    } else {
      res.status(401).send({ message: '未登录' });
    }
  },

  // ========== 大盘 ==========
  'GET /api/admin/dashboard/overview': (_req: Request, res: Response) => {
    res.send({
      data: {
        documentCount: 156,
        qaCount: 2847,
        searchCount: 9312,
        userCount: 23,
        todaySearchCount: 342,
        todayQaCount: 89,
        avgResponseTime: 1280,
        hitRate: 87.3,
      },
    });
  },

  // ========== 文档 ==========
  'GET /api/admin/documents': (req: Request, res: Response) => {
    const { status, fileType } = req.query;
    let filtered = [...documents];
    if (status) filtered = filtered.filter((d) => d.status === status);
    if (fileType) filtered = filtered.filter((d) => d.fileType === fileType);
    res.send({ data: filtered, total: filtered.length });
  },
  'DELETE /api/admin/documents/:id': (req: Request, res: Response) => {
    res.send({ success: true });
  },
  'POST /api/admin/documents/:id/reprocess': (req: Request, res: Response) => {
    res.send({ success: true });
  },
  'GET /api/admin/documents/:id': (req: Request, res: Response) => {
    const doc = documents.find((d) => d.id === req.params.id);
    if (!doc) {
      res.status(404).send({ message: '文档不存在' });
      return;
    }
    res.send({
      data: {
        ...doc,
        metadata: {
          title: doc.filename.replace(/\.\w+$/, ''),
          author: ['张三', '李四', '王五'][Math.floor(Math.random() * 3)],
          summary: `这是${doc.filename}的摘要信息，包含文档的核心内容概述。`,
          keywords: ['RAG', '检索增强', '知识库', '向量数据库'].slice(0, 2 + Math.floor(Math.random() * 3)),
          language: 'zh-CN',
          category: ['技术文档', '产品文档', '设计文档'][Math.floor(Math.random() * 3)],
        },
      },
    });
  },
  'GET /api/admin/documents/:id/chunks': (req: Request, res: Response) => {
    const docId = req.params.id;
    const doc = documents.find((d) => d.id === docId);
    const chunkCount = doc?.chunkCount ?? 10;
    const chunks = Array.from({ length: Math.min(chunkCount, 50) }, (_, i) => ({
      id: `${docId}-chunk-${i + 1}`,
      index: i + 1,
      content: `这是第 ${i + 1} 个分块的内容。在实际场景中，这里会显示文档切分后的真实文本片段，包含上下文信息和语义完整的段落。分块策略基于 Markdown 标题层级和语义边界进行切分，确保每个分块具有独立的信息价值。`,
      headingPath: `第${Math.floor(i / 5) + 1}章/第${(i % 5) + 1}节`,
      tokenCount: Math.floor(Math.random() * 300) + 50,
      startOffset: i * 500,
      endOffset: (i + 1) * 500,
    }));
    res.send({ data: chunks, total: chunkCount });
  },

  // ========== 搜索运营 ==========
  'GET /api/admin/search-ops/records': (_req: Request, res: Response) => {
    res.send({ data: searchRecords, total: searchRecords.length });
  },
  'GET /api/admin/search-ops/stats': (_req: Request, res: Response) => {
    res.send({
      data: {
        totalSearches: 9312,
        avgResponseTime: 1280,
        avgHitCount: 8.5,
        zeroHitRate: 12.7,
      },
    });
  },

  // ========== 问答运营 ==========
  'GET /api/admin/qa-ops/records': (_req: Request, res: Response) => {
    res.send({ data: qaRecords, total: qaRecords.length });
  },
  'GET /api/admin/qa-ops/stats': (_req: Request, res: Response) => {
    res.send({
      data: {
        totalQa: 2847,
        avgConfidence: 0.82,
        positiveRate: 0.68,
        negativeRate: 0.08,
      },
    });
  },

  // ========== 图谱运营 ==========
  'GET /api/admin/graph-ops/stats': (_req: Request, res: Response) => {
    res.send({
      data: {
        nodeCount: 1245,
        edgeCount: 3892,
        entityTypes: [
          { type: 'Concept', count: 320 },
          { type: 'Person', count: 185 },
          { type: 'Organization', count: 142 },
          { type: 'Technology', count: 398 },
          { type: 'Document', count: 200 },
        ],
        relationTypes: [
          { type: 'RELATED_TO', count: 1200 },
          { type: 'BELONGS_TO', count: 890 },
          { type: 'AUTHORED_BY', count: 602 },
          { type: 'USES', count: 500 },
          { type: 'DERIVED_FROM', count: 700 },
        ],
      },
    });
  },
  'GET /api/admin/graph-ops/nodes': (_req: Request, res: Response) => {
    res.send({ data: graphNodes });
  },

  // ========== 用户管理 ==========
  'GET /api/admin/users': (_req: Request, res: Response) => {
    res.send({ data: users, total: users.length });
  },
  'POST /api/admin/users': (req: Request, res: Response) => {
    res.send({ data: { id: '3', ...req.body }, success: true });
  },
  'PATCH /api/admin/users/:id': (req: Request, res: Response) => {
    res.send({ success: true });
  },
  'DELETE /api/admin/users/:id': (req: Request, res: Response) => {
    res.send({ success: true });
  },
  'POST /api/admin/users/:id/reset-password': (req: Request, res: Response) => {
    res.send({ success: true });
  },

  // ========== 角色管理 ==========
  'GET /api/admin/roles': (_req: Request, res: Response) => {
    res.send({ data: roles, total: roles.length });
  },
  'POST /api/admin/roles': (req: Request, res: Response) => {
    res.send({ data: { id: '3', ...req.body }, success: true });
  },
  'PATCH /api/admin/roles/:id': (req: Request, res: Response) => {
    res.send({ success: true });
  },
  'DELETE /api/admin/roles/:id': (req: Request, res: Response) => {
    res.send({ success: true });
  },

  // ========== 权限管理 ==========
  'GET /api/admin/permissions': (_req: Request, res: Response) => {
    res.send({ data: permissions, total: permissions.length });
  },
  'POST /api/admin/permissions': (req: Request, res: Response) => {
    res.send({ data: { id: '12', ...req.body }, success: true });
  },
  'PATCH /api/admin/permissions/:id': (req: Request, res: Response) => {
    res.send({ success: true });
  },
  'DELETE /api/admin/permissions/:id': (req: Request, res: Response) => {
    res.send({ success: true });
  },

  // ========== 通知 ==========
  'GET /api/admin/notifications': (_req: Request, res: Response) => {
    res.send({ data: notifications, total: notifications.length });
  },
  'PATCH /api/admin/notifications/:id/read': (req: Request, res: Response) => {
    res.send({ success: true });
  },
  'PATCH /api/admin/notifications/read-all': (req: Request, res: Response) => {
    res.send({ success: true });
  },
  'DELETE /api/admin/notifications/:id': (req: Request, res: Response) => {
    res.send({ success: true });
  },

  // ========== 审计日志 ==========
  'GET /api/admin/audit-logs': (_req: Request, res: Response) => {
    res.send({ data: auditLogs, total: auditLogs.length });
  },

  // ========== 系统配置 ==========
  'GET /api/admin/config': (_req: Request, res: Response) => {
    res.send({
      data: [
        { key: 'RAG_CHUNK_SIZE', value: '512', description: '文档分块大小', group: 'rag', updatedAt: '2026-06-01T00:00:00Z' },
        { key: 'RAG_CHUNK_OVERLAP', value: '50', description: '分块重叠大小', group: 'rag', updatedAt: '2026-06-01T00:00:00Z' },
        { key: 'RAG_TOP_K', value: '5', description: '检索返回数量', group: 'rag', updatedAt: '2026-06-01T00:00:00Z' },
        { key: 'LLM_MODEL', value: 'qwen-plus', description: 'LLM 模型', group: 'llm', updatedAt: '2026-06-01T00:00:00Z' },
        { key: 'LLM_TEMPERATURE', value: '0.7', description: 'LLM 温度', group: 'llm', updatedAt: '2026-06-01T00:00:00Z' },
        { key: 'EMBEDDING_MODEL', value: 'text-embedding-v2', description: 'Embedding 模型', group: 'embedding', updatedAt: '2026-06-01T00:00:00Z' },
      ],
    });
  },
  'PATCH /api/admin/config/:key': (req: Request, res: Response) => {
    res.send({ success: true });
  },

  // ========== 账号安全 ==========
  'GET /api/admin/account/security': (_req: Request, res: Response) => {
    res.send({
      data: {
        lastPasswordChange: '2026-05-01',
        twoFactorEnabled: false,
        loginHistory: Array.from({ length: 8 }, (_, i) => ({
          ip: `192.168.1.${100 + i}`,
          device: ['Chrome/macOS', 'Safari/iOS', 'Chrome/Windows'][i % 3],
          time: new Date(Date.now() - i * 86400000).toISOString(),
          success: i !== 3,
        })),
      },
    });
  },
  'POST /api/admin/account/change-password': (req: Request, res: Response) => {
    res.send({ success: true });
  },
  'POST /api/admin/account/two-factor': (req: Request, res: Response) => {
    res.send({ success: true });
  },

  // ========== 菜单管理 ==========
  'GET /api/admin/menus/tree': (_req: Request, res: Response) => {
    res.send({
      data: [
        { id: '1', name: '首页大盘', path: '/dashboard', icon: 'dashboard', sort: 1, visible: true },
        { id: '2', name: '文档治理', path: '/documents', icon: 'fileText', sort: 2, visible: true },
        { id: '3', name: '搜索运营', path: '/search-ops', icon: 'search', sort: 3, visible: true },
        { id: '4', name: '问答运营', path: '/qa-ops', icon: 'comment', sort: 4, visible: true },
        { id: '5', name: '图谱运营', path: '/graph-ops', icon: 'apartment', sort: 5, visible: true },
        {
          id: '6', name: '系统管理', path: '/system', icon: 'setting', sort: 6, visible: true,
          children: [
            { id: '6-1', name: '用户管理', path: '/system/users', icon: '', sort: 1, visible: true, parentId: '6' },
            { id: '6-2', name: '角色管理', path: '/system/roles', icon: '', sort: 2, visible: true, parentId: '6' },
            { id: '6-3', name: '权限管理', path: '/system/permissions', icon: '', sort: 3, visible: true, parentId: '6' },
          ],
        },
      ],
    });
  },
  'POST /api/admin/menus': (req: Request, res: Response) => {
    res.send({ success: true });
  },
  'PATCH /api/admin/menus/:id': (req: Request, res: Response) => {
    res.send({ success: true });
  },
  'DELETE /api/admin/menus/:id': (req: Request, res: Response) => {
    res.send({ success: true });
  },
};
