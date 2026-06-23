import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { LoginForm, ProFormText } from '@ant-design/pro-components';
import { Helmet, useModel } from '@umijs/max';
import { Alert, message } from 'antd';
import { createStyles } from 'antd-style';
import React, { startTransition, useState } from 'react';
import Settings from '../../../../config/defaultSettings';

const useStyles = createStyles(({ token: _token }) => ({
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    overflow: 'auto',
    backgroundImage:
      "url('https://mdn.alipayobjects.com/yuyan_qk0oxh/afts/img/V-_oS6r-i7wAAAAAAAAAAAAAFl94AQBr')",
    backgroundSize: '100% 100%',
  },
}));

const LoginMessage: React.FC<{ content: string }> = ({ content }) => (
  <Alert style={{ marginBottom: 24 }} message={content} type="error" showIcon />
);

const Login: React.FC = () => {
  const [loginError, setLoginError] = useState<string>('');
  const { initialState, setInitialState } = useModel('@@initialState');
  const { styles } = useStyles();

  const fetchUserInfo = async () => {
    const userInfo = await initialState?.fetchUserInfo?.();
    if (userInfo) {
      startTransition(() => {
        setInitialState((s) => ({ ...s, currentUser: userInfo }));
      });
    }
  };

  const handleSubmit = async (values: {
    username: string;
    password: string;
  }) => {
    try {
      setLoginError('');
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const json = await res.json();
      // 后端统一响应格式: { code, data: { access_token, refresh_token } }
      const tokenData = json.data ?? json;
      if (res.ok && tokenData.access_token) {
        localStorage.setItem('access_token', tokenData.access_token);
        if (tokenData.refresh_token) {
          localStorage.setItem('refresh_token', tokenData.refresh_token);
        }
        message.success('登录成功');
        await fetchUserInfo();
        const urlParams = new URL(window.location.href).searchParams;
        const redirect = urlParams.get('redirect') || '/';
        window.location.href = redirect;
        return;
      }
      setLoginError(json.message || '登录失败');
    } catch {
      setLoginError('网络错误，请重试');
    }
  };

  return (
    <div className={styles.container}>
      <Helmet>
        <title>{`登录 - ${Settings.title}`}</title>
      </Helmet>
      <div style={{ flex: 1, padding: '32px 0' }}>
        <LoginForm
          contentStyle={{ minWidth: 280, maxWidth: '75vw' }}
          logo={<img alt="logo" src="/logo.svg" />}
          title="RAG 管理后台"
          subTitle="企业级智能检索管理系统"
          onFinish={handleSubmit}
        >
          {loginError && <LoginMessage content={loginError} />}
          <ProFormText
            name="username"
            fieldProps={{ size: 'large', prefix: <UserOutlined /> }}
            placeholder="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          />
          <ProFormText.Password
            name="password"
            fieldProps={{ size: 'large', prefix: <LockOutlined /> }}
            placeholder="密码"
            rules={[{ required: true, message: '请输入密码' }]}
          />
        </LoginForm>
      </div>
    </div>
  );
};

export default Login;
