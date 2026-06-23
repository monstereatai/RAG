import {
  DeleteOutlined,
  EyeOutlined,
  FileTextOutlined,
  RedoOutlined,
} from '@ant-design/icons';
import {
  PageContainer,
  type ProColumns,
  ProTable,
} from '@ant-design/pro-components';
import { history } from '@umijs/max';
import { Button, Modal, message, Space, Typography } from 'antd';
import React from 'react';
import {
  type DocumentItem,
  deleteDocument,
  getDocuments,
  reprocessDocument,
} from './service';

const { Link } = Typography;

const statusMap: Record<string, { color: string; text: string }> = {
  pending: { color: 'default', text: '待处理' },
  processing: { color: 'processing', text: '处理中' },
  completed: { color: 'success', text: '已完成' },
  failed: { color: 'error', text: '失败' },
};

const Documents: React.FC = () => {
  const actionRef = React.useRef<any>(undefined);

  const handleDelete = (record: DocumentItem) => {
    Modal.confirm({
      title: `确认删除文档「${record.filename}」？`,
      content: '删除后将从向量库中移除所有关联数据，不可恢复。',
      okText: '确认删除',
      okType: 'danger',
      onOk: async () => {
        await deleteDocument(record.id);
        message.success('删除成功');
        actionRef.current?.reload();
      },
    });
  };

  const handleReprocess = async (record: DocumentItem) => {
    await reprocessDocument(record.id);
    message.success('已提交重新处理');
    actionRef.current?.reload();
  };

  const columns: ProColumns<DocumentItem>[] = [
    {
      title: '文件名',
      dataIndex: 'filename',
      ellipsis: true,
      width: 240,
      render: (_, record) => (
        <Space>
          <FileTextOutlined />
          <Link>{record.filename}</Link>
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'fileType',
      width: 80,
      valueEnum: {
        pdf: 'PDF',
        md: 'Markdown',
        txt: 'TXT',
        docx: 'DOCX',
      },
    },
    {
      title: '大小',
      dataIndex: 'fileSize',
      width: 100,
      search: false,
      render: (_, record) => {
        const kb = record.fileSize / 1024;
        return kb > 1024
          ? `${(kb / 1024).toFixed(1)} MB`
          : `${kb.toFixed(1)} KB`;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      valueEnum: Object.fromEntries(
        Object.entries(statusMap).map(([k, v]) => [
          k,
          {
            text: v.text,
            status:
              v.color === 'success'
                ? 'Success'
                : v.color === 'error'
                  ? 'Error'
                  : v.color === 'processing'
                    ? 'Processing'
                    : 'Default',
          },
        ]),
      ),
    },
    {
      title: '分块数',
      dataIndex: 'chunkCount',
      width: 80,
      search: false,
    },
    {
      title: '上传者',
      dataIndex: 'uploadedBy',
      width: 100,
    },
    {
      title: '上传时间',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 180,
      search: false,
    },
    {
      title: '操作',
      valueType: 'option',
      width: 120,
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => history.push(`/documents/${record.id}`)}
          >
            详情
          </Button>
          <Button
            type="link"
            size="small"
            icon={<RedoOutlined />}
            onClick={() => handleReprocess(record)}
          >
            重新处理
          </Button>
          <Button
            type="link"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(record)}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <PageContainer>
      <ProTable<DocumentItem>
        headerTitle="文档列表"
        actionRef={actionRef}
        rowKey="id"
        request={async (params) => {
          const res = await getDocuments({
            current: params.current,
            pageSize: params.pageSize,
            filename: params.filename,
            status: params.status,
            fileType: params.fileType,
          });
          const data = (res as any)?.data ?? res;
          return {
            data: Array.isArray(data) ? data : (data?.list ?? []),
            total: (data as any)?.total ?? 0,
            success: true,
          };
        }}
        columns={columns}
        search={{ labelWidth: 'auto' }}
        pagination={{ defaultPageSize: 10 }}
      />
    </PageContainer>
  );
};

export default Documents;
