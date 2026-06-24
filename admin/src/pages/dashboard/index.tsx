import {
  FileTextOutlined,
  SearchOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { Line, Pie } from '@ant-design/plots';
import { ModulePage, dashboardNav } from '@/components/AdminShell';
import { Button, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React, { useEffect, useMemo, useState } from 'react';
import { getDashboardStats, type DashboardStats, type TrendItem } from './service';

const fallbackStats: DashboardStats = {
  documentCount: 24567,
  qaCount: 2345,
  searchCount: 8765,
  userCount: 1234,
  todaySearchCount: 567,
  todayQaCount: 234,
  avgResponseTime: 286,
  hitRate: 92.6,
};

const fallbackTrend: TrendItem[] = [
  ['00:00', 0],
  ['01:00', 58],
  ['02:00', 148],
  ['03:00', 305],
  ['05:00', 426],
  ['06:00', 352],
  ['07:00', 405],
  ['08:00', 586],
  ['09:00', 742],
  ['10:00', 950],
  ['11:00', 1240],
  ['12:00', 1515],
  ['14:00', 1550],
  ['15:00', 1486],
  ['17:00', 1368],
  ['18:00', 1120],
  ['19:00', 816],
  ['20:00', 520],
  ['21:00', 278],
  ['22:00', 128],
  ['24:00', 0],
].map(([date, value]) => ({
  date: String(date),
  searchCount: Number(value),
  qaCount: Math.round(Number(value) * 0.42),
  documentCount: Math.max(1, Math.round(Number(value) / 120)),
}));

const operations = [
  ['2024-05-20 14:30:25', '张三', '上传文档', '上传了文档《产品使用手册.pdf》', '产品使用手册.pdf'],
  ['2024-05-20 14:25:10', '李四', '更新文档', '更新了文档《企业安全管理制度.docx》', '企业安全管理制度.docx'],
  ['2024-05-20 14:20:45', '王五', '删除文档', '删除了文档《旧版合同模板.docx》', '旧版合同模板.docx'],
  ['2024-05-20 14:15:30', '赵六', '用户登录', '用户登录系统', '-'],
  ['2024-05-20 14:10:18', '孙七', 'AI问答', '通过AI问答获取了答案', '-'],
].map(([time, user, type, content, document], index) => ({
  id: index,
  time,
  user,
  type,
  content,
  document,
}));

const columns: ColumnsType<(typeof operations)[number]> = [
  { title: '操作时间', dataIndex: 'time' },
  { title: '操作用户', dataIndex: 'user' },
  { title: '操作类型', dataIndex: 'type' },
  { title: '操作内容', dataIndex: 'content' },
  {
    title: '相关文档',
    dataIndex: 'document',
    render: (value) => (value === '-' ? '-' : <a>{value}</a>),
  },
];

const Dashboard: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats>(fallbackStats);
  const [trendData, setTrendData] = useState<TrendItem[]>(fallbackTrend);
  const [range, setRange] = useState<'今日' | '近7日' | '近30日'>('今日');

  useEffect(() => {
    getDashboardStats()
      .then((res) => {
        // admin-backend 返回 { cards: { documents, questions, evaluations, activeUsers }, ... }
        const raw = (res as any)?.data ?? res;
        const cards = raw?.cards;
        if (cards && typeof cards.documents === 'number') {
          setStats({
            ...fallbackStats,
            documentCount: cards.documents,
            qaCount: cards.questions ?? fallbackStats.qaCount,
            userCount: cards.activeUsers ?? fallbackStats.userCount,
          });
        }
      })
      .catch(() => {});
  }, []);

  const cards = [
    { title: '文档总数', value: stats.documentCount, delta: '+320', icon: <FileTextOutlined /> },
    { title: '今日新增文档', value: 128, delta: '+15', icon: <FileTextOutlined /> },
    { title: 'AI问答次数', value: stats.qaCount, delta: '+234', icon: <span>AI</span> },
    { title: '用户搜索次数', value: stats.searchCount, delta: '+567', icon: <SearchOutlined /> },
    { title: '活跃用户数', value: stats.userCount, delta: '+123', icon: <TeamOutlined /> },
  ];

  const lineData = trendData.map((item) => ({
    time: item.date,
    value: item.searchCount,
  }));

  const pieData = useMemo(
    () => [
      { type: '产品文档', value: 8456 },
      { type: '技术文档', value: 6789 },
      { type: '培训资料', value: 4321 },
      { type: '制度流程', value: 3210 },
      { type: '市场营销', value: 1791 },
    ],
    [],
  );

  return (
    <ModulePage activeKey="overview" navItems={dashboardNav} title="首页大盘">
      <div className="dashboard-summary">
        {cards.map((card) => (
          <div className="metric-card rag-panel" key={card.title}>
            <div className="metric-icon">{card.icon}</div>
            <div>
              <div className="metric-title">{card.title}</div>
              <div className="metric-value">{card.value.toLocaleString()}</div>
              <div className="metric-delta">较昨日 <span>{card.delta} ↑</span></div>
            </div>
          </div>
        ))}
      </div>

      <div className="dashboard-main">
        <div className="rag-panel dashboard-chart">
          <div className="panel-head">
            <h3>访问趋势</h3>
            <div className="segmented-tabs">
              {(['今日', '近7日', '近30日'] as const).map((item) => (
                <button className={range === item ? 'active' : ''} key={item} onClick={() => setRange(item)} type="button">
                  {item}
                </button>
              ))}
            </div>
          </div>
          <Line
            data={lineData}
            height={300}
            point={{ sizeField: 3 }}
            shapeField="smooth"
            xField="time"
            yField="value"
          />
        </div>
        <div className="rag-panel dashboard-pie">
          <h3>文档分类占比</h3>
          <Pie
            angleField="value"
            colorField="type"
            data={pieData}
            height={300}
            innerRadius={0.62}
            legend={false}
          />
          <div className="pie-legend">
            {pieData.map((item) => (
              <div key={item.type}>
                <span>{item.type}</span>
                <strong>{item.value.toLocaleString()}</strong>
                <em>{((item.value / stats.documentCount) * 100).toFixed(2)}%</em>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rag-panel recent-panel">
        <div className="panel-head">
          <h3>近期操作记录</h3>
          <Button>查看更多</Button>
        </div>
        <Table columns={columns} dataSource={operations} pagination={false} rowKey="id" />
      </div>
    </ModulePage>
  );
};

export default Dashboard;
