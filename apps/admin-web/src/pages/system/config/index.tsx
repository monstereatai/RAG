import {
  ProForm,
  ProFormSelect,
  ProFormSwitch,
  ProFormText,
} from '@ant-design/pro-components';
import { CopyOutlined, DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Form, Input, Modal, Space, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React, { useCallback, useEffect, useState } from 'react';
import { ModulePage, systemNav } from '@/components/AdminShell';
import { createApiToken, listApiTokens, revokeApiToken, type ApiTokenView } from './service';

const { Text, Paragraph } = Typography;

const SystemConfigPage: React.FC = () => {
  const [tokens, setTokens] = useState<ApiTokenView[]>([]);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createdToken, setCreatedToken] = useState<string>();
  const [form] = Form.useForm<{ name: string }>();

  const fetchTokens = useCallback(async () => {
    setTokenLoading(true);
    try {
      const res = await listApiTokens();
      const payload = (res as any)?.data?.data ?? (res as any)?.data ?? res;
      setTokens(Array.isArray(payload) ? payload : []);
    } catch {
      setTokens([]);
      message.error('长期 API Key 加载失败');
    } finally {
      setTokenLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  const columns: ColumnsType<ApiTokenView> = [
    { title: '名称', dataIndex: 'name' },
    { title: '前缀', dataIndex: 'prefix', render: (value) => <Text code>{value}</Text> },
    {
      title: 'Scope',
      dataIndex: 'scopes',
      render: (scopes?: string[]) => (
        <Space wrap>{(scopes || []).map((scope) => <Tag key={scope}>{scope}</Tag>)}</Space>
      ),
    },
    { title: '创建时间', dataIndex: 'createdAt' },
    { title: '最近使用', dataIndex: 'lastUsedAt', render: (value) => value || '-' },
    {
      title: '状态',
      dataIndex: 'revokedAt',
      render: (value) => value ? <Tag color="red">已吊销</Tag> : <Tag color="green">有效</Tag>,
    },
    {
      title: '操作',
      render: (_, record) => (
        <Button
          danger
          disabled={Boolean(record.revokedAt)}
          icon={<DeleteOutlined />}
          size="small"
          onClick={async () => {
            await revokeApiToken(record.id);
            message.success('已吊销');
            fetchTokens();
          }}
        >
          吊销
        </Button>
      ),
    },
  ];

  return (
    <ModulePage activeKey="config" navItems={systemNav} title="系统管理"><div className="rag-panel" style={{ padding: 24 }}>
      <Card title="基础配置">
        <ProForm
          submitter={{ searchConfig: { submitText: '保存' } }}
          onFinish={async () => {
            message.success('保存成功');
            return true;
          }}
        >
          <ProFormText
            name="siteName"
            label="站点名称"
            initialValue="RAG 管理后台"
          />
          <ProFormSelect
            name="defaultLanguage"
            label="默认语言"
            options={[
              { label: '中文', value: 'zh-CN' },
              { label: 'English', value: 'en-US' },
            ]}
            initialValue="zh-CN"
          />
          <ProFormSwitch name="enableRegistration" label="开放注册" />
          <ProFormSwitch name="enableNotification" label="启用通知" />
        </ProForm>
      </Card>
      <Card
        title="长期 MCP / API Key"
        style={{ marginTop: 24 }}
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={fetchTokens}>刷新</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>生成 Key</Button>
          </Space>
        }
      >
        <Alert
          showIcon
          type="info"
          message="用于 Codex / Trae / Claude Code / Cursor 等 MCP 客户端长期访问 RAG。明文只在生成后展示一次，服务端只保存 hash。"
          style={{ marginBottom: 16 }}
        />
        <Table<ApiTokenView>
          rowKey="id"
          columns={columns}
          dataSource={tokens}
          loading={tokenLoading}
          pagination={false}
        />
      </Card>
      <Modal
        title="生成长期 MCP / API Key"
        open={createOpen}
        okText="生成"
        onCancel={() => {
          setCreateOpen(false);
          setCreatedToken(undefined);
          form.resetFields();
        }}
        onOk={async () => {
          const values = await form.validateFields();
          const res = await createApiToken({ name: values.name, scopes: ['rag:*'] });
          const payload = (res as any)?.data?.data ?? (res as any)?.data ?? res;
          setCreatedToken(payload?.token);
          message.success('已生成，明文只展示一次');
          fetchTokens();
        }}
      >
        <Form form={form} layout="vertical" initialValues={{ name: 'codex-local-rag' }}>
          <Form.Item name="name" label="Key 名称" rules={[{ required: true, message: '请输入 Key 名称' }]}>
            <Input placeholder="codex-local-rag" />
          </Form.Item>
        </Form>
        {createdToken && (
          <Alert
            type="warning"
            showIcon
            message="请立即复制保存"
            description={
              <Space direction="vertical" style={{ width: '100%' }}>
                <Paragraph copyable={{ text: createdToken }} style={{ marginBottom: 0 }}>
                  <Text code>{createdToken}</Text>
                </Paragraph>
                <Button
                  icon={<CopyOutlined />}
                  onClick={() => navigator.clipboard?.writeText(createdToken)}
                >
                  复制 Key
                </Button>
              </Space>
            }
          />
        )}
      </Modal>
    </div></ModulePage>
  );
};

export default SystemConfigPage;
