import { DownloadOutlined, FileOutlined } from '@ant-design/icons';
import { authRequest } from '@/services/rag-admin/api';
import { request, useParams } from '@umijs/max';
import { Button, Result, Spin, Tag } from 'antd';
import React from 'react';

interface SharedArtifactData {
  artifact: {
    id: string;
    title: string;
    filename: string;
    contentType?: string | null;
    size: number;
    kind: string;
  };
  share: {
    visibility: 'internal' | 'external';
    expiresAt?: string | null;
    maxDownloads?: number | null;
    downloadCount: number;
  };
}

const SharedArtifactPage: React.FC = () => {
  const { token = '' } = useParams<{ token: string }>();
  const [data, setData] = React.useState<SharedArtifactData | null>(null);
  const [internal, setInternal] = React.useState(false);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    let active = true;
    void request<SharedArtifactData | { available: false; error?: string }>(
      `/api/shared/artifacts/${encodeURIComponent(token)}`,
    ).then(async (external) => {
      if ('artifact' in external) return external;
      const result = await authRequest<{ data: SharedArtifactData; available: boolean; error?: string }>(
        `/api/admin/qa-ops/artifact-shares/${encodeURIComponent(token)}`,
      );
      if (!result.available || !result.data) throw new Error(result.error || '分享链接不可用');
      if (active) setInternal(true);
      return result.data;
    }).then((value) => {
      if (active) setData(value);
    }).catch((reason: Error) => {
      if (active) setError(reason.message || '分享链接不可用');
    });
    return () => { active = false; };
  }, [token]);

  const download = async () => {
    if (!data) return;
    const path = internal
      ? `/api/admin/qa-ops/artifact-shares/${encodeURIComponent(token)}/download`
      : `/api/shared/artifacts/${encodeURIComponent(token)}/download`;
    const accessToken = localStorage.getItem('access_token');
    const response = await fetch(path, {
      headers: internal && accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    });
    if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}）`);
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = data.artifact.filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (error) return <div className="shared-artifact-page"><Result status="warning" title="分享链接不可用" subTitle={error} /></div>;
  if (!data) return <div className="shared-artifact-page shared-artifact-loading"><Spin size="large" /></div>;

  const previewPath = `/api/shared/artifacts/${encodeURIComponent(token)}/preview`;
  const canPreview = !internal && (data.artifact.kind === 'image' || data.artifact.kind === 'architecture');

  return (
    <main className="shared-artifact-page">
      <section className="shared-artifact-sheet">
        <FileOutlined className="shared-artifact-icon" />
        <div className="shared-artifact-heading">
          <h1>{data.artifact.title}</h1>
          <p>{data.artifact.filename}</p>
          <Tag>{internal ? '企业内部分享' : '外部分享'}</Tag>
        </div>
        {canPreview && <img className="shared-artifact-preview" src={previewPath} alt={data.artifact.title} />}
        <dl>
          <div><dt>文件大小</dt><dd>{Math.max(1, Math.round(data.artifact.size / 1024))} KB</dd></div>
          <div><dt>已下载</dt><dd>{data.share.downloadCount} 次</dd></div>
          <div><dt>有效期</dt><dd>{data.share.expiresAt ? new Date(data.share.expiresAt).toLocaleString('zh-CN') : '长期有效'}</dd></div>
        </dl>
        <Button type="primary" size="large" icon={<DownloadOutlined />} onClick={() => void download()}>
          下载文件
        </Button>
      </section>
    </main>
  );
};

export default SharedArtifactPage;
