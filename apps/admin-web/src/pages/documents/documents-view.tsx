import {
  AppstoreOutlined,
  ReloadOutlined,
  SearchOutlined,
  TableOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Empty,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Skeleton,
  Space,
  Statistic,
  Table,
  Tag,
  Upload,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React from 'react';
import { documentNav, ModulePage } from '@/components/AdminShell';
import type { DocumentsController } from './documents-controller';
import { createDocumentColumns } from './documents-table';
import type {
  DocumentVersionItem,
  FailedDocumentTask,
  FailedIndexRepair,
  PendingDocumentTask,
} from './service';

export function DocumentsView({
  controller,
}: {
  controller: DocumentsController;
}) {
  const {
    scope,
    activeKey,
    emptyTitle,
    emptyDescription,
    isArchivePage,
    showOperationsPanel,
    docs,
    pageState,
    total,
    permissionDoc,
    setPermissionDoc,
    permissionSaving,
    versionDoc,
    setVersionDoc,
    versionItems,
    versionLoading,
    versionSaving,
    versionActionDocId,
    departmentFilter,
    setDepartmentFilter,
    userOptions,
    roleOptions,
    departmentOptions,
    uploading,
    operations,
    operationsLoading,
    operationsError,
    retryingTaskId,
    cancellingTaskId,
    retryingRepairId,
    reconciling,
    handleBeforeUpload,
    pagination,
    setPagination,
    permissionForm,
    versionForm,
    fetchDocs,
    fetchOperations,
    handleSavePermissions,
    handleCreateVersion,
    handlePromote,
    handleReview,
    handleRetryDocumentTask,
    handleCancelQueuedTask,
    handleRetryIndexRepair,
    handleRunReconciler,
    handleDeprecate,
    handleRollback,
  } = controller;
  const columns = createDocumentColumns(controller);

  const queueStatusLabels: Record<PendingDocumentTask['queueStatus'], string> =
    {
      waiting: '等待中',
      delayed: '延迟等待',
      paused: '已暂停',
      'waiting-children': '等待子任务',
    };

  return (
    <ModulePage activeKey={activeKey} navItems={documentNav} title="文档管理">
      <div className="rag-panel document-toolbar">
        <Input
          prefix={<SearchOutlined />}
          placeholder="搜索文档名称、内容、上传人等"
        />
        {!isArchivePage && (
          <>
            <Upload
              accept=".md,.markdown,.txt,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.json,.html,.htm,.jpg,.jpeg,.png,.gif,.webp,.bmp,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus,.mp4,.webm,.mov,.avi,.zip,.ts,.tsx,.js,.jsx,.mjs,.cjs,.py,.java,.go,.rs,.c,.h,.cc,.cpp,.hh,.hpp,.cs,.php,.rb,.swift,.kt,.kts,.scala,.sql,.sh,.bash,.zsh,.ps1,.bat,.vue,.svelte,.css,.scss,.less,.xml,.yaml,.yml,.toml,.ini,.gradle,.graphql,.gql,.proto,.dart,.lua,.r,.pl,.pm,.ex,.exs,.clj,.cljs,.cljc,.tf,.hcl,.dockerfile,text/plain"
              beforeUpload={handleBeforeUpload}
              multiple
              showUploadList={false}
            >
              <Button
                icon={<UploadOutlined />}
                loading={uploading}
                type="primary"
              >
                批量上传
              </Button>
            </Upload>
            <Button>新建文件夹</Button>
            <Select defaultValue="文件类型" options={[{ value: '文件类型' }]} />
            <Select defaultValue="解析状态" options={[{ value: '解析状态' }]} />
            {scope === 'department' ? (
              <Select
                allowClear
                onChange={(value) => {
                  setDepartmentFilter(value);
                  const nextPagination = { ...pagination, current: 1 };
                  setPagination(nextPagination);
                  fetchDocs(nextPagination);
                }}
                options={departmentOptions}
                placeholder="按部门筛选"
                showSearch={{ optionFilterProp: 'label' }}
                style={{ minWidth: 120 }}
                value={departmentFilter}
              />
            ) : (
              <Select
                defaultValue="权限范围"
                options={[{ value: '权限范围' }]}
              />
            )}
            <Button>更多筛选</Button>
          </>
        )}
        <Button
          icon={<ReloadOutlined />}
          onClick={() => fetchDocs()}
          type="text"
        />
      </div>
      {showOperationsPanel && (
        <Card
          className="rag-panel"
          extra={
            <Button
              icon={<ReloadOutlined />}
              loading={operationsLoading}
              onClick={() => void fetchOperations()}
            >
              刷新状态
            </Button>
          }
          title="入库与索引运维"
        >
          {operationsError && (
            <Alert
              title="运维状态暂不可用"
              description={operationsError}
              showIcon
              style={{ marginBottom: 16 }}
              type="error"
            />
          )}
          {operationsLoading && !operations && (
            <Skeleton active paragraph={{ rows: 4 }} />
          )}
          {operations && (
            <>
              <Row gutter={[16, 16]}>
                <Col xs={24} sm={12} lg={6}>
                  <Statistic
                    title="文档处理队列"
                    value={
                      operations.documentQueue.enabled ? '运行中' : '未启用'
                    }
                    styles={{
                      content: {
                        color: operations.documentQueue.enabled
                          ? '#389e0d'
                          : '#8c8c8c',
                      },
                    }}
                  />
                  <Space size={4} wrap>
                    <Tag>等待 {operations.documentQueue.waiting}</Tag>
                    <Tag color="processing">
                      处理中 {operations.documentQueue.active}
                    </Tag>
                    <Tag color="success">
                      完成 {operations.documentQueue.completed}
                    </Tag>
                    <Tag color="error">
                      失败 {operations.documentQueue.failed}
                    </Tag>
                  </Space>
                </Col>
                <Col xs={24} sm={12} lg={6}>
                  <Statistic
                    title="索引修复队列"
                    value={
                      operations.indexRepairQueue.enabled ? '运行中' : '未启用'
                    }
                    styles={{
                      content: {
                        color: operations.indexRepairQueue.enabled
                          ? '#389e0d'
                          : '#8c8c8c',
                      },
                    }}
                  />
                  <Space size={4} wrap>
                    <Tag>等待 {operations.indexRepairQueue.waiting}</Tag>
                    <Tag color="processing">
                      处理中 {operations.indexRepairQueue.active}
                    </Tag>
                    <Tag color="success">
                      完成 {operations.indexRepairQueue.completed}
                    </Tag>
                    <Tag color="error">
                      失败 {operations.indexRepairQueue.failed}
                    </Tag>
                  </Space>
                </Col>
                <Col xs={24} sm={12} lg={6}>
                  <Statistic
                    title="自动对账器"
                    value={
                      operations.indexReconciler.enabled ? '已启用' : '未启用'
                    }
                    styles={{
                      content: {
                        color: operations.indexReconciler.enabled
                          ? '#389e0d'
                          : '#8c8c8c',
                      },
                    }}
                  />
                  <div style={{ color: '#8c8c8c', marginTop: 4 }}>
                    {operations.indexReconciler.running
                      ? '正在对账'
                      : operations.indexReconciler.lastRunAt
                        ? `最近运行：${new Date(operations.indexReconciler.lastRunAt).toLocaleString()}`
                        : '尚未运行'}
                  </div>
                </Col>
                <Col xs={24} sm={12} lg={6}>
                  <Statistic
                    title="失败待处理"
                    value={
                      operations.failedDocumentTasks.length +
                      operations.failedIndexRepairs.length
                    }
                    styles={{
                      content: {
                        color:
                          operations.failedDocumentTasks.length +
                          operations.failedIndexRepairs.length
                            ? '#cf1322'
                            : '#389e0d',
                      },
                    }}
                  />
                  <Button
                    disabled={
                      !operations.indexReconciler.queueEnabled ||
                      operations.indexReconciler.running
                    }
                    loading={reconciling}
                    onClick={handleRunReconciler}
                    style={{ marginTop: 4 }}
                    type="primary"
                  >
                    立即运行索引对账
                  </Button>
                </Col>
              </Row>
              {operations.indexReconciler.lastError && (
                <Alert
                  title="最近一次对账失败"
                  description={operations.indexReconciler.lastError}
                  showIcon
                  style={{ marginTop: 16 }}
                  type="warning"
                />
              )}
              <Row gutter={[16, 16]} style={{ marginTop: 12 }}>
                <Col xs={24}>
                  <h4>待处理的入库任务</h4>
                  <Alert
                    title="仅可取消尚未开始的任务；处理中任务无法中断。"
                    showIcon
                    style={{ marginBottom: 12 }}
                    type="info"
                  />
                  <Table<PendingDocumentTask>
                    columns={
                      [
                        {
                          title: '文件',
                          dataIndex: 'filename',
                          ellipsis: true,
                        },
                        {
                          title: '队列状态',
                          dataIndex: 'queueStatus',
                          width: 140,
                          render: (value: PendingDocumentTask['queueStatus']) =>
                            queueStatusLabels[value] ?? value,
                        },
                        {
                          title: '创建时间',
                          dataIndex: 'createdAt',
                          width: 180,
                          render: (value: string) =>
                            value ? new Date(value).toLocaleString() : '—',
                        },
                        {
                          title: '操作',
                          width: 100,
                          render: (_, task) => (
                            <Button
                              danger
                              disabled={!operations.documentQueue.enabled}
                              loading={cancellingTaskId === task.id}
                              onClick={() => handleCancelQueuedTask(task)}
                              size="small"
                            >
                              取消任务
                            </Button>
                          ),
                        },
                      ] as ColumnsType<PendingDocumentTask>
                    }
                    dataSource={operations.pendingDocumentTasks ?? []}
                    locale={{
                      emptyText: (
                        <Empty
                          description={
                            operations.documentQueue.enabled
                              ? '没有待处理的入库任务'
                              : '文档队列未启用'
                          }
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                        />
                      ),
                    }}
                    pagination={{ pageSize: 5, hideOnSinglePage: true }}
                    rowKey="id"
                    size="small"
                  />
                </Col>
                <Col xs={24} xl={12}>
                  <h4>失败的入库任务</h4>
                  <Table<FailedDocumentTask>
                    columns={
                      [
                        {
                          title: '文件',
                          dataIndex: 'filename',
                          ellipsis: true,
                        },
                        {
                          title: '失败原因',
                          dataIndex: 'errorMessage',
                          ellipsis: true,
                          render: (value?: string | null) =>
                            value || '未提供原因',
                        },
                        {
                          title: '更新时间',
                          dataIndex: 'updatedAt',
                          width: 160,
                          render: (value?: string) =>
                            value ? new Date(value).toLocaleString() : '—',
                        },
                        {
                          title: '操作',
                          width: 90,
                          render: (_, task) => (
                            <Button
                              disabled={!operations.documentQueue.enabled}
                              loading={retryingTaskId === task.id}
                              onClick={() => void handleRetryDocumentTask(task)}
                              size="small"
                            >
                              重试
                            </Button>
                          ),
                        },
                      ] as ColumnsType<FailedDocumentTask>
                    }
                    dataSource={operations.failedDocumentTasks}
                    locale={{
                      emptyText: (
                        <Empty
                          description="没有失败的入库任务"
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                        />
                      ),
                    }}
                    pagination={{ pageSize: 5, hideOnSinglePage: true }}
                    rowKey="id"
                    size="small"
                  />
                </Col>
                <Col xs={24} xl={12}>
                  <h4>失败的索引修复</h4>
                  <Table<FailedIndexRepair>
                    columns={
                      [
                        {
                          title: '文档 ID',
                          dataIndex: 'docId',
                          ellipsis: true,
                        },
                        {
                          title: '失败原因',
                          dataIndex: 'failedReason',
                          ellipsis: true,
                          render: (value?: string | null) =>
                            value || '未提供原因',
                        },
                        {
                          title: '尝试次数',
                          dataIndex: 'attemptsMade',
                          width: 90,
                        },
                        {
                          title: '操作',
                          width: 90,
                          render: (_, repair) => (
                            <Button
                              disabled={!operations.indexRepairQueue.enabled}
                              loading={retryingRepairId === repair.id}
                              onClick={() =>
                                void handleRetryIndexRepair(repair)
                              }
                              size="small"
                            >
                              重试
                            </Button>
                          ),
                        },
                      ] as ColumnsType<FailedIndexRepair>
                    }
                    dataSource={operations.failedIndexRepairs}
                    locale={{
                      emptyText: (
                        <Empty
                          description="没有失败的索引修复"
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                        />
                      ),
                    }}
                    pagination={{ pageSize: 5, hideOnSinglePage: true }}
                    rowKey="id"
                    size="small"
                  />
                </Col>
              </Row>
            </>
          )}
        </Card>
      )}
      <div className="view-switch">
        <Button icon={<TableOutlined />} type="primary" />
        <Button icon={<AppstoreOutlined />} />
      </div>
      <div className="rag-panel document-table">
        {pageState === 'loading' && <Skeleton active paragraph={{ rows: 8 }} />}
        {pageState === 'error' && (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <h3>加载失败</h3>
            <p style={{ color: '#999', margin: '12px 0 24px' }}>
              无法获取文档列表，请确认服务正常运行。
            </p>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => fetchDocs()}
              type="primary"
            >
              重新加载
            </Button>
          </div>
        )}
        {pageState === 'empty' && (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <h3>{emptyTitle}</h3>
            <p style={{ color: '#999', margin: '12px 0' }}>
              {emptyDescription}
            </p>
            {!isArchivePage && (
              <Upload
                accept=".md,.markdown,.txt,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.json,.html,.htm,.jpg,.jpeg,.png,.gif,.webp,.bmp,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus,.mp4,.webm,.mov,.avi,.zip,.ts,.tsx,.js,.jsx,.mjs,.cjs,.py,.java,.go,.rs,.c,.h,.cc,.cpp,.hh,.hpp,.cs,.php,.rb,.swift,.kt,.kts,.scala,.sql,.sh,.bash,.zsh,.ps1,.bat,.vue,.svelte,.css,.scss,.less,.xml,.yaml,.yml,.toml,.ini,.gradle,.graphql,.gql,.proto,.dart,.lua,.r,.pl,.pm,.ex,.exs,.clj,.cljs,.cljc,.tf,.hcl,.dockerfile,text/plain"
                beforeUpload={handleBeforeUpload}
                showUploadList={false}
              >
                <Button
                  icon={<UploadOutlined />}
                  loading={uploading}
                  type="primary"
                >
                  上传文档
                </Button>
              </Upload>
            )}
          </div>
        )}
        {pageState === 'data' && (
          <Table
            columns={columns}
            dataSource={docs}
            scroll={{ x: 1400, y: 'calc(100vh - 470px)' }}
            pagination={{
              current: pagination.current,
              pageSize: pagination.pageSize,
              total,
              showSizeChanger: true,
              pageSizeOptions: [10, 20, 50],
              onChange: (current, pageSize) => {
                const nextPagination = { current, pageSize };
                setPagination(nextPagination);
                fetchDocs(nextPagination);
              },
            }}
            rowKey="id"
          />
        )}
      </div>
      <Modal
        confirmLoading={permissionSaving}
        destroyOnHidden
        onCancel={() => setPermissionDoc(null)}
        onOk={handleSavePermissions}
        open={!!permissionDoc}
        title="配置文档权限"
        width={620}
      >
        <p className="permission-doc-title">{permissionDoc?.filename}</p>
        <Form form={permissionForm} layout="vertical" preserve={false}>
          <Form.List name="permissions">
            {(fields, { add, remove }) => (
              <div className="document-permission-list">
                {fields.map((field) => (
                  <Space align="baseline" key={field.key}>
                    <Form.Item
                      {...field}
                      name={[field.name, 'subjectType']}
                      rules={[{ required: true, message: '请选择主体类型' }]}
                    >
                      <Select
                        options={[
                          { label: '用户', value: 'user' },
                          { label: '角色', value: 'role' },
                          { label: '部门', value: 'department' },
                          { label: '公开', value: 'public' },
                        ]}
                        style={{ width: 116 }}
                      />
                    </Form.Item>
                    <Form.Item
                      noStyle
                      shouldUpdate={(prev, next) =>
                        prev.permissions?.[field.name]?.subjectType !==
                        next.permissions?.[field.name]?.subjectType
                      }
                    >
                      {({ getFieldValue }) => {
                        const type = getFieldValue([
                          'permissions',
                          field.name,
                          'subjectType',
                        ]);
                        const options =
                          type === 'user'
                            ? userOptions
                            : type === 'role'
                              ? roleOptions
                              : type === 'department'
                                ? departmentOptions
                                : [];
                        return (
                          <Form.Item
                            {...field}
                            name={[field.name, 'subjectId']}
                            rules={[
                              {
                                required: type !== 'public',
                                message: '请输入主体 ID',
                              },
                            ]}
                          >
                            {type === 'user' ||
                            type === 'role' ||
                            type === 'department' ? (
                              <Select
                                disabled={type === 'public'}
                                options={options}
                                placeholder={
                                  type === 'user'
                                    ? '选择用户'
                                    : type === 'role'
                                      ? '选择角色'
                                      : '选择部门'
                                }
                                showSearch={{ optionFilterProp: 'label' }}
                                style={{ width: 280 }}
                              />
                            ) : (
                              <Input
                                disabled={type === 'public'}
                                placeholder={
                                  type === 'public'
                                    ? '全部用户可读'
                                    : '输入部门 ID'
                                }
                                style={{ width: 280 }}
                              />
                            )}
                          </Form.Item>
                        );
                      }}
                    </Form.Item>
                    <Button onClick={() => remove(field.name)} type="link">
                      删除
                    </Button>
                  </Space>
                ))}
                <Button
                  onClick={() => add({ subjectType: 'user', scope: 'read' })}
                >
                  添加权限主体
                </Button>
              </div>
            )}
          </Form.List>
        </Form>
      </Modal>
      <Modal
        destroyOnHidden
        onCancel={() => setVersionDoc(null)}
        onOk={handleCreateVersion}
        confirmLoading={versionSaving}
        open={!!versionDoc}
        title="版本治理"
        width={820}
      >
        <p>当前文档：{versionDoc?.filename}</p>
        <Table
          loading={versionLoading}
          size="small"
          pagination={false}
          rowKey="docId"
          dataSource={versionItems}
          columns={
            [
              { title: '版本', dataIndex: 'docVersion' },
              { title: '状态', dataIndex: 'lifecycleStatus' },
              {
                title: '审核',
                dataIndex: 'reviewStatus',
                render: (value: string) => (
                  <Tag
                    color={
                      value === 'approved'
                        ? 'green'
                        : value === 'rejected'
                          ? 'red'
                          : 'orange'
                    }
                  >
                    {value || 'approved'}
                  </Tag>
                ),
              },
              { title: '生效时间', dataIndex: 'effectiveAt' },
              { title: '创建时间', dataIndex: 'createdAt' },
              {
                title: '操作',
                render: (_: unknown, item: DocumentVersionItem) => {
                  if (item.lifecycleStatus === 'effective') {
                    return <Tag color="success">当前生效</Tag>;
                  }
                  if (item.lifecycleStatus === 'deprecated') {
                    return (
                      <Button
                        loading={versionActionDocId === item.docId}
                        onClick={() => handleRollback(item)}
                        size="small"
                      >
                        回滚到此版本
                      </Button>
                    );
                  }
                  return (
                    <Space size={4}>
                      {item.reviewStatus === 'approved' ? (
                        <Button
                          loading={versionActionDocId === item.docId}
                          onClick={() => handlePromote(item)}
                          size="small"
                          type="primary"
                        >
                          设为生效
                        </Button>
                      ) : item.reviewStatus === 'pending_review' ? (
                        <Button
                          loading={versionActionDocId === item.docId}
                          onClick={() => handleReview(item, 'approve')}
                          size="small"
                          type="primary"
                        >
                          审核通过
                        </Button>
                      ) : (
                        <Button
                          loading={versionActionDocId === item.docId}
                          onClick={() => handleReview(item, 'submit')}
                          size="small"
                          type="primary"
                        >
                          提交审核
                        </Button>
                      )}
                      {item.reviewStatus === 'pending_review' && (
                        <Button
                          loading={versionActionDocId === item.docId}
                          danger
                          onClick={() => handleReview(item, 'reject')}
                          size="small"
                        >
                          驳回
                        </Button>
                      )}
                      <Button
                        disabled={versionActionDocId === item.docId}
                        onClick={() => handleDeprecate(item)}
                        size="small"
                      >
                        废弃
                      </Button>
                    </Space>
                  );
                },
              },
            ] as ColumnsType<DocumentVersionItem>
          }
        />
        <Form form={versionForm} layout="vertical" style={{ marginTop: 20 }}>
          <Form.Item
            label="新版本号"
            name="docVersion"
            rules={[{ required: true, message: '请输入版本号' }]}
          >
            <Input placeholder="例如 v2.0" />
          </Form.Item>
          <Form.Item label="新文件名" name="filename">
            <Input />
          </Form.Item>
          <Form.Item label="生效时间" name="effectiveAt">
            <Input placeholder="例如 2026-08-12" />
          </Form.Item>
          <Form.Item label="过期时间" name="expiredAt">
            <Input placeholder="例如 2026-09-30；不填可按正文有效期或默认继承" />
          </Form.Item>
          <Form.Item label="规则有效期（月）" name="validityMonths">
            <Input
              type="number"
              min={1}
              max={120}
              placeholder="例如 3；留空则使用显式日期或正文有效期"
            />
          </Form.Item>
          <Form.Item label="变更语义" name="changeType" initialValue="amend">
            <Select
              options={[
                { value: 'supplement', label: '补充：旧规则继续有效' },
                { value: 'amend', label: '修订：截止旧规则并新增版本' },
                { value: 'replace', label: '替代：整段旧规则退役' },
                { value: 'deprecate', label: '废止：只截止旧规则' },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="增量更新"
            name="incremental"
            valuePropName="checked"
          >
            <Checkbox>
              同一 docId，只重算新增/变化 chunk；保留历史规则有效期
            </Checkbox>
          </Form.Item>
          <Form.Item
            label="新规范正文"
            name="content"
            rules={[{ required: true, message: '请输入新规范正文' }]}
          >
            <Input.TextArea
              rows={8}
              placeholder="粘贴最新规范内容。勾选增量更新时只重算新增/变化 chunk。"
            />
          </Form.Item>
        </Form>
      </Modal>
    </ModulePage>
  );
}
