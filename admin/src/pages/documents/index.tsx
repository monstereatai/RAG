import {
  AppstoreOutlined,
  DownloadOutlined,
  EyeOutlined,
  FilePdfOutlined,
  FilePptOutlined,
  FileWordOutlined,
  FileExcelOutlined,
  LockOutlined,
  HistoryOutlined,
  MoreOutlined,
  ReloadOutlined,
  SearchOutlined,
  TableOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { ModulePage, documentNav } from '@/components/AdminShell';
import { Button, Checkbox, Form, Input, Modal, Select, Skeleton, Space, Table, Tag, Tooltip, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React, { useEffect, useState } from 'react';
import {
  getDocuments,
  getOrganizations,
  getRoles,
  getUsers,
  updateDocumentPermissions,
  getDocumentVersions,
  createDocumentVersion,
  rollbackDocumentVersion,
  type DocumentItem,
  type DocumentVersionItem,
  type DocumentPermissionInput,
} from './service';

type PageState = 'loading' | 'data' | 'error' | 'empty';

/** 修复历史数据中 UTF-8 被按 Latin-1 解码后形成的常见中文乱码。 */
const repairMojibake = (value?: string | null): string => {
  if (!value) return '';
  if (!/[ÃÂâðåæçèéêëìíîïñòóôõö÷øùúûüýþÿ]/.test(value)) return value;
  try {
    const bytes = Uint8Array.from(value, (character) => character.charCodeAt(0) & 0xff);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return value;
  }
};

const iconMap: Record<string, React.ReactNode> = {
  pdf: <FilePdfOutlined className="file-icon pdf" />,
  docx: <FileWordOutlined className="file-icon word" />,
  xlsx: <FileExcelOutlined className="file-icon excel" />,
  pptx: <FilePptOutlined className="file-icon ppt" />,
};

const statusMap: Record<string, { color: string; text: string }> = {
  pending: { color: 'default', text: '待处理' },
  processing: { color: 'warning', text: '解析中' },
  completed: { color: 'success', text: '已入库' },
  failed: { color: 'error', text: '解析失败' },
};

const Documents: React.FC = () => {
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [pageState, setPageState] = useState<PageState>('loading');
  const [total, setTotal] = useState(0);
  const [permissionDoc, setPermissionDoc] = useState<DocumentItem | null>(null);
  const [permissionSaving, setPermissionSaving] = useState(false);
  const [versionDoc, setVersionDoc] = useState<DocumentItem | null>(null);
  const [versionItems, setVersionItems] = useState<DocumentVersionItem[]>([]);
  const [versionLoading, setVersionLoading] = useState(false);
  const [versionSaving, setVersionSaving] = useState(false);
  const [userOptions, setUserOptions] = useState<{ label: string; value: string }[]>([]);
  const [roleOptions, setRoleOptions] = useState<{ label: string; value: string }[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<
    { label: string; value: string }[]
  >([]);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20 });
  const [permissionForm] = Form.useForm<{ permissions: DocumentPermissionInput[] }>();
  const [versionForm] = Form.useForm<{
    content: string;
    filename?: string;
    docVersion?: string;
    effectiveAt?: string;
  }>();

  const fetchDocs = (nextPagination = pagination) => {
    setPageState('loading');
    Promise.all([
      getDocuments(nextPagination),
      getUsers(),
      getRoles(),
      getOrganizations(),
    ])
      .then(([docRes, userRes, roleRes, orgRes]: [any, any, any, any]) => {
        const raw = docRes?.data ?? docRes;
        const items = raw?.data?.items ?? (Array.isArray(raw) ? raw : []);
        const rawTotal = raw?.data?.total ?? raw?.total ?? (Array.isArray(items) ? items.length : 0);

        const userRaw = userRes?.data ?? userRes;
        const userList = normalizeList(userRaw);
        const userMap = new Map<string, string>();
        if (Array.isArray(userList)) {
          userList.forEach((u: any) => {
            userMap.set(String(u.id), u.username ?? u.nickname ?? String(u.id));
          });
        }
        setUserOptions(
          userList
            .filter((u: any) => u.id)
            .map((u: any) => ({
              label: u.username ?? u.nickname ?? String(u.id),
              value: String(u.id),
            })),
        );

        const roleRaw = roleRes?.data ?? roleRes;
        const roleList = normalizeList(roleRaw);
        setRoleOptions(
          roleList
            .filter((role: any) => role.id || role.code || role.name)
            .map((role: any) => ({
              label: role.name ?? role.code ?? String(role.id),
              value: String(role.id ?? role.code ?? role.name),
            })),
        );

        const orgRaw = orgRes?.data ?? orgRes;
        const departments = normalizeList(orgRaw?.departments ? orgRaw : orgRaw?.data);
        setDepartmentOptions(
          departments
            .filter((department: any) => department.id || department.name)
            .map((department: any) => ({
              label: department.name ?? String(department.id),
              value: String(department.id ?? department.name),
            })),
        );

        if (Array.isArray(items) && items.length > 0) {
          setDocs(
            items.map((item: any) => ({
              id: item.docId,
              filename: repairMojibake(item.filename),
              fileType: (repairMojibake(item.filename) ?? '').split('.').pop() ?? '',
              fileSize: 0,
              chunkCount: item.chunkCount ?? 0,
              uploadedBy: userMap.get(String(item.userId)) ?? item.userId ?? '',
              createdAt: item.createdAt,
              updatedAt: item.createdAt,
              metadata: { category: repairMojibake(item.category), title: repairMojibake(item.title) },
              docVersion: item.docVersion,
              lifecycleStatus: item.lifecycleStatus,
              supersedesDocId: item.supersedesDocId,
              effectiveAt: item.effectiveAt,
              expiredAt: item.expiredAt,
              obsidianPath: repairMojibake(item.obsidianPath),
              obsidianStatus: item.obsidianStatus,
            })),
          );
          setTotal(Number(rawTotal) || items.length);
          setPageState('data');
        } else {
          setPageState('empty');
        }
      })
      .catch((error) => {
        setPageState('error');
        message.error(error instanceof Error ? error.message : '文档列表加载失败，请重试');
      });
  };

  useEffect(() => {
    fetchDocs();
  }, []);

  const openPermissionModal = (record: DocumentItem) => {
    const category = record.metadata?.category;
    permissionForm.setFieldsValue({
      permissions: [
        category
          ? { subjectType: 'department', subjectId: category, scope: 'read' }
          : { subjectType: 'public', subjectId: '', scope: 'read' },
      ],
    });
    setPermissionDoc(record);
  };

  const handleSavePermissions = async () => {
    if (!permissionDoc) return;
    const values = await permissionForm.validateFields();
    setPermissionSaving(true);
    try {
      const permissions = (values.permissions ?? [])
        .map((item) => ({
          subjectType: item.subjectType,
          subjectId: item.subjectType === 'public' ? 'public' : item.subjectId?.trim(),
          scope: 'read' as const,
        }))
        .filter((item) => item.subjectType === 'public' || item.subjectId);
      await updateDocumentPermissions(permissionDoc.id, permissions);
      message.success('权限范围已保存');
      setPermissionDoc(null);
      fetchDocs();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '权限保存失败');
    } finally {
      setPermissionSaving(false);
    }
  };

  const openVersionModal = async (record: DocumentItem) => {
    setVersionDoc(record);
    setVersionLoading(true);
    versionForm.resetFields();
    versionForm.setFieldsValue({ filename: record.filename });
    try {
      const response = await getDocumentVersions(record.id);
      const raw = (response as any)?.data ?? response;
      setVersionItems(Array.isArray(raw) ? raw : raw?.data ?? []);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '版本链加载失败');
    } finally {
      setVersionLoading(false);
    }
  };

  const handleCreateVersion = async () => {
    if (!versionDoc) return;
    const values = await versionForm.validateFields();
    setVersionSaving(true);
    try {
      await createDocumentVersion(versionDoc.id, {
        ...values,
        lifecycleStatus: 'effective',
      });
      message.success('新版本已创建，旧版本已自动废弃');
      setVersionDoc(null);
      fetchDocs();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '新版本创建失败');
    } finally {
      setVersionSaving(false);
    }
  };

  const handleRollback = async (item: DocumentVersionItem) => {
    try {
      await rollbackDocumentVersion(item.docId);
      message.success(`已回滚到 ${item.docVersion}`);
      if (versionDoc) openVersionModal(versionDoc);
      fetchDocs();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '版本回滚失败');
    }
  };

  const columns: ColumnsType<DocumentItem> = [
    {
      title: <Checkbox />,
      width: 48,
      render: () => <Checkbox />,
    },
    {
      title: '文档名称',
      dataIndex: 'filename',
      render: (_, record) => (
        <Space size={12}>
          {iconMap[record.fileType] ?? iconMap.pdf}
          <span>{record.metadata?.title || record.filename}</span>
        </Space>
      ),
    },
    { title: '文件类型', dataIndex: 'fileType', width: 120, render: (value) => String(value).toUpperCase() },
    { title: '上传时间', dataIndex: 'createdAt', width: 190 },
    { title: '上传人', dataIndex: 'uploadedBy', width: 130 },
    {
      title: '文档解析状态',
      dataIndex: 'status',
      width: 150,
      render: (value, record) => {
        const status = value ?? (record.chunkCount > 0 ? 'completed' : 'pending');
        const item = statusMap[status] ?? statusMap.pending;
        return <Tag color={item.color}>{item.text}</Tag>;
      },
    },
    {
      title: '版本状态',
      width: 180,
      render: (_, record) => (
        <Space size={4}>
          <Tag color={record.lifecycleStatus === 'effective' ? 'green' : 'default'}>
            {record.docVersion || '未标注版本'}
          </Tag>
          <Tag>{record.lifecycleStatus || 'confirmed'}</Tag>
        </Space>
      ),
    },
    {
      title: '权限范围',
      width: 150,
      render: (_, record) => <Tag color="blue">{record.metadata?.category ?? '部门可见'}</Tag>,
    },
    {
      title: 'Obsidian',
      width: 150,
      render: (_, record) =>
        record.obsidianStatus === 'linked' ? (
          <Tooltip title={record.obsidianPath}>
            <Tag color="green">已关联</Tag>
          </Tooltip>
        ) : (
          <Tag>未关联</Tag>
        ),
    },
    {
      title: '操作',
      width: 150,
      render: (_, record) => (
        <Space size="middle">
          <EyeOutlined />
          <DownloadOutlined />
          <Button
            icon={<LockOutlined />}
            onClick={() => openPermissionModal(record)}
            size="small"
            type="text"
          />
          <Button
            icon={<HistoryOutlined />}
            onClick={() => openVersionModal(record)}
            size="small"
            title="版本治理"
            type="text"
          />
          <MoreOutlined />
        </Space>
      ),
    },
  ];

  return (
    <ModulePage activeKey="mine" navItems={documentNav} title="文档管理">
      <div className="rag-panel document-toolbar">
        <Input prefix={<SearchOutlined />} placeholder="搜索文档名称、内容、上传人等" />
        <Button icon={<UploadOutlined />} type="primary">批量上传</Button>
        <Button>新建文件夹</Button>
        <Select defaultValue="文件类型" options={[{ value: '文件类型' }]} />
        <Select defaultValue="解析状态" options={[{ value: '解析状态' }]} />
        <Select defaultValue="权限范围" options={[{ value: '权限范围' }]} />
        <Button>更多筛选</Button>
        <Button icon={<ReloadOutlined />} onClick={() => fetchDocs()} type="text" />
      </div>
      <div className="view-switch">
        <Button icon={<TableOutlined />} type="primary" />
        <Button icon={<AppstoreOutlined />} />
      </div>
      <div className="rag-panel document-table">
        {pageState === 'loading' && (
          <Skeleton active paragraph={{ rows: 8 }} />
        )}
        {pageState === 'error' && (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <h3>加载失败</h3>
            <p style={{ color: '#999', margin: '12px 0 24px' }}>
              无法获取文档列表，请确认服务正常运行。
            </p>
            <Button icon={<ReloadOutlined />} onClick={() => fetchDocs()} type="primary">
              重新加载
            </Button>
          </div>
        )}
        {pageState === 'empty' && (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <h3>暂无文档</h3>
            <p style={{ color: '#999', margin: '12px 0' }}>
              知识库还没有文档，请上传文档开始使用。
            </p>
            <Button icon={<UploadOutlined />} type="primary">上传文档</Button>
          </div>
        )}
        {pageState === 'data' && (
          <Table
            columns={columns}
            dataSource={docs}
            pagination={{
              current: pagination.current,
              pageSize: pagination.pageSize,
              total,
              showSizeChanger: true,
              pageSizeOptions: [10, 20, 50],
              onChange: (current, pageSize) => {
                const nextPagination = { current, pageSize };
                setPagination(nextPagination);
                fetchDocs(nextPagination);
              },
            }}
            rowKey="id"
          />
        )}
      </div>
      <Modal
        confirmLoading={permissionSaving}
        destroyOnClose
        onCancel={() => setPermissionDoc(null)}
        onOk={handleSavePermissions}
        open={!!permissionDoc}
        title="配置文档权限"
        width={620}
      >
        <p className="permission-doc-title">{permissionDoc?.filename}</p>
        <Form
          form={permissionForm}
          layout="vertical"
          preserve={false}
        >
          <Form.List name="permissions">
            {(fields, { add, remove }) => (
              <div className="document-permission-list">
                {fields.map((field) => (
                  <Space align="baseline" key={field.key}>
                    <Form.Item
                      {...field}
                      name={[field.name, 'subjectType']}
                      rules={[{ required: true, message: '请选择主体类型' }]}
                    >
                      <Select
                        options={[
                          { label: '用户', value: 'user' },
                          { label: '角色', value: 'role' },
                          { label: '部门', value: 'department' },
                          { label: '公开', value: 'public' },
                        ]}
                        style={{ width: 116 }}
                      />
                    </Form.Item>
                    <Form.Item
                      noStyle
                      shouldUpdate={(prev, next) =>
                        prev.permissions?.[field.name]?.subjectType !==
                        next.permissions?.[field.name]?.subjectType
                      }
                    >
                      {({ getFieldValue }) => {
                        const type = getFieldValue(['permissions', field.name, 'subjectType']);
                        const options =
                          type === 'user'
                            ? userOptions
                            : type === 'role'
                              ? roleOptions
                              : type === 'department'
                                ? departmentOptions
                                : [];
                        return (
                          <Form.Item
                            {...field}
                            name={[field.name, 'subjectId']}
                            rules={[
                              {
                                required: type !== 'public',
                                message: '请输入主体 ID',
                              },
                            ]}
                          >
                            {type === 'user' || type === 'role' || type === 'department' ? (
                              <Select
                                disabled={type === 'public'}
                                optionFilterProp="label"
                                options={options}
                                placeholder={
                                  type === 'user'
                                    ? '选择用户'
                                    : type === 'role'
                                      ? '选择角色'
                                      : '选择部门'
                                }
                                showSearch
                                style={{ width: 280 }}
                              />
                            ) : (
                              <Input
                                disabled={type === 'public'}
                                placeholder={
                                  type === 'public' ? '全部用户可读' : '输入部门 ID'
                                }
                                style={{ width: 280 }}
                              />
                            )}
                          </Form.Item>
                        );
                      }}
                    </Form.Item>
                    <Button onClick={() => remove(field.name)} type="link">
                      删除
                    </Button>
                  </Space>
                ))}
                <Button onClick={() => add({ subjectType: 'user', scope: 'read' })}>
                  添加权限主体
                </Button>
              </div>
            )}
          </Form.List>
        </Form>
      </Modal>
      <Modal
        destroyOnClose
        onCancel={() => setVersionDoc(null)}
        onOk={handleCreateVersion}
        confirmLoading={versionSaving}
        open={!!versionDoc}
        title="版本治理"
        width={820}
      >
        <p>当前文档：{versionDoc?.filename}</p>
        <Table
          loading={versionLoading}
          size="small"
          pagination={false}
          rowKey="docId"
          dataSource={versionItems}
          columns={[
            { title: '版本', dataIndex: 'docVersion' },
            { title: '状态', dataIndex: 'lifecycleStatus' },
            { title: '生效时间', dataIndex: 'effectiveAt' },
            { title: '创建时间', dataIndex: 'createdAt' },
            {
              title: '操作',
              render: (_: unknown, item: DocumentVersionItem) => (
                <Button
                  disabled={item.lifecycleStatus === 'effective'}
                  onClick={() => handleRollback(item)}
                  size="small"
                >
                  回滚到此版本
                </Button>
              ),
            },
          ] as ColumnsType<DocumentVersionItem>}
        />
        <Form form={versionForm} layout="vertical" style={{ marginTop: 20 }}>
          <Form.Item label="新版本号" name="docVersion" rules={[{ required: true, message: '请输入版本号' }]}>
            <Input placeholder="例如 v2.0" />
          </Form.Item>
          <Form.Item label="新文件名" name="filename">
            <Input />
          </Form.Item>
          <Form.Item label="生效时间" name="effectiveAt">
            <Input placeholder="例如 2026-08-12" />
          </Form.Item>
          <Form.Item label="新规范正文" name="content" rules={[{ required: true, message: '请输入新规范正文' }]}>
            <Input.TextArea rows={8} placeholder="粘贴最新规范内容。提交后会重新切块、向量化并建立新版本索引。" />
          </Form.Item>
        </Form>
      </Modal>
    </ModulePage>
  );
};

function normalizeList(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.departments)) return raw.departments;
  if (Array.isArray(raw?.items)) return raw.items;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.data?.items)) return raw.data.items;
  if (Array.isArray(raw?.list)) return raw.list;
  return [];
}

export default Documents;
