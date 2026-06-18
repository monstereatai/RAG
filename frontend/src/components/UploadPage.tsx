import { useState, useEffect } from 'react';
import { uploadDocument, listDocuments } from '../api';
import type { DocumentItem } from '../types';

function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(false);

  const refreshDocs = async () => {
    setLoading(true);
    try {
      const list = await listDocuments();
      setDocs(list);
    } catch (err) {
      setMessage(`加载文档列表失败: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshDocs();
  }, []);

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setMessage('上传中...');
    try {
      const result = await uploadDocument(file);
      setMessage(`上传成功: docId=${result.docId}, 切分 ${result.chunkCount} 个片段`);
      setFile(null);
      await refreshDocs();
    } catch (err) {
      setMessage(`上传失败: ${(err as Error).message}`);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="upload-page">
      <section className="upload-section">
        <h2>上传文档</h2>
        <div className="upload-form">
          <input
            type="file"
            accept=".md,.markdown,.txt,.pdf,.docx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={uploading}
          />
          <button onClick={handleUpload} disabled={!file || uploading}>
            {uploading ? '上传中...' : '上传'}
          </button>
        </div>
        {message && <p className="upload-message">{message}</p>}
      </section>

      <section className="docs-section">
        <h2>文档列表 {loading && '(加载中...)'}</h2>
        {docs.length === 0 ? (
          <p className="empty">暂无文档</p>
        ) : (
          <table className="docs-table">
            <thead>
              <tr>
                <th>文件名</th>
                <th>片段数</th>
                <th>创建时间</th>
                <th>Doc ID</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.docId}>
                  <td>{doc.filename}</td>
                  <td>{doc.chunkCount}</td>
                  <td>{new Date(doc.createdAt).toLocaleString()}</td>
                  <td className="doc-id">{doc.docId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

export default UploadPage;
