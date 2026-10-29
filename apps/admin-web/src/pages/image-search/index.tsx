import { SearchOutlined } from '@ant-design/icons';
import { Link } from '@umijs/max';
import {
  Alert,
  Button,
  Card,
  Empty,
  Image,
  Input,
  Spin,
  Tabs,
  Upload,
} from 'antd';
import React, { useEffect, useState } from 'react';
import type { SideNavItem } from '@/components/AdminShell';
import { ModulePage } from '@/components/AdminShell';
import {
  type ImageSearchResponse,
  type ImageSearchResult,
  loadImageAssetPreview,
  searchImageAssets,
  searchImageAssetsByImage,
} from './service';

const navItems: SideNavItem[] = [
  {
    key: 'images',
    label: '图片检索',
    icon: <SearchOutlined />,
    path: '/image-search',
  },
];

const getDocumentId = (result: ImageSearchResult) =>
  result.meta?.sourceDocumentId ?? result.meta?.sourceDocId ?? result.docId;

const getPlacement = (result: ImageSearchResult) => {
  if (typeof result.meta?.pageNumber === 'number') {
    return `PDF 第 ${result.meta.pageNumber} 页`;
  }
  if (typeof result.meta?.slideNumber === 'number') {
    return `PPT 第 ${result.meta.slideNumber} 页`;
  }
  return result.meta?.placement === 'original' ? '原始图片' : undefined;
};

const formatScore = (score: number) =>
  Number.isFinite(score) ? score.toFixed(4) : '—';

const ImageAssetPreview: React.FC<{ url?: string; alt: string }> = ({
  url,
  alt,
}) => {
  const [source, setSource] = useState<string>();
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    setSource(undefined);
    setError(false);
    if (url) {
      void loadImageAssetPreview(url)
        .then((loadedUrl) => {
          objectUrl = loadedUrl;
          if (active) setSource(loadedUrl);
          else URL.revokeObjectURL(loadedUrl);
        })
        .catch(() => {
          if (active) setError(true);
        });
    }
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  const frameStyle: React.CSSProperties = {
    alignItems: 'center',
    background: '#f5f7fa',
    display: 'flex',
    height: 210,
    justifyContent: 'center',
    overflow: 'hidden',
    padding: error || !url ? 16 : undefined,
    textAlign: error || !url ? 'center' : undefined,
  };

  if (!url || error) {
    return (
      <div style={{ ...frameStyle, color: '#667085' }}>
        {url
          ? '预览加载失败，图片资源可能无法通过当前登录态访问'
          : '当前结果没有可预览的图片地址'}
      </div>
    );
  }
  if (!source) {
    return (
      <div style={frameStyle}>
        <Spin />
      </div>
    );
  }
  return (
    <div style={frameStyle}>
      <Image
        alt={alt}
        height={210}
        onError={() => setError(true)}
        preview
        src={source}
        style={{ objectFit: 'contain', width: '100%' }}
      />
    </div>
  );
};

const ImageSearchPage: React.FC = () => {
  const [query, setQuery] = useState('');
  const [queryImage, setQueryImage] = useState<File>();
  const [activeTab, setActiveTab] = useState('text');
  const [response, setResponse] = useState<ImageSearchResponse>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const handleSearch = async (rawQuery = query) => {
    const normalized = rawQuery.trim();
    if (!normalized) {
      setError('请输入图片描述或检索词');
      setResponse(undefined);
      return;
    }

    setQuery(normalized);
    setLoading(true);
    setError(undefined);
    setResponse(undefined);
    try {
      const result = await searchImageAssets(normalized);
      setResponse({
        ...result,
        results: Array.isArray(result.results) ? result.results : [],
      });
    } catch (searchError) {
      setError(
        searchError instanceof Error ? searchError.message : '图片检索失败',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleImageSearch = async () => {
    if (!queryImage) {
      setError('请选择一张图片');
      setResponse(undefined);
      return;
    }
    if (queryImage.size > 5 * 1024 * 1024) {
      setError('图片不能超过 5 MB');
      setResponse(undefined);
      return;
    }

    setLoading(true);
    setError(undefined);
    setResponse(undefined);
    try {
      const result = await searchImageAssetsByImage(queryImage);
      setResponse({
        ...result,
        results: Array.isArray(result.results) ? result.results : [],
      });
    } catch (searchError) {
      setError(
        searchError instanceof Error ? searchError.message : '图片检索失败',
      );
    } finally {
      setLoading(false);
    }
  };

  const results = response?.results ?? [];
  const disabledReason = response?.reason?.includes('未启用') ?? false;

  return (
    <ModulePage activeKey="images" navItems={navItems} title="图片检索">
      <Card title="图片检索">
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'text',
              label: '文搜图',
              children: (
                <div style={{ maxWidth: 760 }}>
                  <Input.Search
                    allowClear
                    enterButton={
                      <Button icon={<SearchOutlined />} type="primary">
                        搜索图片
                      </Button>
                    }
                    loading={loading}
                    onChange={(event) => setQuery(event.target.value)}
                    onSearch={(value) => void handleSearch(value)}
                    placeholder="描述图片内容，例如：季度营收趋势图"
                    size="large"
                    value={query}
                  />
                </div>
              ),
            },
            {
              key: 'image',
              label: '以图搜图',
              children: (
                <div style={{ alignItems: 'center', display: 'flex', gap: 12 }}>
                  <Upload
                    accept="image/*"
                    beforeUpload={(file) => {
                      setQueryImage(file);
                      return false;
                    }}
                    maxCount={1}
                    onRemove={() => setQueryImage(undefined)}
                  >
                    <Button>选择图片</Button>
                  </Upload>
                  <Button
                    disabled={!queryImage}
                    icon={<SearchOutlined />}
                    loading={loading}
                    onClick={() => void handleImageSearch()}
                    type="primary"
                  >
                    上传并搜索
                  </Button>
                  <span style={{ color: '#667085', fontSize: 13 }}>
                    支持图片文件，最大 5 MB
                  </span>
                </div>
              ),
            },
          ]}
        />
        <div style={{ color: '#667085', fontSize: 13, marginTop: 12 }}>
          搜索范围由当前管理员身份及文档权限决定。
        </div>
      </Card>

      {error && (
        <Alert
          title="图片检索失败"
          description={error}
          showIcon
          style={{ marginTop: 16 }}
          type="error"
        />
      )}

      {response?.reason && (
        <Alert
          title={disabledReason ? '图片检索未启用' : '图片检索暂不可用'}
          description={response.reason}
          showIcon
          style={{ marginTop: 16 }}
          type={disabledReason ? 'warning' : 'info'}
        />
      )}

      <Card
        extra={response ? `找到 ${results.length} 张图片` : undefined}
        style={{ marginTop: 16 }}
        title={response ? `“${response.query}” 的检索结果` : '图片资产'}
      >
        <Spin spinning={loading} description="正在检索图片资产…">
          {response && results.length > 0 ? (
            <div
              style={{
                display: 'grid',
                gap: 16,
                gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
              }}
            >
              {results.map((result, index) => {
                const previewKey = `${result.docId}:${result.meta?.assetKey ?? result.meta?.assetIndex ?? index}`;
                const documentId = getDocumentId(result);
                const title =
                  result.meta?.filename ??
                  result.meta?.description ??
                  `图片资产 ${index + 1}`;
                const placement = getPlacement(result);

                return (
                  <Card
                    key={previewKey}
                    size="small"
                    title={title}
                    cover={
                      <ImageAssetPreview
                        alt={String(result.meta?.description ?? title)}
                        url={result.url}
                      />
                    }
                  >
                    {result.meta?.description && result.meta.filename && (
                      <div style={{ color: '#667085', marginBottom: 8 }}>
                        {result.meta.description}
                      </div>
                    )}
                    <div style={{ marginBottom: 8 }}>
                      <Link to={`/documents/${encodeURIComponent(documentId)}`}>
                        来源文档：{documentId}
                      </Link>
                    </div>
                    {placement && (
                      <div style={{ color: '#667085', marginBottom: 8 }}>
                        {placement}
                      </div>
                    )}
                    <div style={{ color: '#667085' }}>
                      相似度：{formatScore(result.score)}
                    </div>
                  </Card>
                );
              })}
            </div>
          ) : response ? (
            <Empty
              description={
                response.reason
                  ? '当前没有可展示的图片结果，请查看上方说明'
                  : '没有找到匹配的图片资产'
              }
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ) : loading ? null : (
            <Empty
              description="输入图片描述或检索词，开始搜索图片资产"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          )}
        </Spin>
      </Card>
    </ModulePage>
  );
};

export default ImageSearchPage;
