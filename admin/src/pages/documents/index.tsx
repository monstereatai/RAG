import {
  AppstoreOutlined,
  DownloadOutlined,
  EyeOutlined,
  FilePdfOutlined,
  FilePptOutlined,
  FileWordOutlined,
  FileExcelOutlined,
  MoreOutlined,
  ReloadOutlined,
  SearchOutlined,
  TableOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { ModulePage, documentNav } from '@/components/AdminShell';
import { Button, Checkbox, Input, Select, Skeleton, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React, { useEffect, useState } from 'react';
import { getDocuments, getUsers, type DocumentItem } from './service';

type PageState = 'loading' | 'data' | 'error' | 'empty';

const iconMap: Record<string, React.ReactNode> = {
  pdf: <FilePdfOutlined className="file-icon pdf" />,
  docx: <FileWordOutlined className="file-icon word" />,
  xlsx: <FileExcelOutlined className="file-icon excel" />,
  pptx: <FilePptOutlined className="file-icon ppt" />,
};

const statusMap: Record<string, { color: string; text: string }> = {
  pending: { color: 'default', text: '待处理' },
  processing: { color: 'warning', text: '解析中' },
  completed: { color: 'success', text: '已入库' },
  failed: { color: 'error', text: '解析失败' },
};

const Documents: React.FC = () => {
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [pageState, setPageState] = useState<PageState>('loading');
  const [total, setTotal] = useState(0);

  const fetchDocs = () => {
    setPageState('loading');
    Promise.all([
      getDocuments({ current: 1, pageSize: 20 }),
      getUsers(),
    ])
      .then(([docRes, userRes]: [any, any]) => {
        const raw = docRes?.data ?? docRes;
        const items = raw?.data?.items ?? (Array.isArray(raw) ? raw : []);
        const rawTotal = raw?.data?.total ?? raw?.total ?? (Array.isArray(items) ? items.length : 0);

        const userRaw = userRes?.data ?? userRes;
        const userList = userRaw?.data?.items ?? (Array.isArray(userRaw) ? userRaw : []);
        const userMap = new Map<string, string>();
        if (Array.isArray(userList)) {
          userList.forEach((u: any) => {
            userMap.set(String(u.id), u.username ?? u.nickname ?? String(u.id));
          });
        }

        if (Array.isArray(items) && items.length > 0) {
          setDocs(
            items.map((item: any) => ({
              id: item.docId,
              filename: item.filename,
              fileType: (item.filename ?? '').split('.').pop() ?? '',
              fileSize: 0,
              chunkCount: item.chunkCount ?? 0,
              uploadedBy: userMap.get(String(item.userId)) ?? item.userId ?? '',
              createdAt: item.createdAt,
              updatedAt: item.createdAt,
              metadata: { category: item.category, title: item.title },
            })),
          );
          setTotal(Number(rawTotal) || items.length);
          setPageState('data');
        } else {
          setPageState('empty');
        }
      })
      .catch(() => {
        setPageState('error');
      });
  };

  useEffect(() => {
    fetchDocs();
  }, []);

  const columns: ColumnsType<DocumentItem> = [
    {
      title: <Checkbox />,
      width: 48,
      render: () => <Checkbox />,
    },
    {
      title: '文档名称',
      dataIndex: 'filename',
      render: (_, record) => (
        <Space size={12}>
          {iconMap[record.fileType] ?? iconMap.pdf}
          <span>{record.filename}</span>
        </Space>
      ),
    },
    { title: '文件类型', dataIndex: 'fileType', width: 120, render: (value) => String(value).toUpperCase() },
    { title: '上传时间', dataIndex: 'createdAt', width: 190 },
    { title: '上传人', dataIndex: 'uploadedBy', width: 130 },
    {
      title: '文档解析状态',
      dataIndex: 'status',
      width: 150,
      render: (value, record) => {
        const status = value ?? (record.chunkCount > 0 ? 'completed' : 'pending');
        const item = statusMap[status] ?? statusMap.pending;
        return <Tag color={item.color}>{item.text}</Tag>;
      },
    },
    {
      title: '权限范围',
      width: 150,
      render: (_, record) => <Tag color="blue">{record.metadata?.category ?? '部门可见'}</Tag>,
    },
    {
      title: '操作',
      width: 150,
      render: () => (
        <Space size="middle">
          <EyeOutlined />
          <DownloadOutlined />
          <MoreOutlined />
        </Space>
      ),
    },
  ];

  return (
    <ModulePage activeKey="mine" navItems={documentNav} title="文档管理">
      <div className="rag-panel document-toolbar">
        <Input prefix={<SearchOutlined />} placeholder="搜索文档名称、内容、上传人等" />
        <Button icon={<UploadOutlined />} type="primary">批量上传</Button>
        <Button>新建文件夹</Button>
        <Select defaultValue="文件类型" options={[{ value: '文件类型' }]} />
        <Select defaultValue="解析状态" options={[{ value: '解析状态' }]} />
        <Select defaultValue="权限范围" options={[{ value: '权限范围' }]} />
        <Button>更多筛选</Button>
        <Button icon={<ReloadOutlined />} onClick={fetchDocs} type="text" />
      </div>
      <div className="view-switch">
        <Button icon={<TableOutlined />} type="primary" />
        <Button icon={<AppstoreOutlined />} />
      </div>
      <div className="rag-panel document-table">
        {pageState === 'loading' && (
          <Skeleton active paragraph={{ rows: 8 }} />
        )}
        {pageState === 'error' && (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <h3>加载失败</h3>
            <p style={{ color: '#999', margin: '12px 0 24px' }}>
              无法获取文档列表，请确认服务正常运行。
            </p>
            <Button icon={<ReloadOutlined />} onClick={fetchDocs} type="primary">
              重新加载
            </Button>
          </div>
        )}
        {pageState === 'empty' && (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <h3>暂无文档</h3>
            <p style={{ color: '#999', margin: '12px 0' }}>
              知识库还没有文档，请上传文档开始使用。
            </p>
            <Button icon={<UploadOutlined />} type="primary">上传文档</Button>
          </div>
        )}
        {pageState === 'data' && (
          <Table
            columns={columns}
            dataSource={docs}
            pagination={{ pageSize: 10, total }}
            rowKey="id"
          />
        )}
      </div>
    </ModulePage>
  );
};

export default Documents;
