import {
  DeleteOutlined,
  HistoryOutlined,
  PlusOutlined,
  RollbackOutlined,
  SaveOutlined,
  SearchOutlined,
  SendOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Empty,
  Form,
  Input,
  List,
  Modal,
  message,
  Popconfirm,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  compareTeamWikiRevisions,
  createTeamWikiPage,
  deleteTeamWikiPage,
  getTeamWikiPage,
  getTeamWikiPages,
  getTeamWikiRevisions,
  publishTeamWikiPage,
  rollbackTeamWikiPage,
  type TeamWikiDiff,
  type TeamWikiPage,
  type TeamWikiReference,
  type TeamWikiRevision,
  updateTeamWikiPage,
} from './service';

const { Text } = Typography;
const unwrap = <T,>(value: any): T => value?.data?.data ?? value?.data ?? value;

const TeamWiki: React.FC = () => {
  const [pages, setPages] = useState<TeamWikiPage[]>([]);
  const [selected, setSelected] = useState<TeamWikiPage | null>(null);
  const [draft, setDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [revisions, setRevisions] = useState<TeamWikiRevision[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [diff, setDiff] = useState<TeamWikiDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [fromRevisionId, setFromRevisionId] = useState<string>();
  const [toRevisionId, setToRevisionId] = useState<string>();
  const [form] = Form.useForm();

  const fetchPages = useCallback(
    async (query = search) => {
      const response = await getTeamWikiPages({
        q: query || undefined,
        limit: 200,
      });
      const result = unwrap<TeamWikiPage[]>(response) ?? [];
      setPages(Array.isArray(result) ? result : []);
      return Array.isArray(result) ? result : [];
    },
    [search],
  );

  const openPage = useCallback(
    async (pageId: string) => {
      setBusy(true);
      try {
        const page = unwrap<TeamWikiPage>(await getTeamWikiPage(pageId));
        setSelected(page);
        setDraft(false);
        form.setFieldsValue({
          title: page.title,
          content: page.content,
          changeSummary: '',
          references: page.references?.length ? page.references : [],
        });
      } catch (error) {
        message.error(
          error instanceof Error ? error.message : '读取 Wiki 页面失败',
        );
      } finally {
        setBusy(false);
      }
    },
    [form],
  );

  useEffect(() => {
    void fetchPages()
      .then((items) => {
        if (items.length > 0) void openPage(items[0].id);
      })
      .catch((error) =>
        message.error(
          error instanceof Error ? error.message : '加载 Wiki 失败',
        ),
      );
  }, []);

  const beginCreate = () => {
    setSelected(null);
    setDraft(true);
    form.setFieldsValue({
      title: '',
      content: '',
      changeSummary: '',
      references: [],
    });
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    const references = (values.references ?? []).filter(
      (reference: TeamWikiReference) => reference?.docId || reference?.label,
    );
    setBusy(true);
    try {
      const body = {
        title: values.title,
        content: values.content,
        references,
        changeSummary: values.changeSummary,
      };
      if (draft || !selected) {
        const page = unwrap<TeamWikiPage>(await createTeamWikiPage(body));
        message.success('Wiki 页面已创建');
        await fetchPages();
        await openPage(page.id);
      } else {
        const page = unwrap<TeamWikiPage>(
          await updateTeamWikiPage(selected.id, {
            ...body,
            expectedRevisionNumber: selected.revisionNumber,
          }),
        );
        message.success('新版本已保存');
        await fetchPages();
        setSelected(page);
        setDraft(false);
        form.setFieldsValue({ ...page, changeSummary: '' });
      }
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : '保存 Wiki 页面失败',
      );
    } finally {
      setBusy(false);
    }
  };

  const handlePublish = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const result = unwrap<Awaited<ReturnType<typeof publishTeamWikiPage>>>(
        await publishTeamWikiPage(selected.id),
      );
      const publishResult = (result as any)?.data ?? result;
      message.success(
        publishResult.lifecycleStatus === 'effective'
          ? `已发布并进入知识库，文档 ID：${publishResult.documentId}`
          : `已提交入库，当前状态：${publishResult.lifecycleStatus}（如启用审批门禁，需审核后检索）`,
      );
      await fetchPages();
      await openPage(selected.id);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '发布失败');
    } finally {
      setBusy(false);
    }
  };

  const openHistory = async () => {
    if (!selected) return;
    setHistoryOpen(true);
    setDiff(null);
    try {
      const result =
        unwrap<TeamWikiRevision[]>(await getTeamWikiRevisions(selected.id)) ??
        [];
      const items = Array.isArray(result) ? result : [];
      setRevisions(items);
      if (items.length > 1) {
        setFromRevisionId(items[1].id);
        setToRevisionId(items[0].id);
      }
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : '读取版本历史失败',
      );
    }
  };

  const handleCompare = async () => {
    if (!selected || !fromRevisionId || !toRevisionId) return;
    setDiffLoading(true);
    try {
      const result = unwrap<TeamWikiDiff>(
        await compareTeamWikiRevisions(
          selected.id,
          fromRevisionId,
          toRevisionId,
        ),
      );
      setDiff((result as any)?.data ?? result);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '版本对比失败');
    } finally {
      setDiffLoading(false);
    }
  };

  const handleRollback = async (revision: TeamWikiRevision) => {
    if (!selected) return;
    setBusy(true);
    try {
      const page = unwrap<TeamWikiPage>(
        await rollbackTeamWikiPage(
          selected.id,
          revision.id,
          selected.revisionNumber,
        ),
      );
      message.success(
        `已基于版本 ${revision.revisionNumber} 创建新版本 ${page.revisionNumber}`,
      );
      setHistoryOpen(false);
      await fetchPages();
      await openPage(selected.id);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '回滚失败');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await deleteTeamWikiPage(selected.id);
      message.success('Wiki 页面已归档');
      setSelected(null);
      setDraft(false);
      setRevisions([]);
      form.resetFields();
      const next = await fetchPages();
      if (next[0]) await openPage(next[0].id);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '归档失败');
    } finally {
      setBusy(false);
    }
  };

  const referenceCount = Form.useWatch('references', form)?.length ?? 0;
  const revisionOptions = useMemo(
    () =>
      revisions.map((revision) => ({
        value: revision.id,
        label: `版本 ${revision.revisionNumber} · ${revision.title} · ${new Date(revision.createdAt).toLocaleString()}`,
      })),
    [revisions],
  );
  const diffRows = useMemo(() => {
    const occurrences = new Map<string, number>();
    return (diff?.changes ?? []).map((change) => {
      const signature = `${change.type}:${change.value}`;
      const occurrence = occurrences.get(signature) ?? 0;
      occurrences.set(signature, occurrence + 1);
      return { ...change, key: `${signature}:${occurrence}` };
    });
  }, [diff]);

  return (
    <div style={{ padding: 24 }}>
      <Row gutter={16} align="top">
        <Col xs={24} lg={7}>
          <Card
            title="团队知识库"
            extra={
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={beginCreate}
              >
                新建页面
              </Button>
            }
          >
            <Input.Search
              allowClear
              placeholder="搜索标题和正文"
              enterButton={<SearchOutlined />}
              onSearch={(value) => {
                setSearch(value);
                void fetchPages(value).catch((error) =>
                  message.error(
                    error instanceof Error ? error.message : '搜索失败',
                  ),
                );
              }}
            />
            <List
              style={{ marginTop: 16 }}
              dataSource={pages}
              locale={{ emptyText: <Empty description="还没有 Wiki 页面" /> }}
              renderItem={(page) => (
                <List.Item
                  onClick={() => void openPage(page.id)}
                  style={{
                    cursor: 'pointer',
                    background:
                      selected?.id === page.id ? '#f0f5ff' : undefined,
                    paddingInline: 10,
                  }}
                >
                  <List.Item.Meta
                    title={
                      <Space>
                        {page.title}
                        {page.status === 'published' ? (
                          <Tag color="green">已发布</Tag>
                        ) : page.status === 'pending_review' ? (
                          <Tag color="gold">待审核</Tag>
                        ) : (
                          <Tag>草稿</Tag>
                        )}
                      </Space>
                    }
                    description={
                      <>
                        <Text type="secondary">v{page.revisionNumber}</Text>
                        <br />
                        <Text type="secondary" ellipsis>
                          {page.excerpt}
                        </Text>
                      </>
                    }
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>
        <Col xs={24} lg={17}>
          <Card
            title={
              draft ? '新建 Wiki 页面' : (selected?.title ?? '选择一个页面')
            }
            extra={
              selected && !draft ? (
                <Space wrap>
                  <Button
                    icon={<HistoryOutlined />}
                    onClick={() => void openHistory()}
                  >
                    版本历史
                  </Button>
                  <Popconfirm
                    title="归档此页面及其已发布内容？"
                    onConfirm={() => void handleDelete()}
                  >
                    <Button danger icon={<DeleteOutlined />}>
                      归档
                    </Button>
                  </Popconfirm>
                  <Button
                    icon={<SendOutlined />}
                    onClick={() => void handlePublish()}
                    disabled={busy}
                  >
                    发布到知识库
                  </Button>
                  <Button
                    type="primary"
                    icon={<SaveOutlined />}
                    onClick={() => void handleSave()}
                    loading={busy}
                  >
                    保存新版本
                  </Button>
                </Space>
              ) : draft ? (
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  onClick={() => void handleSave()}
                  loading={busy}
                >
                  创建页面
                </Button>
              ) : null
            }
          >
            {selected || draft ? (
              <Spin spinning={busy}>
                {selected && !draft && selected.publishError ? (
                  <Alert
                    type="error"
                    showIcon
                    message="最近发布失败"
                    description={selected.publishError}
                    style={{ marginBottom: 16 }}
                  />
                ) : null}
                {selected && !draft && selected.status === 'published' ? (
                  <Alert
                    type="success"
                    showIcon
                    message="当前版本已发布到知识库"
                    description={`RAG 文档 ID：${selected.publishedDocumentId ?? '—'}`}
                    style={{ marginBottom: 16 }}
                  />
                ) : selected &&
                  !draft &&
                  selected.status === 'pending_review' ? (
                  <Alert
                    type="warning"
                    showIcon
                    message="已提交入库，等待审核后可被检索"
                    description={`RAG 文档 ID：${selected.publishedDocumentId ?? '—'}`}
                    style={{ marginBottom: 16 }}
                  />
                ) : null}
                <Form form={form} layout="vertical">
                  <Form.Item
                    name="title"
                    label="页面标题"
                    rules={[{ required: true, whitespace: true, max: 256 }]}
                  >
                    <Input placeholder="例如：项目开发约定" />
                  </Form.Item>
                  <Form.Item
                    name="content"
                    label="正文（Markdown）"
                    rules={[{ required: true, whitespace: true, max: 200000 }]}
                  >
                    <Input.TextArea
                      rows={18}
                      showCount
                      maxLength={200000}
                      placeholder="编写团队共享知识，支持 Markdown。"
                    />
                  </Form.Item>
                  <Form.Item label={`来源引用（${referenceCount}）`}>
                    <Form.List name="references">
                      {(fields, { add, remove }) => (
                        <Space direction="vertical" style={{ width: '100%' }}>
                          {fields.map(({ key, name, ...restField }) => (
                            <Row gutter={8} key={key} align="middle">
                              <Col flex="1">
                                <Form.Item
                                  {...restField}
                                  name={[name, 'docId']}
                                  rules={[
                                    {
                                      required: true,
                                      message: '请输入来源文档 ID',
                                    },
                                  ]}
                                >
                                  <Input placeholder="来源文档 ID" />
                                </Form.Item>
                              </Col>
                              <Col flex="1">
                                <Form.Item
                                  {...restField}
                                  name={[name, 'label']}
                                  rules={[
                                    {
                                      required: true,
                                      message: '请输入来源名称',
                                    },
                                  ]}
                                >
                                  <Input placeholder="来源名称" />
                                </Form.Item>
                              </Col>
                              <Col flex="2">
                                <Form.Item
                                  {...restField}
                                  name={[name, 'quote']}
                                >
                                  <Input placeholder="可选：摘录" />
                                </Form.Item>
                              </Col>
                              <Col>
                                <Button
                                  danger
                                  type="text"
                                  icon={<DeleteOutlined />}
                                  onClick={() => remove(name)}
                                />
                              </Col>
                            </Row>
                          ))}
                          <Button
                            onClick={() =>
                              add({ docId: '', label: '', quote: '' })
                            }
                            icon={<PlusOutlined />}
                            block
                          >
                            添加来源文档
                          </Button>
                          <Text type="secondary">
                            来源 ID
                            可从文档治理详情中复制；保存时会校验来源属于当前租户。
                          </Text>
                        </Space>
                      )}
                    </Form.List>
                  </Form.Item>
                  <Form.Item name="changeSummary" label="本次变更说明">
                    <Input
                      placeholder="可选，记录本次修改内容"
                      maxLength={512}
                    />
                  </Form.Item>
                  {selected ? (
                    <Descriptions
                      size="small"
                      column={2}
                      items={[
                        {
                          key: 'revision',
                          label: '当前版本',
                          children: `v${selected.revisionNumber}`,
                        },
                        {
                          key: 'publisher',
                          label: 'RAG 发布状态',
                          children:
                            selected.publishedLifecycleStatus ?? '未发布',
                        },
                        {
                          key: 'updated',
                          label: '最近更新',
                          children: new Date(
                            selected.updatedAt,
                          ).toLocaleString(),
                        },
                        {
                          key: 'references',
                          label: '引用数量',
                          children: selected.references?.length ?? 0,
                        },
                      ]}
                    />
                  ) : null}
                </Form>
              </Spin>
            ) : (
              <Empty description="从左侧选择页面，或新建页面" />
            )}
          </Card>
        </Col>
      </Row>

      <Modal
        title="版本历史与差异"
        open={historyOpen}
        onCancel={() => setHistoryOpen(false)}
        width={1000}
        footer={null}
        destroyOnHidden
      >
        <Row gutter={16}>
          <Col xs={24} md={9}>
            <List
              size="small"
              dataSource={revisions}
              renderItem={(revision) => (
                <List.Item
                  actions={[
                    <Popconfirm
                      key="rollback"
                      title={`基于版本 ${revision.revisionNumber} 创建新版本？`}
                      onConfirm={() => void handleRollback(revision)}
                    >
                      <Button size="small" icon={<RollbackOutlined />}>
                        回滚
                      </Button>
                    </Popconfirm>,
                  ]}
                >
                  <List.Item.Meta
                    title={`版本 ${revision.revisionNumber} · ${revision.title}`}
                    description={
                      <>
                        {revision.changeSummary || '未填写说明'}
                        <br />
                        {new Date(revision.createdAt).toLocaleString()} ·{' '}
                        {revision.publishStatus}
                      </>
                    }
                  />
                </List.Item>
              )}
            />
          </Col>
          <Col xs={24} md={15}>
            <Space wrap style={{ marginBottom: 12 }}>
              <Select
                value={fromRevisionId}
                onChange={setFromRevisionId}
                options={revisionOptions}
                placeholder="选择旧版本"
                style={{ minWidth: 230 }}
              />
              <Select
                value={toRevisionId}
                onChange={setToRevisionId}
                options={revisionOptions}
                placeholder="选择新版本"
                style={{ minWidth: 230 }}
              />
              <Button
                onClick={() => void handleCompare()}
                loading={diffLoading}
                disabled={!fromRevisionId || !toRevisionId}
              >
                对比
              </Button>
            </Space>
            <Divider />
            {diff ? (
              <div
                style={{
                  maxHeight: 500,
                  overflow: 'auto',
                  background: '#fafafa',
                  padding: 12,
                  fontFamily: 'monospace',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {diffRows.map((change) => (
                  <div
                    key={change.key}
                    style={{
                      color:
                        change.type === 'added'
                          ? '#389e0d'
                          : change.type === 'removed'
                            ? '#cf1322'
                            : undefined,
                      background:
                        change.type === 'added'
                          ? '#f6ffed'
                          : change.type === 'removed'
                            ? '#fff2f0'
                            : undefined,
                    }}
                  >
                    {change.type === 'added'
                      ? '+ '
                      : change.type === 'removed'
                        ? '- '
                        : '  '}
                    {change.value || ' '}
                  </div>
                ))}
              </div>
            ) : (
              <Empty description="选择两个版本并点击对比" />
            )}
          </Col>
        </Row>
      </Modal>
    </div>
  );
};

export default TeamWiki;
