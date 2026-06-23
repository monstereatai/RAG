import {
  PageContainer,
  ProForm,
  ProFormText,
} from '@ant-design/pro-components';
import { Card, message } from 'antd';
import React, { useEffect, useState } from 'react';
import { getConfigs, type SystemConfig, updateConfig } from './service';

const groupLabels: Record<string, string> = {
  rag: 'RAG 服务',
  llm: 'LLM 配置',
  embedding: 'Embedding 配置',
  search: '搜索配置',
  storage: '存储配置',
  security: '安全配置',
};

const SystemConfigPage: React.FC = () => {
  const [configs, setConfigs] = useState<SystemConfig[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getConfigs()
      .then((res) => setConfigs((res as any)?.data ?? res ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const grouped = configs.reduce<Record<string, SystemConfig[]>>((acc, c) => {
    const g = c.group || 'other';
    if (!acc[g]) acc[g] = [];
    acc[g].push(c);
    return acc;
  }, {});

  return (
    <PageContainer>
      {Object.entries(grouped).map(([group, items]) => (
        <Card
          key={group}
          title={groupLabels[group] || group}
          style={{ marginBottom: 24 }}
          loading={loading}
        >
          <ProForm
            submitter={{ searchConfig: { submitText: '保存配置' } }}
            onFinish={async (values) => {
              for (const [key, value] of Object.entries(values)) {
                if (value !== undefined) {
                  await updateConfig(key, value as string);
                }
              }
              message.success('配置已保存');
              return true;
            }}
            initialValues={Object.fromEntries(
              items.map((c) => [c.key, c.value]),
            )}
          >
            {items.map((c) => (
              <ProFormText
                key={c.key}
                name={c.key}
                label={c.key}
                tooltip={c.description}
              />
            ))}
          </ProForm>
        </Card>
      ))}
    </PageContainer>
  );
};

export default SystemConfigPage;
