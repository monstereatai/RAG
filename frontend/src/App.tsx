import { useState, useEffect } from 'react';
import UploadPage from './components/UploadPage';
import ChatPage from './components/ChatPage';
import DebugPanel from './components/DebugPanel';
import Login from './components/Login';
import { getProfile } from './api';
import type { UserInfo } from './types';
import './App.css';

type Tab = 'chat' | 'upload' | 'debug';

function App() {
  const [tab, setTab] = useState<Tab>('chat');
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [user, setUser] = useState<UserInfo | null>(null);

  useEffect(() => {
    if (token) {
      getProfile()
        .then((profile) => {
          setUser(profile);
        })
        .catch(() => {
          handleLogout();
        });
    } else {
      setUser(null);
    }
  }, [token]);

  const handleLoginSuccess = (newToken: string) => {
    setToken(newToken);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('chatThreadId');
    setToken(null);
    setUser(null);
  };

  if (!token) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>RAG 知识库</h1>
        <nav className="tabs">
          <button
            id="tab-chat"
            className={tab === 'chat' ? 'active' : ''}
            onClick={() => setTab('chat')}
          >
            💬 对话
          </button>
          <button
            id="tab-upload"
            className={tab === 'upload' ? 'active' : ''}
            onClick={() => setTab('upload')}
          >
            📂 文档管理
          </button>
          <button
            id="tab-debug"
            className={tab === 'debug' ? 'active' : ''}
            onClick={() => setTab('debug')}
          >
            🔬 Debug
          </button>
        </nav>
        {user && (
          <div className="user-profile">
            <span className={`user-badge ${user.role === 'admin' ? 'user-badge-admin' : ''}`}>
              {user.role === 'admin' ? '👑' : '👤'} {user.username} ({user.role})
            </span>
            <button className="logout-btn" onClick={handleLogout}>
              注销
            </button>
          </div>
        )}
      </header>
      <main className="app-main">
        {tab === 'chat' && <ChatPage />}
        {tab === 'upload' && <UploadPage />}
        {tab === 'debug' && <DebugPanel />}
      </main>
    </div>
  );
}

export default App;
