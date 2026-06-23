import { UploadOutlined } from '@ant-design/icons';
import type { ProFormInstance } from '@ant-design/pro-components';
import {
  ProForm,
  ProFormSelect,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components';
import { useModel } from '@umijs/max';
import { Button, message, Upload } from 'antd';
import React from 'react';
import useStyles from './index.style';

const BaseView: React.FC = () => {
  const { styles } = useStyles();
  const formRef = React.useRef<ProFormInstance>(undefined);
  const { initialState } = useModel('@@initialState');
  const currentUser = initialState?.currentUser;

  const handleFinish = async () => {
    message.success('更新基本信息成功');
  };

  const getAvatarURL = () => {
    if (currentUser?.avatar) {
      return currentUser.avatar;
    }
    return 'https://gw.alipayobjects.com/zos/rmsportal/BiazfanxmamNRoxxVxka.png';
  };

  return (
    <div className={styles.baseView}>
      <div className={styles.left}>
        <ProForm
          formRef={formRef}
          layout="vertical"
          onFinish={handleFinish}
          submitter={{
            searchConfig: {
              submitText: '更新基本信息',
            },
            render: (_, dom) => dom[1],
          }}
          initialValues={{
            email: currentUser?.email ?? '',
            name: currentUser?.name ?? currentUser?.username ?? '',
            profile: '',
            defaultSearchMode: 'auto',
            language: 'zh-CN',
          }}
          requiredMark={false}
        >
          <ProFormText
            width="md"
            name="email"
            label="邮箱"
            rules={[
              {
                required: true,
                message: '请输入您的邮箱!',
              },
            ]}
          />
          <ProFormText
            width="md"
            name="name"
            label="昵称"
            rules={[
              {
                required: true,
                message: '请输入您的昵称!',
              },
            ]}
          />
          <ProFormTextArea
            name="profile"
            label="个人简介"
            placeholder="个人简介"
          />
          <ProFormSelect
            width="sm"
            name="defaultSearchMode"
            label="默认检索模式"
            options={[
              { label: '自动', value: 'auto' },
              { label: '简单检索', value: 'simple' },
              { label: 'Agentic 检索', value: 'agentic' },
            ]}
          />
          <ProFormSelect
            width="sm"
            name="language"
            label="界面语言"
            options={[
              { label: '简体中文', value: 'zh-CN' },
              { label: 'English', value: 'en-US' },
            ]}
          />
        </ProForm>
      </div>
      <div className={styles.right}>
        <AvatarView avatar={getAvatarURL()} />
      </div>
    </div>
  );
};

const AvatarView = ({ avatar }: { avatar: string }) => {
  const { styles } = useStyles();

  return (
    <>
      <div className={styles.avatar_title}>头像</div>
      <div className={styles.avatar}>
        <img src={avatar} alt="avatar" />
      </div>
      <Upload showUploadList={false}>
        <div className={styles.button_view}>
          <Button>
            <UploadOutlined />
            更换头像
          </Button>
        </div>
      </Upload>
    </>
  );
};

export default BaseView;
