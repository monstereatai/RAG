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
import { Button, Input, Select, Space, Tag } from 'antd';
import React, { useEffect, useState } from 'react';
import { getPopularQueries, getSearchRecords, getSearchStats, type PopularQuery, type SearchRecord } from './service';

const fallbackResults = [
  {
    id: '1',
    title: '企业数据安全管理规范 v2.1',
    type: 'docx',
    path: '安全管理制度 > 数据安全',
    time: '2024-05-20 10:30',
    permission: '仅企业内部可见',
    text: '为加强企业 数据安全管理，规范数据处理活动，保障数据安全，特制定本规范。本规范适用于公司及各子公司全体员工，涵盖数据收集、存储、使用、传输、销毁等全生命周期管理要求 ...',
  },
  {
    id: '2',
    title: '数据安全分级分类实施指南',
    type: 'pdf',
    path: '安全管理制度 > 实施指南',
    time: '2024-04-28 15:45',
    permission: '仅企业内部可见',
    text: '本指南围绕 数据安全 分级分类方法展开，帮助企业识别和划分数据重要性等级，明确不同级别数据的安全保护措施和管理要求，提升整体 数据安全 防护能力 ...',
  },
  {
    id: '3',
    title: '数据安全检查清单（2024版）',
    type: 'xlsx',
    path: '安全管理制度 > 检查清单',
    time: '2024-05-15 09:20',
    permission: '部分部门可见',
    text: '本清单用于检查企业 数据安全 管理的合规性，内容包括数据权限管理、数据脱敏、日志审计、应急响应等关键控制点，确保 数据安全 管理措施有效落地 ...',
  },
  {
    id: '4',
    title: '数据安全培训课件',
    type: 'pptx',
    path: '培训资料 > 安全培训',
    time: '2024-03-30 11:10',
    permission: '仅企业内部可见',
    text: '本课件用于员工 数据安全 意识培训，内容涵盖 数据安全 法规、公司政策、案例分析及最佳实践，帮助员工理解并遵守 数据安全 管理要求 ...',
  },
];

const iconMap: Record<string, React.ReactNode> = {
  docx: <FileWordOutlined className="file-icon word" />,
  pdf: <FilePdfOutlined className="file-icon pdf" />,
  xlsx: <FileExcelOutlined className="file-icon excel" />,
  pptx: <FileWordOutlined className="file-icon ppt" />,
};

const highlight = (text: string) => {
  const parts = text.split('数据安全');
  let offset = 0;
  return (
    <>
      {parts.map((part) => {
        const key = `${offset}-${part.length}`;
        offset += part.length + '数据安全'.length;
        return (
          <React.Fragment key={key}>
            {part}
            {offset <= text.length && <mark>数据安全</mark>}
          </React.Fragment>
        );
      })}
    </>
  );
};

const SearchOps: React.FC = () => {
  const [records, setRecords] = useState<SearchRecord[]>([]);
  const [popularQueries, setPopularQueries] = useState<PopularQuery[]>([]);
  const [searchStats, setSearchStats] = useState<{
    totalSearches: number;
    avgResponseTime: number;
    avgHitCount: number;
    zeroHitRate: number;
  } | null>(null);

  const displayRecords = records.length > 0;
  const displayPopular = !displayRecords && popularQueries.length > 0;

  const results = displayRecords
    ? records.slice(0, 4).map((record, index) => ({
        ...fallbackResults[index % fallbackResults.length],
        id: record.id,
        title: record.query,
        time: record.createdAt,
      }))
    : displayPopular
      ? popularQueries.map((q, i) => ({
          id: `pop-${i}`,
          title: q.query,
          type: 'docx' as const,
          path: '热门搜索',
          time: '',
          permission: '热门搜索',
          text: `搜索 ${q.count} 次，平均命中 ${Math.round(q.avgHitCount)} 条结果`,
        }))
      : fallbackResults;

  useEffect(() => {
    getSearchRecords({ current: 1, pageSize: 6 })
      .then((res) => {
        const data = (res as any)?.data ?? res;
        const list = Array.isArray(data) ? data : data?.items;
        setRecords(Array.isArray(list) ? list : []);
      })
      .catch(() => setRecords([]));
  }, []);

  useEffect(() => {
    getSearchStats()
      .then((res) => {
        const data = (res as any)?.data ?? res;
        if (data) setSearchStats(data as any);
      })
      .catch(() => {});

    getPopularQueries({ limit: 6 })
      .then((res) => {
        const data = (res as any)?.data ?? res;
        const list = Array.isArray(data) ? data : data?.items;
        setPopularQueries(Array.isArray(list) ? list : []);
      })
      .catch(() => setPopularQueries([]));
  }, []);

  return (
    <ModulePage activeKey="history" navItems={searchNav} title="智能搜索">
      <div className="rag-panel search-hero">
        <div className="search-line">
          <Input allowClear defaultValue="企业数据安全管理规范" prefix={<SearchOutlined />} size="large" />
          <Button size="large" type="primary">搜索</Button>
          <Button type="text">高级搜索⌄</Button>
        </div>
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
          <span>找到约 {searchStats?.avgHitCount ? Math.round(searchStats.avgHitCount) : 128} 条结果（用时 {searchStats?.avgResponseTime != null ? (searchStats.avgResponseTime / 1000).toFixed(2) : '0.23'} 秒）</span>
          <Space>
            <Select defaultValue="相关度排序" options={[{ value: '相关度排序' }]} />
            <Button icon={<TableOutlined />} type="primary" />
            <Button icon={<AppstoreOutlined />} />
          </Space>
        </div>
        {results.map((item) => (
          <article className="result-card" key={item.id}>
            <div>{iconMap[item.type] ?? iconMap.docx}</div>
            <div>
              <h3>{highlight(item.title)}</h3>
              <p>{highlight(item.text)}</p>
              <div className="result-meta">
                <span><FolderOutlined /> 来自：{item.path}</span>
                <span>更新时间：{item.time}</span>
                <Tag color="green">权限：{item.permission}</Tag>
              </div>
            </div>
          </article>
        ))}
      </div>
    </ModulePage>
  );
};

export default SearchOps;
