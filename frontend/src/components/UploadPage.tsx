import { useState, useEffect, useCallback } from 'react';
import { uploadDocument, listDocuments, deleteDocument } from '../api';
import type { DocumentItem } from '../types';

function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>('info');
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const showMessage = useCallback((text: string, type: 'success' | 'error' | 'info' = 'info') => {
    setMessage(text);
    setMessageType(type);
  }, []);

  const refreshDocs = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listDocuments();
      setDocs(list);
    } catch (err) {
      showMessage(`加载文档列表失败: ${(err as Error).message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [showMessage]);

  useEffect(() => {
    refreshDocs();
  }, [refreshDocs]);

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    showMessage('上传中...', 'info');
    try {
      const result = await uploadDocument(file);
      showMessage(
        `✅ 上传成功: docId=${result.docId}, 切分 ${result.chunkCount} 个片段`,
        'success',
      );
      setFile(null);
      // 重置 file input
      const input = document.getElementById('doc-file-input') as HTMLInputElement;
      if (input) input.value = '';
      await refreshDocs();
    } catch (err) {
      showMessage(`❌ 上传失败: ${(err as Error).message}`, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (docId: string, filename: string) => {
    if (!confirm(`确定删除文档「${filename}」？\n此操作将同步删除 Milvus 向量和 BM25 索引，不可恢复。`)) {
      return;
    }
    setDeletingId(docId);
    try {
      await deleteDocument(docId);
      showMessage(`🗑️ 已删除文档「${filename}」`, 'success');
      await refreshDocs();
    } catch (err) {
      showMessage(`❌ 删除失败: ${(err as Error).message}`, 'error');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="upload-page">
      <section className="upload-section">
        <h2>上传文档</h2>
        <div className="upload-form">
          <input
            id="doc-file-input"
            type="file"
            accept=".md,.markdown,.txt,.pdf,.docx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            disabled={uploading}
          />
          <button id="doc-upload-btn" onClick={handleUpload} disabled={!file || uploading}>
            {uploading ? '上传中...' : '上传'}
          </button>
        </div>
        {message && (
          <p className={`upload-message upload-message-${messageType}`}>{message}</p>
        )}
      </section>

      <section className="docs-section">
        <div className="docs-section-header">
          <h2>文档列表</h2>
          <button
            id="doc-refresh-btn"
            className="btn-secondary"
            onClick={refreshDocs}
            disabled={loading}
          >
            {loading ? '刷新中...' : '刷新'}
          </button>
        </div>
        {docs.length === 0 ? (
          <p className="empty">暂无文档，请先上传</p>
        ) : (
          <table className="docs-table">
            <thead>
              <tr>
                <th>文件名</th>
                <th>片段数</th>
                <th>创建时间</th>
                <th>Doc ID</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.docId}>
                  <td>{doc.filename}</td>
                  <td>{doc.chunkCount}</td>
                  <td>{new Date(doc.createdAt).toLocaleString()}</td>
                  <td className="doc-id">{doc.docId.slice(0, 8)}...</td>
                  <td>
                    <button
                      className="btn-danger-sm"
                      onClick={() => handleDelete(doc.docId, doc.filename)}
                      disabled={deletingId === doc.docId}
                    >
                      {deletingId === doc.docId ? '删除中...' : '删除'}
                    </button>
                  </td>
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
