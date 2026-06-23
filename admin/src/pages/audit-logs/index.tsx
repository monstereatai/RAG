import {
  PageContainer,
  type ProColumns,
  ProTable,
} from '@ant-design/pro-components';
import React from 'react';
import { type AuditLog, getAuditLogs } from './service';

const AuditLogs: React.FC = () => {
  const columns: ProColumns<AuditLog>[] = [
    { title: '用户', dataIndex: 'username', width: 120 },
    { title: '操作', dataIndex: 'action', width: 120 },
    { title: '资源', dataIndex: 'resource', width: 150 },
    {
      title: '详情',
      dataIndex: 'detail',
      width: 250,
      search: false,
      ellipsis: true,
    },
    { title: 'IP', dataIndex: 'ip', width: 130, search: false },
    {
      title: '时间',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 180,
      search: false,
    },
  ];

  return (
    <PageContainer>
      <ProTable<AuditLog>
        headerTitle="审计日志"
        rowKey="id"
        request={async (params) => {
          const res = await getAuditLogs({
            current: params.current,
            pageSize: params.pageSize,
            userId: params.userId,
            action: params.action,
            resource: params.resource,
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
        options={{ density: true, fullScreen: true, reload: true }}
      />
    </PageContainer>
  );
};

export default AuditLogs;
