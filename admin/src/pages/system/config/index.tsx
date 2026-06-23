import {
  PageContainer,
  ProForm,
  ProFormSelect,
  ProFormSwitch,
  ProFormText,
} from '@ant-design/pro-components';
import { Card, message } from 'antd';
import React from 'react';

const SystemConfigPage: React.FC = () => {
  return (
    <PageContainer>
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
    </PageContainer>
  );
};

export default SystemConfigPage;
