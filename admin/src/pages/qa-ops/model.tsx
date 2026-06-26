import { ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { ModulePage, qaNav } from '@/components/AdminShell';
import { Alert, Button, Card, Checkbox, Descriptions, Form, Select, Space, Tag, message } from 'antd';
import React from 'react';
import {
  type ChatModel,
  type QaModelConfig,
  defaultQaModelConfig,
  getQaModelConfig,
  qaModelOptions,
  saveQaModelConfig,
} from './service';

const modelLabels: Record<ChatModel, string> = {
  qwen: '通义千问',
  deepseek: 'DeepSeek',
};

const ModelConfigPage: React.FC = () => {
  const [form] = Form.useForm<QaModelConfig>();
  const [config, setConfig] = React.useState<QaModelConfig>(() =>
    getQaModelConfig(),
  );
  const enabledModels = Form.useWatch('enabledModels', form) ?? config.enabledModels;

  React.useEffect(() => {
    form.setFieldsValue(config);
  }, [config, form]);

  const handleFinish = (values: QaModelConfig) => {
    const next = saveQaModelConfig(values);
    setConfig(next);
    form.setFieldsValue(next);
    message.success('模型配置已保存');
  };

  const handleReset = () => {
    const next = saveQaModelConfig(defaultQaModelConfig);
    setConfig(next);
    form.setFieldsValue(next);
    message.success('已恢复默认模型配置');
  };

  return (
    <ModulePage activeKey="model" navItems={qaNav} title="AI问答">
      <div className="model-config-layout">
        <Card
          title="模型配置"
          extra={
            <Space>
              <Button icon={<ReloadOutlined />} onClick={handleReset}>
                恢复默认
              </Button>
              <Button
                icon={<SaveOutlined />}
                onClick={() => form.submit()}
                type="primary"
              >
                保存配置
              </Button>
            </Space>
          }
        >
          <Alert
            message="这里保存的是后台 AI 问答的非敏感偏好配置。API Key 仍通过后端 .env 配置，不会写入前端。"
            showIcon
            style={{ marginBottom: 18 }}
            type="info"
          />
          <Form
            form={form}
            initialValues={config}
            layout="vertical"
            onFinish={handleFinish}
          >
            <Form.Item
              label="默认问答模型"
              name="defaultModel"
              rules={[{ required: true, message: '请选择默认模型' }]}
            >
              <Select
                options={qaModelOptions
                  .filter((item) => enabledModels.includes(item.key))
                  .map((item) => ({ label: item.label, value: item.key }))}
              />
            </Form.Item>
            <Form.Item
              label="AI 问答页可选模型"
              name="enabledModels"
              rules={[
                {
                  validator: (_, value: ChatModel[]) =>
                    Array.isArray(value) && value.length > 0
                      ? Promise.resolve()
                      : Promise.reject(new Error('至少启用一个模型')),
                },
              ]}
            >
              <Checkbox.Group
                options={qaModelOptions.map((item) => ({
                  label: item.label,
                  value: item.key,
                }))}
              />
            </Form.Item>
          </Form>
        </Card>

        <div className="model-card-grid">
          {qaModelOptions.map((item) => (
            <Card
              className="model-config-card"
              key={item.key}
              title={
                <Space>
                  <span>{item.label}</span>
                  {config.defaultModel === item.key && <Tag color="blue">默认</Tag>}
                  {config.enabledModels.includes(item.key) ? (
                    <Tag color="green">已启用</Tag>
                  ) : (
                    <Tag>已隐藏</Tag>
                  )}
                </Space>
              }
            >
              <p>{item.description}</p>
              <Descriptions column={1} size="small">
                <Descriptions.Item label="Provider">{item.provider}</Descriptions.Item>
                <Descriptions.Item label="默认模型">{item.defaultModel}</Descriptions.Item>
                <Descriptions.Item label="Base URL">{item.baseUrl}</Descriptions.Item>
                <Descriptions.Item label="API Key 环境变量">{item.apiKeyEnv}</Descriptions.Item>
                <Descriptions.Item label="超时环境变量">{item.timeoutEnv}</Descriptions.Item>
              </Descriptions>
            </Card>
          ))}
        </div>

        <Card title="生效范围">
          <Descriptions column={1} size="small">
            <Descriptions.Item label="当前默认模型">
              {modelLabels[config.defaultModel]}
            </Descriptions.Item>
            <Descriptions.Item label="AI 问答发送">
              新建对话默认使用这里保存的模型，也可以在输入框旁临时切换。
            </Descriptions.Item>
            <Descriptions.Item label="后端密钥">
              通义千问使用 `QWEN_API_KEY`，DeepSeek 使用 `DEEPSEEK_API_KEY`。
            </Descriptions.Item>
          </Descriptions>
        </Card>
      </div>
    </ModulePage>
  );
};

export default ModelConfigPage;
