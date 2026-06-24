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
import { Button, Checkbox, Input, Select, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React, { useEffect, useState } from 'react';
import { getDocuments, getUsers, type DocumentItem } from './service';

const fallbackDocs: DocumentItem[] = [
  ['1', '2024年产品需求文档.pdf', 'pdf', '张三', 'completed', '仅本人可见', '2024-05-20 14:30:22'],
  ['2', '企业知识库使用手册.docx', 'docx', '李四', 'completed', '部门可见', '2024-05-20 11:20:15'],
  ['3', 'Q2市场数据分析报告.xlsx', 'xlsx', '王五', 'completed', '部门可见', '2024-05-19 16:45:30'],
  ['4', '新员工入职培训.pptx', 'pptx', '赵六', 'processing', '公司可见', '2024-05-19 09:15:45'],
  ['5', '信息安全管理制度.pdf', 'pdf', '张三', 'completed', '公司可见', '2024-05-18 17:20:33'],
  ['6', '项目管理流程规范.docx', 'docx', '李四', 'failed', '部门可见', '2024-05-18 10:05:12'],
  ['7', '客户服务协议模板.pdf', 'pdf', '王五', 'completed', '公开可见', '2024-05-17 15:30:25'],
  ['8', '年度预算计划表.xlsx', 'xlsx', '赵六', 'completed', '仅本人可见', '2024-05-17 11:10:08'],
].map(([id, filename, fileType, uploadedBy, status, permission, createdAt]) => ({
  id,
  filename,
  fileType,
  fileSize: 1024 * 128,
  uploadedBy,
  status: status as DocumentItem['status'],
  chunkCount: 32,
  createdAt,
  updatedAt: createdAt,
  metadata: { category: permission },
}));

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
  const [docs, setDocs] = useState<DocumentItem[]>(fallbackDocs);

  useEffect(() => {
    Promise.all([
      getDocuments({ current: 1, pageSize: 20 }),
      getUsers(),
    ])
      .then(([docRes, userRes]: [any, any]) => {
        const raw = docRes?.data ?? docRes;
        const items = raw?.data?.items ?? (Array.isArray(raw) ? raw : []);

        const userRaw = userRes?.data ?? userRes;
        const userList = userRaw?.data?.items ?? (Array.isArray(userRaw) ? userRaw : []);
        const userMap = new Map<string, string>();
        if (Array.isArray(userList)) {
          userList.forEach((u: any) => {
            userMap.set(String(u.id), u.username ?? u.nickname ?? String(u.id));
          });
        }

        if (Array.isArray(items) && items.length) {
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
        }
      })
      .catch(() => setDocs(fallbackDocs));
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
        <Button icon={<ReloadOutlined />} type="text" />
      </div>
      <div className="view-switch">
        <Button icon={<TableOutlined />} type="primary" />
        <Button icon={<AppstoreOutlined />} />
      </div>
      <div className="rag-panel document-table">
        <Table columns={columns} dataSource={docs} pagination={{ pageSize: 10, total: 128 }} rowKey="id" />
      </div>
    </ModulePage>
  );
};

export default Documents;
