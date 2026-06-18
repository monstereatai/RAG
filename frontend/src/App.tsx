import { useState } from 'react';
import UploadPage from './components/UploadPage';
import ChatPage from './components/ChatPage';
import './App.css';

type Tab = 'chat' | 'upload';

function App() {
  const [tab, setTab] = useState<Tab>('chat');

  return (
    <div className="app">
      <header className="app-header">
        <h1>RAG 知识库</h1>
        <nav className="tabs">
          <button
            className={tab === 'chat' ? 'active' : ''}
            onClick={() => setTab('chat')}
          >
            对话
          </button>
          <button
            className={tab === 'upload' ? 'active' : ''}
            onClick={() => setTab('upload')}
          >
            文档管理
          </button>
        </nav>
      </header>
      <main className="app-main">
        {tab === 'chat' ? <ChatPage /> : <UploadPage />}
      </main>
    </div>
  );
}

export default App;
