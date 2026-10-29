import { EyeInvisibleOutlined, LockOutlined, UserOutlined } from '@ant-design/icons';
import { Helmet, useModel } from '@umijs/max';
import { Button, Checkbox, Form, Input, message } from 'antd';
import { createStyles } from 'antd-style';
import React, { startTransition, useState } from 'react';
import Settings from '../../../../config/defaultSettings';

const useStyles = createStyles(() => ({
  page: {
    minHeight: '100vh',
    background: '#fff',
  },
  topbar: {
    height: 70,
    display: 'flex',
    alignItems: 'center',
    padding: '0 32px',
    borderBottom: '1px solid #e8edf5',
  },
  brand: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 14,
    fontSize: 20,
    fontWeight: 700,
    color: '#111827',
  },
  logo: {
    width: 34,
    height: 34,
    borderRadius: 8,
    background: 'linear-gradient(135deg, #1677ff 0%, #69b1ff 100%)',
    boxShadow: '0 12px 24px rgb(22 119 255 / 18%)',
  },
  body: {
    minHeight: 'calc(100vh - 70px)',
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
  },
  hero: {
    padding: '210px 80px 0',
    background: 'linear-gradient(135deg, #f3f7ff 0%, #eaf2ff 100%)',
  },
  heroTitle: {
    margin: 0,
    color: '#0f1f3d',
    fontSize: 40,
    fontWeight: 800,
    letterSpacing: 0,
  },
  heroText: {
    marginTop: 28,
    color: '#667085',
    fontSize: 20,
    lineHeight: 1.8,
  },
  illustration: {
    position: 'relative',
    width: 420,
    height: 300,
    margin: '54px auto 0',
  },
  platform: {
    position: 'absolute',
    left: 70,
    bottom: 30,
    width: 280,
    height: 92,
    borderRadius: 24,
    background: 'linear-gradient(180deg, #d8e9ff 0%, #8bbcff 100%)',
    boxShadow: '0 32px 48px rgb(22 119 255 / 20%)',
    transform: 'skewY(-8deg)',
  },
  cube: {
    position: 'absolute',
    left: 170,
    bottom: 118,
    width: 116,
    height: 116,
    borderRadius: 18,
    background: 'linear-gradient(135deg, #69b1ff 0%, #1677ff 100%)',
    boxShadow: '0 24px 46px rgb(22 119 255 / 28%)',
  },
  floatCard: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: 14,
    background: 'rgb(255 255 255 / 72%)',
    border: '1px solid #cfe2ff',
    boxShadow: '0 20px 40px rgb(22 119 255 / 10%)',
  },
  formWrap: {
    position: 'fixed',
    top: 0,
    right: 0,
    width: '50%',
    height: '100vh',
    zIndex: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#fff',
  },
  card: {
    width: 492,
    padding: '48px 42px 56px',
    border: '1px solid #e8edf5',
    borderRadius: 8,
    boxShadow: '0 10px 28px rgb(15 23 42 / 8%)',
  },
  title: {
    margin: 0,
    textAlign: 'center',
    color: '#111827',
    fontSize: 30,
    fontWeight: 800,
  },
  subtitle: {
    margin: '14px 0 34px',
    textAlign: 'center',
    color: '#8a94a6',
    fontSize: 16,
  },
  options: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 26,
    color: '#697386',
  },
  submit: {
    width: '100%',
    height: 50,
    fontSize: 16,
    fontWeight: 700,
  },
  register: {
    marginTop: 28,
    textAlign: 'center',
    color: '#98a2b3',
  },
}));

const Login: React.FC = () => {
  const [loginError, setLoginError] = useState<string>('');
  const [loading, setLoading] = useState(false);
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

  const handleSubmit = async (values: { username: string; password: string }) => {
    try {
      setLoading(true);
      setLoginError('');
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const json = await res.json();
      const tokenData = json.data ?? json;
      if (res.ok && tokenData.access_token) {
        localStorage.setItem('access_token', tokenData.access_token);
        if (tokenData.refresh_token) {
          localStorage.setItem('refresh_token', tokenData.refresh_token);
        }
        message.success('登录成功');
        await fetchUserInfo();
        const urlParams = new URL(window.location.href).searchParams;
        window.location.href = urlParams.get('redirect') || '/dashboard';
        return;
      }
      setLoginError(json.message || '登录失败');
    } catch {
      setLoginError('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <Helmet>
        <title>{`登录 - ${Settings.title}`}</title>
      </Helmet>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span className={styles.logo} />
          <span>企业智能知识库系统</span>
        </div>
      </header>
      <main className={styles.body}>
        <section className={styles.hero}>
          <h1 className={styles.heroTitle}>企业智能知识库系统</h1>
          <p className={styles.heroText}>
            构建企业知识中枢，赋能智能决策与高效协作
            <br />
            让知识管理更简单，知识价值最大化
          </p>
          <div className={styles.illustration}>
            <div className={styles.platform} />
            <div className={styles.cube} />
            <div className={styles.floatCard} style={{ left: 0, top: 88 }} />
            <div className={styles.floatCard} style={{ right: 0, top: 112 }} />
            <div className={styles.floatCard} style={{ right: 34, bottom: 18 }} />
          </div>
        </section>
        <section className={styles.formWrap}>
          <div className={styles.card}>
            <h2 className={styles.title}>登录系统</h2>
            <p className={styles.subtitle}>欢迎登录企业智能知识库系统</p>
            <Form layout="vertical" onFinish={handleSubmit} requiredMark={false}>
              <Form.Item name="username" rules={[{ required: true, message: '请输入账号' }]}>
                <Input size="large" prefix={<UserOutlined />} placeholder="请输入账号" />
              </Form.Item>
              <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
                <Input.Password
                  iconRender={() => <EyeInvisibleOutlined />}
                  size="large"
                  prefix={<LockOutlined />}
                  placeholder="请输入密码"
                />
              </Form.Item>
              <div className={styles.options}>
                <Checkbox>记住账号</Checkbox>
                <Button type="link">忘记密码?</Button>
              </div>
              {loginError && <div style={{ color: '#ff4d4f', marginBottom: 14 }}>{loginError}</div>}
              <Button className={styles.submit} htmlType="submit" loading={loading} type="primary">
                登录
              </Button>
            </Form>
            <div className={styles.register}>
              <span>还没有账号?</span>
              <Button type="link">立即注册</Button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default Login;
