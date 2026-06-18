import React, { useState } from 'react';
import { login } from '../api';

interface LoginProps {
  onLoginSuccess: (token: string) => void;
}

export default function Login({ onLoginSuccess }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError('请输入用户名和密码');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const response = await login(username, password);
      localStorage.setItem('token', response.accessToken);
      onLoginSuccess(response.accessToken);
    } catch (err: any) {
      setError(
        err.response?.data?.message ||
        '登录失败，请检查用户名和密码是否正确'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleQuickLogin = async (user: string, pass: string) => {
    setUsername(user);
    setPassword(pass);
    setError(null);
    setLoading(true);
    try {
      const response = await login(user, pass);
      localStorage.setItem('token', response.accessToken);
      onLoginSuccess(response.accessToken);
    } catch (err: any) {
      setError(
        err.response?.data?.message ||
        '登录失败，请检查用户名和密码是否正确'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <h2>RAG 知识库系统</h2>
          <p>请登录以访问您个人的物理隔离数据</p>
        </div>

        {error && <div className="login-error">{error}</div>}

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="username">用户名</label>
            <div className="form-input-wrapper">
              <input
                id="username"
                type="text"
                className="form-input"
                placeholder="请输入用户名"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="password">密码</label>
            <div className="form-input-wrapper">
              <input
                id="password"
                type="password"
                className="form-input"
                placeholder="请输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>

          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? '登录中...' : '登 录'}
          </button>
        </form>

        <div className="quick-login">
          <div className="quick-login-title">快速通道（点击一键登录测试）</div>
          <div className="quick-login-buttons">
            <button
              type="button"
              className="quick-login-btn"
              onClick={() => handleQuickLogin('admin', 'admin123')}
              disabled={loading}
            >
              👑 管理员 (admin)
            </button>
            <button
              type="button"
              className="quick-login-btn"
              onClick={() => handleQuickLogin('user', 'user1234')}
              disabled={loading}
            >
              👤 普通用户 (user)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
