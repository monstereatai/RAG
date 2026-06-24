import { ReloadOutlined } from '@ant-design/icons';
import {
  ProForm,
  ProFormText,
} from '@ant-design/pro-components';
import { Button, Card, Empty, message, Result } from 'antd';
import React, { useCallback, useEffect, useState } from 'react';
import { getConfigs, type SystemConfig, updateConfig } from './service';
import { ModulePage, systemNav } from '@/components/AdminShell';

type PageState = 'loading' | 'data' | 'error' | 'empty';

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
  const [pageState, setPageState] = useState<PageState>('loading');

  const fetchConfigs = useCallback(() => {
    setPageState('loading');
    getConfigs()
      .then((res) => {
        const data = (res as any)?.data ?? res ?? [];
        if (Array.isArray(data) && data.length) {
          setConfigs(data);
          setPageState('data');
        } else {
          setConfigs([]);
          setPageState('empty');
        }
      })
      .catch(() => {
        setConfigs([]);
        setPageState('error');
      });
  }, []);

  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);

  const grouped = pageState === 'data'
    ? configs.reduce<Record<string, SystemConfig[]>>((acc, c) => {
        const g = c.group || 'other';
        if (!acc[g]) acc[g] = [];
        acc[g].push(c);
        return acc;
      }, {})
    : {};

  const renderBody = () => {
    switch (pageState) {
      case 'loading':
        return (
          <Card loading style={{ marginBottom: 24 }}>
            <div style={{ height: 200 }} />
          </Card>
        );
      case 'error':
        return (
          <Result
            status="error"
            title="加载失败"
            subTitle="无法获取系统配置，请检查网络或联系管理员"
            extra={<Button icon={<ReloadOutlined />} onClick={fetchConfigs}>重试</Button>}
          />
        );
      case 'empty':
        return <Empty description="暂无系统配置数据" />;
      case 'data':
      default:
        return Object.entries(grouped).map(([group, items]) => (
          <Card
            key={group}
            title={groupLabels[group] || group}
            style={{ marginBottom: 24 }}
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
        ));
    }
  };

  return (
    <ModulePage activeKey="service" navItems={systemNav} title="系统管理"><div className="rag-panel" style={{ padding: 24 }}>
      {renderBody()}
    </div></ModulePage>
  );
};

export default SystemConfigPage;
