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
import { Button, Input, Select, Skeleton, Space, Tag, Tabs, Empty, List, Typography } from 'antd';
import React, { useEffect, useState } from 'react';
import { getPopularQueries, getSearchRecords, getSearchStats, reindexSearchDocuments, searchDocuments, searchGraph, type FullTextResult, type GraphSearchResult, type PopularQuery, type SearchRecord } from './service';

type PageState = 'loading' | 'data' | 'error' | 'empty';

const iconMap: Record<string, React.ReactNode> = {
  docx: <FileWordOutlined className="file-icon word" />,
  pdf: <FilePdfOutlined className="file-icon pdf" />,
  xlsx: <FileExcelOutlined className="file-icon excel" />,
  pptx: <FileWordOutlined className="file-icon ppt" />,
};

const SearchOps: React.FC = () => {
  const [query, setQuery] = useState('');
  const [searchType, setSearchType] = useState<'documents' | 'graph'>('documents');
  const [fullTextResults, setFullTextResults] = useState<FullTextResult[]>([]);
  const [graphResults, setGraphResults] = useState<GraphSearchResult>({ nodes: [], edges: [] });
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [records, setRecords] = useState<SearchRecord[]>([]);
  const [popularQueries, setPopularQueries] = useState<PopularQuery[]>([]);
  const [pageState, setPageState] = useState<PageState>('loading');
  const [searchStats, setSearchStats] = useState<{
    totalSearches: number;
    avgResponseTime: number;
    avgHitCount: number;
    zeroHitRate: number;
  } | null>(null);

  useEffect(() => {
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
  }, []);

  const runSearch = async (value = query) => {
    const normalized = value.trim();
    if (!normalized) return;
    setSearching(true);
    setSearched(true);
    try {
      if (searchType === 'documents') {
        const response = await searchDocuments(normalized);
        const payload: any = (response as any)?.data ?? response;
        setFullTextResults(Array.isArray(payload) ? payload : payload?.data ?? []);
      } else {
        const response = await searchGraph(normalized);
        const payload: any = (response as any)?.data ?? response;
        const data = payload?.data ?? payload;
        setGraphResults({ nodes: data?.nodes ?? [], edges: data?.edges ?? [] });
      }
    } finally {
      setSearching(false);
    }
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
    <ModulePage activeKey="history" navItems={searchNav} title="智能搜索">
      <div className="rag-panel search-hero">
        <div className="search-line">
          <Input value={query} onChange={(event) => setQuery(event.target.value)} onPressEnter={() => void runSearch()} allowClear placeholder={searchType === 'documents' ? '搜索文档名称、正文内容...' : '搜索实体、文档或关系...'} prefix={<SearchOutlined />} size="large" />
          <Button loading={searching} onClick={() => void runSearch()} size="large" type="primary">搜索</Button>
          <Button type="text">高级搜索⌄</Button>
          <Button loading={reindexing} onClick={() => void rebuildFullTextIndex()} type="link">补建全文索引</Button>
        </div>
        <Tabs
          activeKey={searchType}
          onChange={(key) => setSearchType(key as 'documents' | 'graph')}
          items={[{ key: 'documents', label: '文档全文检索' }, { key: 'graph', label: '知识图谱检索' }]}
        />
        <div className="filter-line">
          <span>文件类型:</span>
          <Select defaultValue="全部类型" options={[{ value: '全部类型' }]} />
          <span>更新时间:</span>
          <Select defaultValue="全部时间" options={[{ value: '全部时间' }]} />
          <span>文档分类:</span>
          <Select defaultValue="全部分类" options={[{ value: '全部分类' }]} />
          <span>权限范围:</span>
          <Select defaultValue="全部权限" options={[{ value: '全部权限' }]} />
          <Button icon={<ReloadOutlined />} type="link">清空</Button>
          <Button type="link">展开⌄</Button>
        </div>
      </div>

      {searched && (
        <div className="rag-panel search-results">
          <div className="panel-head">
            <span>{searchType === 'documents' ? `全文检索结果（${fullTextResults.length}）` : `图谱检索结果（${graphResults.nodes.length} 个节点，${graphResults.edges.length} 条关系）`}</span>
          </div>
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
            <List
              dataSource={graphResults.nodes}
              renderItem={(node) => <List.Item><List.Item.Meta title={`${node.label}（${node.type}）`} description={`节点 ID：${node.id}${node.sourceId ? `，来源：${node.sourceId}` : ''}`} /></List.Item>}
            />
          )}
        </div>
      )}

      {popularQueries.length > 0 && (
        <div className="rag-panel" style={{ padding: '10px 26px', marginBottom: 12 }}>
          <span style={{ fontSize: 13, color: '#667085', marginRight: 12 }}>热门搜索：</span>
          {popularQueries.slice(0, 8).map((q) => (
            <Tag key={q.query} style={{ marginBottom: 4, cursor: 'pointer' }}>{q.query}</Tag>
          ))}
        </div>
      )}

      <div className="rag-panel search-results">
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
      </div>
    </ModulePage>
  );
};

export default SearchOps;
