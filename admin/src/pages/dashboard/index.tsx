import {
  FileTextOutlined,
  ReloadOutlined,
  SearchOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { Line } from '@ant-design/plots';
import { ModulePage, dashboardNav } from '@/components/AdminShell';
import { Button, Skeleton, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React, { useEffect, useMemo, useState } from 'react';
import { getDashboardStats, type DashboardStats, type TrendItem } from './service';

interface DashboardCard {
  title: string;
  value: number | null;
  icon: React.ReactNode;
  delta?: string;
}

type PageState = 'loading' | 'data' | 'error' | 'empty';

// Demo data is explicitly labeled and only shown on demand
const demoStats: DashboardStats = {
  documentCount: 24567,
  qaCount: 2345,
  searchCount: 8765,
  userCount: 1234,
  todaySearchCount: 567,
  todayQaCount: 234,
  avgResponseTime: 286,
  hitRate: 92.6,
};

const Dashboard: React.FC = () => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [trendData, setTrendData] = useState<TrendItem[]>([]);
  const [range] = useState<'今日' | '近7日' | '近30日'>('今日');
  const [pageState, setPageState] = useState<PageState>('loading');
  const [showDemo, setShowDemo] = useState(false);

  useEffect(() => {
    setPageState('loading');
    getDashboardStats()
      .then((res) => {
        const raw = (res as any)?.data ?? res;
        const cards = raw?.cards;
        if (cards && typeof cards.documents === 'number') {
          setStats({
            documentCount: cards.documents,
            qaCount: cards.questions ?? 0,
            searchCount: cards.searches ?? 0,
            userCount: cards.activeUsers ?? 0,
            todaySearchCount: cards.todaySearches ?? 0,
            todayQaCount: cards.todayQuestions ?? 0,
            avgResponseTime: cards.avgResponseTime ?? 0,
            hitRate: cards.hitRate ?? 0,
          });
          setPageState('data');
        } else if (raw && typeof raw.documentCount === 'number') {
          setStats(raw);
          setPageState('data');
        } else {
          setPageState('empty');
        }

        // Try to load trend data independently
        if (Array.isArray(raw?.trend)) {
          setTrendData(raw.trend);
        }
      })
      .catch(() => {
        setPageState('error');
      });
  }, []);

  const cards: DashboardCard[] = useMemo(
    () => [
      { title: '文档总数', value: stats?.documentCount ?? null, icon: <FileTextOutlined /> },
      { title: 'AI问答次数', value: stats?.qaCount ?? null, icon: <span>AI</span> },
      { title: '用户搜索次数', value: stats?.searchCount ?? null, icon: <SearchOutlined /> },
      { title: '活跃用户数', value: stats?.userCount ?? null, icon: <TeamOutlined /> },
    ],
    [stats],
  );

  // Demo pie data — only shown when user clicks "查看演示数据"
  const demoPieData = useMemo(
    () => [
      { type: '产品文档', value: 8456 },
      { type: '技术文档', value: 6789 },
      { type: '培训资料', value: 4321 },
      { type: '制度流程', value: 3210 },
      { type: '市场营销', value: 1791 },
    ],
    [],
  );

  // Demo operations — only shown when user clicks "查看演示数据"
  const demoOperations = useMemo(
    () =>
      [
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
      })),
    [],
  );

  const operationColumns: ColumnsType<(typeof demoOperations)[number]> = [
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

  // -------- Loading state ----------
  if (pageState === 'loading') {
    return (
      <ModulePage activeKey="overview" navItems={dashboardNav} title="首页大盘">
        <div className="dashboard-summary">
          {[1, 2, 3, 4].map((i) => (
            <div className="metric-card rag-panel" key={i}>
              <Skeleton active paragraph={{ rows: 1 }} title={{ width: '60%' }} />
            </div>
          ))}
        </div>
        <Skeleton active paragraph={{ rows: 8 }} style={{ marginTop: 24 }} />
      </ModulePage>
    );
  }

  // -------- Error state ----------
  if (pageState === 'error') {
    return (
      <ModulePage activeKey="overview" navItems={dashboardNav} title="首页大盘">
        <div className="rag-panel" style={{ textAlign: 'center', padding: '80px 0' }}>
          <h3>加载失败</h3>
          <p style={{ color: '#999', margin: '12px 0 24px' }}>
            无法获取大盘数据，请确认 admin-backend 服务正常运行。
          </p>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => window.location.reload()}
            type="primary"
          >
            重新加载
          </Button>
          <div style={{ marginTop: 24 }}>
            <Button
              onClick={() => {
                setStats(demoStats);
                setPageState('data');
                setShowDemo(true);
              }}
              size="small"
              type="link"
            >
              查看演示数据
            </Button>
            <span style={{ color: '#bbb', fontSize: 12, marginLeft: 8 }}>
              （演示数据不代表真实情况）
            </span>
          </div>
        </div>
      </ModulePage>
    );
  }

  // -------- Empty state ----------
  if (pageState === 'empty') {
    return (
      <ModulePage activeKey="overview" navItems={dashboardNav} title="首页大盘">
        <div className="rag-panel" style={{ textAlign: 'center', padding: '80px 0' }}>
          <h3>暂无数据</h3>
          <p style={{ color: '#999', margin: '12px 0 24px' }}>
            大盘尚未采集到数据，请上传文档后重试。
          </p>
          <div>
            <Button
              onClick={() => {
                setStats(demoStats);
                setPageState('data');
                setShowDemo(true);
              }}
              type="primary"
            >
              查看演示数据
            </Button>
            <span style={{ color: '#bbb', fontSize: 12, marginLeft: 8 }}>
              （演示数据不代表真实情况）
            </span>
          </div>
        </div>
      </ModulePage>
    );
  }

  // -------- Data state (with optional demo sections) ----------
  const lineData = trendData.length > 0
    ? trendData.map((item) => ({
        time: item.date,
        value: item.searchCount,
      }))
    : [];

  return (
    <ModulePage activeKey="overview" navItems={dashboardNav} title="首页大盘">
      {showDemo && (
        <div
          className="rag-panel"
          style={{
            background: '#fffbe6',
            border: '1px solid #ffe58f',
            textAlign: 'center',
            padding: '12px',
            marginBottom: 16,
          }}
        >
          ⚠️ 当前展示的是演示数据，不代表真实系统状态。
          <Button
            onClick={() => {
              setShowDemo(false);
              setStats(null);
              setPageState('error');
            }}
            size="small"
            style={{ marginLeft: 12 }}
          >
            关闭演示
          </Button>
        </div>
      )}

      <div className="dashboard-summary">
        {cards.map((card) => (
          <div className="metric-card rag-panel" key={card.title}>
            <div className="metric-icon">{card.icon}</div>
            <div>
              <div className="metric-title">{card.title}</div>
              <div className="metric-value">
                {card.value !== null ? card.value.toLocaleString() : '-'}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="dashboard-main">
        <div className="rag-panel dashboard-chart">
          <div className="panel-head">
            <h3>访问趋势</h3>
            <span style={{ color: '#999', fontSize: 13 }}>{range}</span>
          </div>
          {lineData.length > 0 ? (
            <Line
              data={lineData}
              height={300}
              point={{ sizeField: 3 }}
              shapeField="smooth"
              xField="time"
              yField="value"
            />
          ) : (
            <div style={{ textAlign: 'center', padding: '80px 0', color: '#999' }}>
              暂无趋势数据
            </div>
          )}
        </div>
        <div className="rag-panel dashboard-pie">
          <h3>文档分类占比</h3>
          {showDemo ? (
            <>
              <div className="pie-legend">
                {demoPieData.map((item) => (
                  <div key={item.type}>
                    <span>{item.type}</span>
                    <strong>{item.value.toLocaleString()}</strong>
                    <em>
                      {stats?.documentCount
                        ? ((item.value / stats.documentCount) * 100).toFixed(2)
                        : '-'}
                      %
                    </em>
                  </div>
                ))}
              </div>
              <div style={{ color: '#bbb', fontSize: 12, textAlign: 'center', marginTop: 8 }}>
                * 演示数据
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '80px 0', color: '#999' }}>
              暂无文档分类数据
            </div>
          )}
        </div>
      </div>

      <div className="rag-panel recent-panel">
        <div className="panel-head">
          <h3>近期操作记录</h3>
          {!showDemo && (
            <Button onClick={() => setShowDemo(true)} size="small" type="link">
              查看演示数据
            </Button>
          )}
        </div>
        {showDemo ? (
          <>
            <Table
              columns={operationColumns}
              dataSource={demoOperations}
              pagination={false}
              rowKey="id"
            />
            <div style={{ color: '#bbb', fontSize: 12, textAlign: 'right', padding: 8 }}>
              * 演示数据
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
            暂无操作记录
          </div>
        )}
      </div>
    </ModulePage>
  );
};

export default Dashboard;
