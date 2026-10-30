import {
  DownloadOutlined,
  EyeOutlined,
  FileDoneOutlined,
  FileExcelOutlined,
  FilePdfOutlined,
  FilePptOutlined,
  FileWordOutlined,
  HistoryOutlined,
  LockOutlined,
  MoreOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { Button, Checkbox, Space, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React from 'react';
import type { DocumentsController } from './documents-controller';
import type { DocumentItem } from './service';

export function createDocumentColumns(
  controller: DocumentsController,
): ColumnsType<DocumentItem> {
  const {
    isArchivePage,
    archiveActionDocId,
    departmentOptions,
    openPermissionModal,
    openVersionModal,
    handleArchive,
    handleUnarchive,
  } = controller;
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
  const graphStatusMap: Record<string, { color: string; text: string }> = {
    pending: { color: 'processing', text: '构建中' },
    indexed: { color: 'green', text: '已入图谱' },
    failed: { color: 'error', text: '构建失败' },
    skipped: { color: 'default', text: '未启用' },
  };
  return [
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
          <span>{record.metadata?.title || record.filename}</span>
        </Space>
      ),
    },
    {
      title: '文件类型',
      dataIndex: 'fileType',
      width: 120,
      render: (value) => String(value).toUpperCase(),
    },
    { title: '上传时间', dataIndex: 'createdAt', width: 190 },
    { title: '上传人', dataIndex: 'uploadedBy', width: 130 },
    {
      title: '文档解析状态',
      dataIndex: 'status',
      width: 150,
      render: (value, record) => {
        const status =
          value ?? (record.chunkCount > 0 ? 'completed' : 'pending');
        const item = statusMap[status] ?? statusMap.pending;
        return <Tag color={item.color}>{item.text}</Tag>;
      },
    },
    {
      title: '版本状态',
      width: 180,
      render: (_, record) => (
        <Space size={4}>
          <Tag
            color={record.lifecycleStatus === 'effective' ? 'green' : 'default'}
          >
            {record.docVersion || '未标注版本'}
          </Tag>
          <Tag>{record.lifecycleStatus || 'confirmed'}</Tag>
          <Tag
            color={
              record.reviewStatus === 'approved'
                ? 'green'
                : record.reviewStatus === 'rejected'
                  ? 'red'
                  : 'orange'
            }
          >
            {record.reviewStatus || 'approved'}
          </Tag>
        </Space>
      ),
    },
    {
      title: '权限范围',
      width: 180,
      render: (_, record) => {
        const departmentNameMap = new Map(
          departmentOptions.map((option) => [option.value, option.label]),
        );
        const tags: React.ReactNode[] = [];
        const hasPublic = record.permissions?.some(
          (permission) => permission.subjectType === 'public',
        );
        if (hasPublic) {
          tags.push(
            <Tag color="cyan" key="public">
              公共
            </Tag>,
          );
        }
        record.permissions
          ?.filter((permission) => permission.subjectType === 'department')
          .forEach((permission) => {
            tags.push(
              <Tag color="blue" key={`department-${permission.subjectId}`}>
                {departmentNameMap.get(permission.subjectId) ??
                  permission.subjectId}
              </Tag>,
            );
          });
        if (tags.length === 0) {
          tags.push(
            <Tag key="restricted">
              {record.permissions && record.permissions.length > 0
                ? '受限'
                : '未配置'}
            </Tag>,
          );
        }
        if (record.metadata?.category) {
          tags.push(<Tag key="category">{record.metadata.category}</Tag>);
        }
        return (
          <Space size={4} wrap>
            {tags}
          </Space>
        );
      },
    },
    {
      title: 'Obsidian',
      width: 150,
      render: (_, record) =>
        record.obsidianStatus === 'linked' ? (
          <Tooltip title={record.obsidianPath}>
            <Tag color="green">已关联</Tag>
          </Tooltip>
        ) : (
          <Tag>未关联</Tag>
        ),
    },
    {
      title: '图谱',
      width: 130,
      render: (_, record) => {
        const graph = graphStatusMap[record.graphIndexStatus ?? 'skipped'];
        return record.graphIndexError ? (
          <Tooltip title={record.graphIndexError}>
            <Tag color={graph.color}>{graph.text}</Tag>
          </Tooltip>
        ) : (
          <Tag color={graph.color}>{graph.text}</Tag>
        );
      },
    },
    {
      title: '三路发布',
      width: 220,
      render: (_, record) =>
        record.indexPipeline ? (
          <Space size={2} wrap>
            {(['rag', 'es', 'graph'] as const).map((key) => {
              const item = record.indexPipeline?.[key];
              const state = graphStatusMap[item?.status ?? 'skipped'];
              return (
                <Tag key={key} color={state.color}>
                  {key === 'rag' ? 'RAG' : key === 'es' ? 'ES' : 'Neo4j'}：
                  {state.text}
                </Tag>
              );
            })}
          </Space>
        ) : (
          <Tag>暂无</Tag>
        ),
    },
    {
      title: '操作',
      fixed: 'right',
      width: 190,
      render: (_, record) =>
        isArchivePage ? (
          <Space size="middle">
            <EyeOutlined />
            <DownloadOutlined />
            <Button
              icon={<UndoOutlined />}
              loading={archiveActionDocId === record.id}
              onClick={() => handleUnarchive(record)}
              size="small"
              type="text"
            >
              恢复
            </Button>
          </Space>
        ) : (
          <Space size="middle">
            <EyeOutlined />
            <DownloadOutlined />
            <Button
              icon={<LockOutlined />}
              onClick={() => openPermissionModal(record)}
              size="small"
              type="text"
            />
            <Button
              icon={<HistoryOutlined />}
              onClick={() => openVersionModal(record)}
              size="small"
              type="text"
            >
              版本治理
            </Button>
            {(record.lifecycleStatus === 'effective' ||
              record.lifecycleStatus === 'confirmed') && (
              <Tooltip title="归档">
                <Button
                  icon={<FileDoneOutlined />}
                  loading={archiveActionDocId === record.id}
                  onClick={() => handleArchive(record)}
                  size="small"
                  type="text"
                />
              </Tooltip>
            )}
            <MoreOutlined />
          </Space>
        ),
    },
  ];
}
