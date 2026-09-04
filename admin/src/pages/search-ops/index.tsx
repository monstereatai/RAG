import {
  AppstoreOutlined,
  FileExcelOutlined,
  FilePdfOutlined,
  FileWordOutlined,
  FolderOutlined,
  ReloadOutlined,
  SearchOutlined,
  TableOutlined,
} from '@ant-design/icons';
import { ModulePage, searchNav } from '@/components/AdminShell';
import { Button, Input, Select, Skeleton, Space, Tag, Tabs, Empty, List, Typography, Card, Statistic } from 'antd';
import React, { useEffect, useMemo, useState } from 'react';
import { getPopularQueries, getSearchFacets, getSearchRecords, getSearchStats, reindexSearchDocuments, searchDocuments, searchGraph, type FullTextResult, type GraphSearchResult, type PopularQuery, type SearchFacets, type SearchFilters, type SearchRecord } from './service';

type PageState = 'loading' | 'data' | 'error' | 'empty';
type SideView = 'history' | 'hot' | 'filter';

const FILE_TYPES = ['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'md', 'csv', 'json', 'html'];

const fileTypeOptions = [
  { value: '', label: '全部类型' },
  ...FILE_TYPES.map((type) => ({ value: type, label: type.toUpperCase() })),
];

const updatedRangeOptions = [
  { value: '', label: '全部时间' },
  { value: 'day', label: '今天' },
  { value: 'week', label: '近7天' },
  { value: 'month', label: '近30天' },
];

const allOption = { value: '', label: '全部' };

const iconMap: Record<string, React.ReactNode> = {
  docx: <FileWordOutlined className="file-icon word" />,
  pdf: <FilePdfOutlined className="file-icon pdf" />,
  xlsx: <FileExcelOutlined className="file-icon excel" />,
  pptx: <FileWordOutlined className="file-icon ppt" />,
};

/** 筛选表单的一行（label + 控件） */
const FilterRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
    <span style={{ width: 72, flexShrink: 0, color: '#667085' }}>{label}</span>
    <div style={{ flex: 1 }}>{children}</div>
  </div>
);

const graphNodePalette: Record<string, { fill: string; stroke: string; text: string }> = {
  Concept: { fill: '#e8f3ff', stroke: '#91caff', text: '#0958d9' },
  Artifact: { fill: '#f6edff', stroke: '#d3adf7', text: '#531dab' },
  Document: { fill: '#fff7e6', stroke: '#ffd591', text: '#ad4e00' },
  default: { fill: '#f5f5f5', stroke: '#d9d9d9', text: '#434343' },
};

const getGraphNodeColor = (type: string) => graphNodePalette[type] ?? graphNodePalette.default;

const shortenGraphLabel = (value: string, length = 12) => (
  value.length > length ? `${value.slice(0, length - 1)}…` : value
);

const GraphSearchCanvas: React.FC<{
  graph: GraphSearchResult;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}> = ({ graph, selectedNodeId, onSelectNode }) => {
  const layout = useMemo(() => {
    const width = 1080;
    const height = 440;
    const centerX = width / 2;
    const centerY = height / 2;
    const nodeCount = graph.nodes.length;
    const radius = Math.min(160, Math.max(105, 72 + nodeCount * 9));
    const positions = new Map<string, { x: number; y: number }>();

    graph.nodes.forEach((node, index) => {
      if (nodeCount === 1) {
        positions.set(node.id, { x: centerX, y: centerY });
        return;
      }
      const angle = (Math.PI * 2 * index) / nodeCount - Math.PI / 2;
      positions.set(node.id, {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      });
    });

    return { width, height, positions };
  }, [graph.nodes]);

  const nodeById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) : undefined;
  const relatedEdges = selectedNodeId
    ? graph.edges.filter((edge) => edge.source === selectedNodeId || edge.target === selectedNodeId)
    : [];
  const typeLegend = [...new Set(graph.nodes.map((node) => node.type || '其他'))];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
        <Typography.Text type="secondary">圆点表示实体，箭头表示实体间关系；点击实体可查看关联详情。</Typography.Text>
        <Space size={6} wrap>
          {typeLegend.map((type) => {
            const color = getGraphNodeColor(type);
            return <Tag key={type} style={{ margin: 0, color: color.text, background: color.fill, borderColor: color.stroke }}>{type}</Tag>;
          })}
        </Space>
      </div>
      <div style={{ border: '1px solid #f0f0f0', borderRadius: 8, overflow: 'hidden', background: '#fafcff' }}>
        <svg
          aria-label="知识图谱关系图"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          style={{ display: 'block', width: '100%', minWidth: 720, height: 440 }}
        >
          <defs>
            <marker id="graph-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill="#91a4bd" />
            </marker>
          </defs>
          {graph.edges.map((edge, index) => {
            const source = layout.positions.get(edge.source);
            const target = layout.positions.get(edge.target);
            if (!source || !target || edge.source === edge.target) return null;
            const deltaX = target.x - source.x;
            const deltaY = target.y - source.y;
            const distance = Math.sqrt(deltaX ** 2 + deltaY ** 2) || 1;
            const nodeRadius = 29;
            const startX = source.x + (deltaX / distance) * nodeRadius;
            const startY = source.y + (deltaY / distance) * nodeRadius;
            const endX = target.x - (deltaX / distance) * (nodeRadius + 5);
            const endY = target.y - (deltaY / distance) * (nodeRadius + 5);
            return (
              <line key={`${edge.source}-${edge.target}-${edge.label}-${index}`} x1={startX} y1={startY} x2={endX} y2={endY} stroke="#91a4bd" strokeWidth="1.5" markerEnd="url(#graph-arrow)">
                <title>{`${edge.sourceLabel ?? nodeById.get(edge.source)?.label ?? edge.source} → ${edge.label} → ${edge.targetLabel ?? nodeById.get(edge.target)?.label ?? edge.target}`}</title>
              </line>
            );
          })}
          {graph.nodes.map((node) => {
            const position = layout.positions.get(node.id);
            if (!position) return null;
            const color = getGraphNodeColor(node.type);
            const selected = node.id === selectedNodeId;
            return (
              <g
                key={node.id}
                role="button"
                tabIndex={0}
                aria-label={`查看节点 ${node.label}`}
                onClick={() => onSelectNode(node.id)}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onSelectNode(node.id); }}
                style={{ cursor: 'pointer' }}
              >
                <title>{`${node.label}（${node.type}）${node.sourceId ? `，来源：${node.sourceId}` : ''}`}</title>
                <circle cx={position.x} cy={position.y} r="29" fill={color.fill} stroke={selected ? '#1677ff' : color.stroke} strokeWidth={selected ? '3' : '1.5'} />
                <text x={position.x} y={position.y + 4} textAnchor="middle" fontSize="12" fill={color.text} fontWeight="600">{shortenGraphLabel(node.label, 9)}</text>
                <text x={position.x} y={position.y + 48} textAnchor="middle" fontSize="11" fill="#8c8c8c">{shortenGraphLabel(node.type || '其他', 14)}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 0.72fr)', gap: 16, marginTop: 16 }}>
        <div>
          <Typography.Text strong>关系明细</Typography.Text>
          <Space wrap style={{ display: 'flex', marginTop: 8 }}>
            {graph.edges.map((edge, index) => (
              <Tag key={`${edge.source}-${edge.target}-${edge.label}-${index}`} style={{ whiteSpace: 'normal', margin: 0 }}>
                {shortenGraphLabel(edge.sourceLabel ?? nodeById.get(edge.source)?.label ?? edge.source, 16)} → {edge.label} → {shortenGraphLabel(edge.targetLabel ?? nodeById.get(edge.target)?.label ?? edge.target, 16)}
              </Tag>
            ))}
          </Space>
        </div>
        <div style={{ padding: '12px 14px', border: '1px solid #e6f4ff', borderRadius: 8, background: '#f6fbff' }}>
          <Typography.Text strong>{selectedNode ? selectedNode.label : '选择一个实体'}</Typography.Text>
          {selectedNode ? (
            <div style={{ marginTop: 6, color: '#667085', fontSize: 13, lineHeight: 1.7 }}>
              <div>类型：{selectedNode.type}</div>
              <div>来源：{selectedNode.sourceId || '未标注'}</div>
              <div>关联关系：{relatedEdges.length} 条</div>
            </div>
          ) : <Typography.Paragraph type="secondary" style={{ margin: '6px 0 0' }}>点击图中的实体查看它的来源和关联关系。</Typography.Paragraph>}
        </div>
      </div>
    </div>
  );
};

const SearchOps: React.FC = () => {
  /**
   * 搜索运营页同时承载全文检索与图谱检索；两者共用查询词和筛选条件，
   * 但结果结构不同，必须分别存储，不能将图谱节点误渲染成文档列表。
   */
  const [query, setQuery] = useState('');
  const [searchType, setSearchType] = useState<'documents' | 'graph'>('documents');
  const [fullTextResults, setFullTextResults] = useState<FullTextResult[]>([]);
  const [graphResults, setGraphResults] = useState<GraphSearchResult>({ nodes: [], edges: [] });
  const [selectedGraphNodeId, setSelectedGraphNodeId] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [records, setRecords] = useState<SearchRecord[]>([]);
  const [popularQueries, setPopularQueries] = useState<PopularQuery[]>([]);
  const [sideView, setSideView] = useState<SideView>('history');
  const [facets, setFacets] = useState<SearchFacets>({ documentTypes: [], roles: [] });
  const [filters, setFilters] = useState<SearchFilters>({});
  const [pageState, setPageState] = useState<PageState>('loading');
  const [searchStats, setSearchStats] = useState<{
    totalSearches: number;
    avgResponseTime: number;
    avgHitCount: number;
    zeroHitRate: number;
  } | null>(null);

  useEffect(() => {
    // 历史、统计、热门词互不依赖；筛选项属于增强能力，故在下方独立请求，
    // 防止 facets（筛选聚合）失败阻断用户执行正常搜索。
    setPageState('loading');

    Promise.all([
      getSearchRecords({ current: 1, pageSize: 6 }),
      getSearchStats(),
      getPopularQueries({ limit: 6 }),
    ])
      .then(([recordRes, statsRes, popularRes]) => {
        const recordData = (recordRes as any)?.data ?? recordRes;
        const recordList = Array.isArray(recordData) ? recordData : recordData?.items ?? [];
        setRecords(Array.isArray(recordList) ? recordList : []);

        const statsData = (statsRes as any)?.data ?? statsRes;
        if (statsData) setSearchStats(statsData as any);

        const popularData = (popularRes as any)?.data ?? popularRes;
        const popularList = Array.isArray(popularData) ? popularData : popularData?.items ?? [];
        setPopularQueries(Array.isArray(popularList) ? popularList : []);

        if (Array.isArray(recordList) && recordList.length > 0) {
          setPageState('data');
        } else {
          setPageState('empty');
        }
      })
      .catch(() => {
        setPageState('error');
      });

    // 筛选项是增强能力，加载失败时不能阻断顶部搜索和搜索历史。
    getSearchFacets()
      .then((facetsRes) => {
        const facetsData = (facetsRes as any)?.data ?? facetsRes;
        setFacets({
          documentTypes: Array.isArray(facetsData?.documentTypes) ? facetsData.documentTypes : [],
          roles: Array.isArray(facetsData?.roles) ? facetsData.roles : [],
        });
      })
      .catch(() => setFacets({ documentTypes: [], roles: [] }));
  }, []);

  /** 根据当前 Tab 调用对应检索：全文结果需要高亮片段，图谱结果需要 nodes/edges（节点／边）成对保留。 */
  const runSearch = async (
    value = query,
    nextFilters = filters,
    nextSearchType = searchType,
  ) => {
    const normalized = value.trim();
    if (!normalized) return;
    setSearching(true);
    setSearched(true);
    setSearchError(null);
    try {
      if (nextSearchType === 'documents') {
        const response = await searchDocuments(normalized, 20, nextFilters);
        const payload = (response as any)?.data ?? response;
        setFullTextResults(Array.isArray(payload) ? payload : []);
      } else {
        const response = await searchGraph(normalized);
        const data = (response as any)?.data ?? response;
        const nextGraph = { nodes: data?.nodes ?? [], edges: data?.edges ?? [] };
        setGraphResults(nextGraph);
        setSelectedGraphNodeId(nextGraph.nodes[0]?.id ?? null);
      }
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : '搜索失败，请检查搜索服务后重试');
      if (nextSearchType === 'documents') setFullTextResults([]);
      else setGraphResults({ nodes: [], edges: [] });
    } finally {
      setSearching(false);
    }
  };

  const clearFilters = () => {
    setFilters({});
    if (query.trim() && searchType === 'documents') void runSearch(query, {});
  };

  const rebuildFullTextIndex = async () => {
    setReindexing(true);
    try {
      await reindexSearchDocuments();
      if (searchType === 'documents' && query.trim()) await runSearch();
    } finally {
      setReindexing(false);
    }
  };

  const renderHighlight = (fragment: string) => {
    const parts = fragment.split(/(<em>|<\/em>)/g);
    let highlighted = false;
    return parts.map((part, index) => {
      if (part === '<em>') { highlighted = true; return null; }
      if (part === '</em>') { highlighted = false; return null; }
      return highlighted ? <mark key={index}>{part}</mark> : <span key={index}>{part}</span>;
    });
  };

  return (
    <ModulePage activeKey={sideView} navItems={searchNav} title="智能搜索" onNavChange={(key) => setSideView(key as SideView)}>
      <div className="rag-panel search-hero">
        <div className="search-line">
          <Input value={query} onChange={(event) => setQuery(event.target.value)} onPressEnter={() => void runSearch()} allowClear placeholder={searchType === 'documents' ? '搜索文档名称、正文内容...' : '搜索实体、文档或关系...'} prefix={<SearchOutlined />} size="large" />
          <Button loading={searching} onClick={() => void runSearch()} size="large" type="primary">搜索</Button>
          <Button type="text">高级搜索⌄</Button>
          <Button loading={reindexing} onClick={() => void rebuildFullTextIndex()} type="link">补建全文索引</Button>
        </div>
        <Tabs
          activeKey={searchType}
          onChange={(key) => {
            const nextSearchType = key as 'documents' | 'graph';
            setSearchType(nextSearchType);
            if (query.trim()) void runSearch(query, filters, nextSearchType);
          }}
          items={[{ key: 'documents', label: '文档全文检索' }, { key: 'graph', label: '知识图谱检索' }]}
        />
        <div className="filter-line">
          <span>文件类型:</span>
          <Select value={filters.fileType ?? ''} options={fileTypeOptions} onChange={(value) => setFilters((current) => ({ ...current, fileType: value || undefined }))} />
          <span>更新时间:</span>
          <Select value={filters.updatedRange ?? ''} options={updatedRangeOptions} onChange={(value) => setFilters((current) => ({ ...current, updatedRange: (value || undefined) as SearchFilters['updatedRange'] }))} />
          <span>文档分类:</span>
          <Select value={filters.documentType ?? ''} options={[allOption, ...facets.documentTypes.map((value) => ({ value, label: value }))]} onChange={(value) => setFilters((current) => ({ ...current, documentType: value || undefined }))} />
          <span>权限范围:</span>
          <Select value={filters.role ?? ''} options={[allOption, ...facets.roles.map((value) => ({ value, label: value }))]} onChange={(value) => setFilters((current) => ({ ...current, role: value || undefined }))} />
          <Button icon={<ReloadOutlined />} type="link" onClick={clearFilters}>清空</Button>
          {Object.values(filters).some(Boolean) && <Button type="primary" ghost onClick={() => void runSearch()}>应用筛选</Button>}
        </div>
      </div>

      {searched && (
        <div className="rag-panel search-results">
          <div className="panel-head">
            <span>{searchType === 'documents' ? `全文检索结果（${fullTextResults.length}）` : `图谱检索结果（${graphResults.nodes.length} 个节点，${graphResults.edges.length} 条关系）`}</span>
          </div>
          {searchError && <Typography.Text type="danger">{searchError}</Typography.Text>}
          {searching && <Skeleton active paragraph={{ rows: 5 }} />}
          {!searching && searchType === 'documents' && fullTextResults.length === 0 && <Empty description="没有找到匹配文档" />}
          {!searching && searchType === 'documents' && fullTextResults.map((item) => (
            <List.Item key={item.docId}>
              <List.Item.Meta
                title={<span>{item.title || item.filename} <Tag color="blue">{item.docVersion || '未标版本'}</Tag></span>}
                description={<div>{item.highlightFragments.length ? item.highlightFragments.map((fragment, index) => <Typography.Paragraph key={index} style={{ marginBottom: 4 }}>{renderHighlight(fragment)}</Typography.Paragraph>) : item.summary || '正文命中，但没有返回高亮片段。'}</div>}
              />
            </List.Item>
          ))}
          {!searching && searchType === 'graph' && graphResults.nodes.length === 0 && graphResults.edges.length === 0 && <Empty description="没有找到匹配节点或关系" />}
          {!searching && searchType === 'graph' && (graphResults.nodes.length > 0 || graphResults.edges.length > 0) && (
            <GraphSearchCanvas graph={graphResults} selectedNodeId={selectedGraphNodeId} onSelectNode={setSelectedGraphNodeId} />
          )}
        </div>
      )}

      {sideView === 'hot' && (
        <div className="rag-panel" style={{ padding: 20, marginBottom: 12 }}>
          <div className="panel-head"><span>热门搜索</span><span style={{ color: '#667085', fontSize: 13 }}>按查询次数排序，点击关键词直接检索</span></div>
          <Space wrap>
            {popularQueries.length ? popularQueries.map((item) => (
              <Tag key={item.query} color="blue" style={{ cursor: 'pointer', padding: '5px 10px' }} onClick={() => { setQuery(item.query); setSideView('history'); void runSearch(item.query); }}>
                {item.query}（{item.count}）
              </Tag>
            )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无热门搜索数据" />}
          </Space>
        </div>
      )}

      {sideView === 'filter' && (
        <Card title="搜索筛选" style={{ marginBottom: 12 }}>
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Typography.Text type="secondary">筛选条件会和关键词一起提交，只对文档全文检索生效；草稿、归档和已废弃版本不会出现在结果中。</Typography.Text>
            <Space wrap>
              <Select style={{ width: 150 }} value={filters.fileType ?? ''} options={fileTypeOptions} onChange={(value) => setFilters((current) => ({ ...current, fileType: value || undefined }))} />
              <Select style={{ width: 150 }} value={filters.updatedRange ?? ''} options={updatedRangeOptions} onChange={(value) => setFilters((current) => ({ ...current, updatedRange: (value || undefined) as SearchFilters['updatedRange'] }))} />
              <Select style={{ width: 180 }} value={filters.documentType ?? ''} options={[allOption, ...facets.documentTypes.map((value) => ({ value, label: value }))]} onChange={(value) => setFilters((current) => ({ ...current, documentType: value || undefined }))} />
              <Select style={{ width: 180 }} value={filters.role ?? ''} options={[allOption, ...facets.roles.map((value) => ({ value, label: value }))]} onChange={(value) => setFilters((current) => ({ ...current, role: value || undefined }))} />
              <Button onClick={clearFilters}>清空条件</Button>
              <Button type="primary" onClick={() => { setSideView('history'); if (query.trim()) void runSearch(); }}>应用并搜索</Button>
            </Space>
          </Space>
        </Card>
      )}

      {sideView === 'history' && popularQueries.length > 0 && (
        <div className="rag-panel" style={{ padding: '10px 26px', marginBottom: 12 }}>
          <span style={{ fontSize: 13, color: '#667085', marginRight: 12 }}>热门搜索：</span>
          {popularQueries.slice(0, 8).map((q) => (
            <Tag key={q.query} style={{ marginBottom: 4, cursor: 'pointer' }} onClick={() => { setQuery(q.query); void runSearch(q.query); }}>{q.query}</Tag>
          ))}
        </div>
      )}

      {sideView === 'history' && <div className="rag-panel search-results">
        <div className="panel-head">
          {pageState === 'loading' ? (
            <span>加载中...</span>
          ) : pageState === 'error' || pageState === 'empty' ? (
            <span>暂无搜索记录</span>
          ) : (
            <span>
              找到约 {searchStats?.avgHitCount ? Math.round(searchStats.avgHitCount) : '-'} 条结果
              {searchStats?.avgResponseTime != null
                ? `（用时 ${(searchStats.avgResponseTime / 1000).toFixed(2)} 秒）`
                : ''}
            </span>
          )}
          <Space>
            <Select defaultValue="相关度排序" options={[{ value: '相关度排序' }]} />
            <Button icon={<TableOutlined />} type="primary" />
            <Button icon={<AppstoreOutlined />} />
          </Space>
        </div>

        {pageState === 'loading' && <Skeleton active paragraph={{ rows: 6 }} />}

        {pageState === 'error' && (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <h3>加载失败</h3>
            <p style={{ color: '#999', marginTop: 8 }}>无法加载搜索记录，请确认 admin-backend 服务正常。</p>
          </div>
        )}

        {pageState === 'empty' && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#999' }}>
            暂无搜索历史记录
          </div>
        )}

        {pageState === 'data' &&
          records.slice(0, 10).map((record) => (
            <article className="result-card" key={record.id}>
              <div>{iconMap.docx}</div>
              <div>
                <h3>{record.query}</h3>
                <div className="result-meta">
                  <span><FolderOutlined /> 搜索历史</span>
                  <span>时间：{record.createdAt}</span>
                  <Tag color="blue">{record.mode}</Tag>
                  <Tag>命中 {record.hitCount} 条</Tag>
                </div>
              </div>
            </article>
          ))}
      </div>}

      {sideView === 'hot' && searchStats && (
        <Card title="搜索概览">
          <Space size="large" wrap>
            <Statistic title="总搜索次数" value={searchStats.totalSearches} />
            <Statistic title="平均响应时间" value={(searchStats.avgResponseTime / 1000).toFixed(2)} suffix="秒" />
            <Statistic title="平均命中数" value={searchStats.avgHitCount} precision={1} />
            <Statistic title="零命中率" value={searchStats.zeroHitRate * 100} precision={1} suffix="%" />
          </Space>
        </Card>
      )}
    </ModulePage>
  );
};

export default SearchOps;
