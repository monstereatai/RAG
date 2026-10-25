import {
  AppstoreOutlined,
  FileDoneOutlined,
  DownloadOutlined,
  EyeOutlined,
  FilePdfOutlined,
  FilePptOutlined,
  FileWordOutlined,
  FileExcelOutlined,
  LockOutlined,
  HistoryOutlined,
  MoreOutlined,
  ReloadOutlined,
  SearchOutlined,
  TableOutlined,
  UndoOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { ModulePage, documentNav } from '@/components/AdminShell';
import { Alert, Button, Card, Checkbox, Col, Empty, Form, Input, Modal, Row, Select, Skeleton, Space, Statistic, Table, Tag, Tooltip, Upload, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React, { useCallback, useEffect, useState } from 'react';
import {
  getDocuments,
  getDocumentOperations,
  getOrganizations,
  getRoles,
  getUsers,
  updateDocumentPermissions,
  getDocumentVersions,
  createDocumentVersion,
  incrementalUpdateDocument,
  promoteDocumentVersion,
  updateDocumentLifecycle,
  rollbackDocumentVersion,
  submitDocumentReview,
  approveDocumentReview,
  rejectDocumentReview,
  retryFailedDocumentTask,
  cancelQueuedDocumentTask,
  retryIndexRepair,
  runIndexReconciler,
  uploadDocument,
  getDocumentTask,
  archiveDocument,
  unarchiveDocument,
  type DocumentItem,
  type DocumentVersionItem,
  type DocumentPermissionInput,
  type DocumentOperations,
  type FailedDocumentTask,
  type PendingDocumentTask,
  type FailedIndexRepair,
} from './service';

type PageState = 'loading' | 'data' | 'error' | 'empty';

/** 修复历史数据中 UTF-8 被按 Latin-1 解码后形成的常见中文乱码。 */
const repairMojibake = (value?: string | null): string => {
  if (!value) return '';
  if (!/[ÃÂâðåæçèéêëìíîïñòóôõö÷øùúûüýþÿ]/.test(value)) return value;
  try {
    const bytes = Uint8Array.from(value, (character) => character.charCodeAt(0) & 0xff);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return value;
  }
};

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

const queueStatusLabels: Record<PendingDocumentTask['queueStatus'], string> = {
  waiting: '等待中',
  delayed: '延迟等待',
  paused: '已暂停',
  'waiting-children': '等待子任务',
};

const unwrapResponseData = (value: any) => {
  let payload = value;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!payload || typeof payload !== 'object' || !('data' in payload)) break;
    payload = payload.data;
  }
  return payload;
};

export interface DocumentListPageProps {
  /** 按权限主体过滤：public=公共文档，department=部门文档；不传为全部（我的文档） */
  scope?: 'public' | 'department';
  /** 按生命周期状态过滤，如 'archived'（文档归档页） */
  lifecycleStatus?: string;
  /** 侧边菜单高亮 key */
  activeKey?: string;
  emptyTitle?: string;
  emptyDescription?: string;
}

const Documents: React.FC<DocumentListPageProps> = ({
  scope,
  lifecycleStatus,
  activeKey = 'mine',
  emptyTitle = '暂无文档',
  emptyDescription = '知识库还没有文档，请上传文档开始使用。',
}) => {
  /**
   * 文档治理列表复用页：通过 scope／lifecycleStatus 切换「我的／公共／部门／归档」视图，
   * 因此数据加载必须同时刷新权限候选项，避免用上一视图的组织或角色数据提交授权。
   */
  const isArchivePage = lifecycleStatus === 'archived';
  const showOperationsPanel = !scope && !lifecycleStatus;
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [pageState, setPageState] = useState<PageState>('loading');
  const [total, setTotal] = useState(0);
  const [permissionDoc, setPermissionDoc] = useState<DocumentItem | null>(null);
  const [permissionSaving, setPermissionSaving] = useState(false);
  const [versionDoc, setVersionDoc] = useState<DocumentItem | null>(null);
  const [versionItems, setVersionItems] = useState<DocumentVersionItem[]>([]);
  const [versionLoading, setVersionLoading] = useState(false);
  const [versionSaving, setVersionSaving] = useState(false);
  const [versionActionDocId, setVersionActionDocId] = useState<string>();
  const [archiveActionDocId, setArchiveActionDocId] = useState<string>();
  const [departmentFilter, setDepartmentFilter] = useState<string>();
  const [userOptions, setUserOptions] = useState<{ label: string; value: string }[]>([]);
  const [roleOptions, setRoleOptions] = useState<{ label: string; value: string }[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<
    { label: string; value: string }[]
  >([]);
  const [uploading, setUploading] = useState(false);
  const [operations, setOperations] = useState<DocumentOperations | null>(null);
  const [operationsLoading, setOperationsLoading] = useState(false);
  const [operationsError, setOperationsError] = useState<string>();
  const [retryingTaskId, setRetryingTaskId] = useState<string>();
  const [cancellingTaskId, setCancellingTaskId] = useState<string>();
  const [retryingRepairId, setRetryingRepairId] = useState<string>();
  const [reconciling, setReconciling] = useState(false);

  const handleBeforeUpload = async (file: File) => {
    setUploading(true);
    try {
      const result = await uploadDocument(file);
      const payload = (result as any)?.data ?? result;
      if (payload?.taskId) {
        message.info(`${file.name} 已进入解析队列`);
        for (let attempt = 0; attempt < 60; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          const taskResult = await getDocumentTask(String(payload.taskId));
          const task = (taskResult as any)?.data ?? taskResult;
          if (task?.status === 'completed') {
            message.success(`${file.name} 解析入库完成`);
            break;
          }
          if (task?.status === 'failed') {
            throw new Error(task.errorMessage || 'document processing failed');
          }
          if (task?.status === 'cancelled') {
            message.info(`${file.name} 的排队任务已取消`);
            break;
          }
        }
      } else {
        message.success(`${file.name} 上传成功`);
      }
      await fetchDocs({ ...pagination, current: 1 });
    } catch (error) {
      const detail = error instanceof Error ? error.message : '';
      message.error(detail || `${file.name} 上传失败，请稍后重试`);
    } finally {
      setUploading(false);
    }
    return Upload.LIST_IGNORE;
  };
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20 });
  const [permissionForm] = Form.useForm<{ permissions: DocumentPermissionInput[] }>();
  const [versionForm] = Form.useForm<{
    content: string;
    filename?: string;
    docVersion?: string;
    effectiveAt?: string;
  }>();

  /**
   * 列表、用户、角色和组织之间没有数据依赖，统一并发加载；随后在页面边界解开
   * Admin Backend 与 RAG Backend 可能出现的多层 data 包装，组件内部只维护一种 DocumentItem。
   */
  const fetchDocs = (nextPagination = pagination) => {
    setPageState('loading');
    Promise.all([
      getDocuments({
        ...nextPagination,
        ...(scope ? { scope } : {}),
        ...(lifecycleStatus ? { lifecycleStatus } : {}),
        ...(scope === 'department' && departmentFilter
          ? { departmentId: departmentFilter }
          : {}),
      }),
      getUsers(),
      getRoles(),
      getOrganizations(),
    ])
      .then(([docRes, userRes, roleRes, orgRes]: [any, any, any, any]) => {
        // 响应包装兼容只留在这里，避免表格、弹窗和状态标签分别猜测接口结构。
        const raw = docRes?.data ?? docRes;
        const payload = raw?.data ?? raw;
        const items = payload?.items ?? (Array.isArray(payload) ? payload : []);
        const rawTotal = payload?.total ?? (Array.isArray(items) ? items.length : 0);

        const userRaw = userRes?.data ?? userRes;
        const userList = normalizeList(userRaw);
        const userMap = new Map<string, string>();
        if (Array.isArray(userList)) {
          userList.forEach((u: any) => {
            userMap.set(String(u.id), u.username ?? u.nickname ?? String(u.id));
          });
        }
        setUserOptions(
          userList
            .filter((u: any) => u.id)
            .map((u: any) => ({
              label: u.username ?? u.nickname ?? String(u.id),
              value: String(u.id),
            })),
        );

        const roleRaw = roleRes?.data ?? roleRes;
        const roleList = normalizeList(roleRaw);
        setRoleOptions(
          roleList
            .filter((role: any) => role.id || role.code || role.name)
            .map((role: any) => ({
              label: role.name ?? role.code ?? String(role.id),
              value: String(role.id ?? role.code ?? role.name),
            })),
        );

        const orgRaw = orgRes?.data ?? orgRes;
        const departments = normalizeList(orgRaw?.departments ? orgRaw : orgRaw?.data);
        setDepartmentOptions(
          departments
            .filter((department: any) => department.id || department.name)
            .map((department: any) => ({
              label: department.name ?? String(department.id),
              value: String(department.id ?? department.name),
            })),
        );

        if (Array.isArray(items) && items.length > 0) {
          setDocs(
            [...items]
              .sort((a: any, b: any) => {
                const aTime = Date.parse(a.createdAt ?? '') || 0;
                const bTime = Date.parse(b.createdAt ?? '') || 0;
                return bTime - aTime;
              })
              .map((item: any) => ({
              id: item.docId,
              filename: repairMojibake(item.filename),
              fileType: (repairMojibake(item.filename) ?? '').split('.').pop() ?? '',
              fileSize: 0,
              chunkCount: item.chunkCount ?? 0,
              uploadedBy: userMap.get(String(item.userId)) ?? item.userId ?? '',
              createdAt: item.createdAt,
              updatedAt: item.createdAt,
              metadata: { category: repairMojibake(item.category), title: repairMojibake(item.title) },
              docVersion: item.docVersion,
              lifecycleStatus: item.lifecycleStatus,
              reviewStatus: item.reviewStatus,
              graphIndexStatus: item.graphIndexStatus,
              graphIndexedAt: item.graphIndexedAt,
              graphIndexError: item.graphIndexError,
              supersedesDocId: item.supersedesDocId,
              effectiveAt: item.effectiveAt,
              expiredAt: item.expiredAt,
              obsidianPath: repairMojibake(item.obsidianPath),
              obsidianStatus: item.obsidianStatus,
              permissions: item.permissions,
              indexPipeline: item.indexPipeline,
              })),
          );
          setTotal(Number(rawTotal) || items.length);
          setPageState('data');
        } else {
          setDocs([]);
          setTotal(0);
          setPageState('empty');
        }
      })
      .catch((error) => {
        setPageState('error');
        message.error(error instanceof Error ? error.message : '文档列表加载失败，请重试');
      });
  };

  const fetchOperations = useCallback(async () => {
    if (!showOperationsPanel) return;
    setOperationsLoading(true);
    setOperationsError(undefined);
    try {
      const response: any = await getDocumentOperations();
      const raw = response?.data ?? response;
      const payload = raw?.data ?? raw;
      setOperations(payload as DocumentOperations);
    } catch (error) {
      setOperationsError(error instanceof Error ? error.message : '运维状态加载失败');
    } finally {
      setOperationsLoading(false);
    }
  }, [showOperationsPanel]);

  useEffect(() => {
    fetchDocs();
  }, []);

  useEffect(() => {
    void fetchOperations();
  }, [fetchOperations]);

  const openPermissionModal = (record: DocumentItem) => {
    const category = record.metadata?.category;
    permissionForm.setFieldsValue({
      permissions: [
        category
          ? { subjectType: 'department', subjectId: category, scope: 'read' }
          : { subjectType: 'public', subjectId: '', scope: 'read' },
      ],
    });
    setPermissionDoc(record);
  };

  const handleSavePermissions = async () => {
    if (!permissionDoc) return;
    const values = await permissionForm.validateFields();
    setPermissionSaving(true);
    try {
      const permissions = (values.permissions ?? [])
        .map((item) => ({
          subjectType: item.subjectType,
          subjectId: item.subjectType === 'public' ? 'public' : item.subjectId?.trim(),
          scope: 'read' as const,
        }))
        .filter((item) => item.subjectType === 'public' || item.subjectId);
      await updateDocumentPermissions(permissionDoc.id, permissions);
      message.success('权限范围已保存');
      setPermissionDoc(null);
      fetchDocs();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '权限保存失败');
    } finally {
      setPermissionSaving(false);
    }
  };

  const openVersionModal = async (record: DocumentItem) => {
    setVersionDoc(record);
    setVersionLoading(true);
    versionForm.resetFields();
    versionForm.setFieldsValue({ filename: record.filename });
    try {
      const response = await getDocumentVersions(record.id);
      const raw = (response as any)?.data ?? response;
      setVersionItems(Array.isArray(raw) ? raw : raw?.data ?? []);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '版本链加载失败');
    } finally {
      setVersionLoading(false);
    }
  };

  const handleCreateVersion = async () => {
    if (!versionDoc) return;
    const values = (await versionForm.validateFields()) as {
      content: string;
      filename?: string;
      docVersion?: string;
      effectiveAt?: string;
      expiredAt?: string;
      changeType?: 'standalone' | 'new' | 'replace' | 'amend' | 'supplement' | 'deprecate';
      validityMonths?: number | string;
      incremental?: boolean;
    };
    setVersionSaving(true);
    try {
      if (values.incremental === true) {
        await incrementalUpdateDocument(versionDoc.id, {
          content: values.content,
          filename: values.filename,
          docVersion: values.docVersion,
          effectiveAt: values.effectiveAt,
          expiredAt: values.expiredAt,
          changeType: values.changeType ?? 'amend',
          validityMonths: values.validityMonths
            ? Number(values.validityMonths)
            : undefined,
        });
        message.success('增量更新完成：只重算新增/变化 chunk，历史规则保留');
      } else {
        await createDocumentVersion(versionDoc.id, {
          content: values.content,
          filename: values.filename,
          docVersion: values.docVersion,
          effectiveAt: values.effectiveAt,
        });
        message.success('新版本已创建为草稿；索引完成后可设为生效');
      }
      setVersionDoc(null);
      fetchDocs();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '新版本创建失败');
    } finally {
      setVersionSaving(false);
    }
  };

  const handlePromote = async (item: DocumentVersionItem) => {
    setVersionActionDocId(item.docId);
    try {
      await promoteDocumentVersion(item.docId);
      message.success(`${item.docVersion} 已设为生效，旧版本已自动废弃`);
      if (versionDoc) openVersionModal(versionDoc);
      fetchDocs();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '版本生效失败');
    } finally {
      setVersionActionDocId(undefined);
    }
  };

  const handleReview = async (item: DocumentVersionItem, action: 'submit' | 'approve' | 'reject') => {
    setVersionActionDocId(item.docId);
    try {
      if (action === 'submit') await submitDocumentReview(item.docId);
      if (action === 'approve') await approveDocumentReview(item.docId);
      if (action === 'reject') await rejectDocumentReview(item.docId);
      message.success(action === 'submit' ? '已提交审核' : action === 'approve' ? '审核已通过' : '已驳回，请补充资料后新建版本');
      if (versionDoc) openVersionModal(versionDoc);
      fetchDocs();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '审核操作失败');
    } finally {
      setVersionActionDocId(undefined);
    }
  };

  const handleRetryDocumentTask = async (task: FailedDocumentTask) => {
    setRetryingTaskId(task.id);
    try {
      const result = unwrapResponseData(await retryFailedDocumentTask(task.id));
      if (result?.retried) {
        message.success(`${task.filename} 已重新进入入库队列`);
      } else {
        message.warning(result?.reason || '该任务当前不可重试');
      }
      await fetchOperations();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '文档任务重试失败');
    } finally {
      setRetryingTaskId(undefined);
    }
  };

  const handleCancelQueuedTask = (task: PendingDocumentTask) => {
    Modal.confirm({
      title: `取消 ${task.filename} 的排队任务？`,
      content: '仅可取消仍在等待中的任务，处理中任务无法中断。取消后会将原文件加入清理队列。',
      okText: '取消排队任务',
      cancelText: '继续等待',
      onOk: async () => {
        setCancellingTaskId(task.id);
        try {
          const result = unwrapResponseData(await cancelQueuedDocumentTask(task.id));
          if (result?.cancelled) {
            if (result.cleanupCompleted) {
              message.warning('原文件清理队列不可用，已直接删除原文件');
            } else if (result.cleanupScheduled === false) {
              message.warning(result.reason || '任务已取消，但原文件清理未能入队');
            } else {
              message.success(`${task.filename} 已取消并加入原文件清理队列`);
            }
          } else {
            message.warning(result?.reason || '任务当前不可取消');
          }
          await fetchOperations();
        } catch (error) {
          message.error(error instanceof Error ? error.message : '取消排队任务失败');
        } finally {
          setCancellingTaskId(undefined);
        }
      },
    });
  };

  const handleRetryIndexRepair = async (repair: FailedIndexRepair) => {
    setRetryingRepairId(repair.id);
    try {
      const result = unwrapResponseData(await retryIndexRepair(repair.id));
      if (result?.retried) {
        message.success(`文档 ${repair.docId} 的索引修复已重新入队`);
      } else {
        message.warning(result?.reason || '该索引修复任务当前不可重试');
      }
      await fetchOperations();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '索引修复重试失败');
    } finally {
      setRetryingRepairId(undefined);
    }
  };

  const handleRunReconciler = () => {
    Modal.confirm({
      title: '立即运行索引对账？',
      content: `最多扫描 ${operations?.indexReconciler.batchSize ?? 100} 份文档，并将可修复的不一致任务加入索引修复队列。`,
      okText: '运行对账',
      cancelText: '取消',
      onOk: async () => {
        setReconciling(true);
        try {
          const result = unwrapResponseData(await runIndexReconciler());
          if (result?.available === false) {
            message.warning(result.reason || '对账暂不可用');
          } else {
            message.success(`对账完成：扫描 ${result.scanned ?? 0} 份，排入修复队列 ${result.queued ?? 0} 项`);
          }
          await fetchOperations();
        } catch (error) {
          message.error(error instanceof Error ? error.message : '索引对账失败');
        } finally {
          setReconciling(false);
        }
      },
    });
  };

  const handleDeprecate = async (item: DocumentVersionItem) => {
    setVersionActionDocId(item.docId);
    try {
      await updateDocumentLifecycle(item.docId, 'deprecated');
      message.success(`${item.docVersion} 已废弃`);
      if (versionDoc) openVersionModal(versionDoc);
      fetchDocs();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '版本废弃失败');
    } finally {
      setVersionActionDocId(undefined);
    }
  };

  const handleRollback = async (item: DocumentVersionItem) => {
    setVersionActionDocId(item.docId);
    try {
      await rollbackDocumentVersion(item.docId);
      message.success(`已回滚到 ${item.docVersion}`);
      if (versionDoc) openVersionModal(versionDoc);
      fetchDocs();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '版本回滚失败');
    } finally {
      setVersionActionDocId(undefined);
    }
  };

  const handleArchive = (record: DocumentItem) => {
    Modal.confirm({
      title: '确认归档该文档？',
      content: '归档后文档不再参与智能搜索与 AI 问答召回，可在「文档归档」页恢复。',
      okText: '归档',
      onOk: async () => {
        setArchiveActionDocId(record.id);
        try {
          await archiveDocument(record.id);
          message.success('文档已归档');
          fetchDocs();
        } catch (error) {
          message.error(error instanceof Error ? error.message : '归档失败');
        } finally {
          setArchiveActionDocId(undefined);
        }
      },
    });
  };

  const handleUnarchive = async (record: DocumentItem) => {
    setArchiveActionDocId(record.id);
    try {
      await unarchiveDocument(record.id);
      message.success('文档已恢复为生效状态');
      fetchDocs();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '恢复失败');
    } finally {
      setArchiveActionDocId(undefined);
    }
  };

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
          <span>{record.metadata?.title || record.filename}</span>
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
      title: '版本状态',
      width: 180,
      render: (_, record) => (
        <Space size={4}>
          <Tag color={record.lifecycleStatus === 'effective' ? 'green' : 'default'}>
            {record.docVersion || '未标注版本'}
          </Tag>
          <Tag>{record.lifecycleStatus || 'confirmed'}</Tag>
          <Tag color={record.reviewStatus === 'approved' ? 'green' : record.reviewStatus === 'rejected' ? 'red' : 'orange'}>
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
          tags.push(<Tag color="cyan" key="public">公共</Tag>);
        }
        record.permissions
          ?.filter((permission) => permission.subjectType === 'department')
          .forEach((permission) => {
            tags.push(
              <Tag color="blue" key={`department-${permission.subjectId}`}>
                {departmentNameMap.get(permission.subjectId) ?? permission.subjectId}
              </Tag>,
            );
          });
        if (tags.length === 0) {
          tags.push(
            <Tag key="restricted">
              {record.permissions && record.permissions.length > 0 ? '受限' : '未配置'}
            </Tag>,
          );
        }
        if (record.metadata?.category) {
          tags.push(<Tag key="category">{record.metadata.category}</Tag>);
        }
        return <Space size={4} wrap>{tags}</Space>;
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
      render: (_, record) => record.indexPipeline ? (
        <Space size={2} wrap>
          {(['rag', 'es', 'graph'] as const).map((key) => {
            const item = record.indexPipeline?.[key];
            const state = graphStatusMap[item?.status ?? 'skipped'];
            return <Tag key={key} color={state.color}>{key === 'rag' ? 'RAG' : key === 'es' ? 'ES' : 'Neo4j'}：{state.text}</Tag>;
          })}
        </Space>
      ) : <Tag>暂无</Tag>,
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

  return (
    <ModulePage activeKey={activeKey} navItems={documentNav} title="文档管理">
      <div className="rag-panel document-toolbar">
        <Input prefix={<SearchOutlined />} placeholder="搜索文档名称、内容、上传人等" />
        {!isArchivePage && (
          <>
            <Upload
              accept=".md,.markdown,.txt,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.json,.html,.htm,.jpg,.jpeg,.png,.gif,.webp,.bmp,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus,.mp4,.webm,.mov,.avi"
              beforeUpload={handleBeforeUpload}
              multiple
              showUploadList={false}
            >
              <Button icon={<UploadOutlined />} loading={uploading} type="primary">批量上传</Button>
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
                showSearch
                optionFilterProp="label"
                style={{ minWidth: 120 }}
                value={departmentFilter}
              />
            ) : (
              <Select defaultValue="权限范围" options={[{ value: '权限范围' }]} />
            )}
            <Button>更多筛选</Button>
          </>
        )}
        <Button icon={<ReloadOutlined />} onClick={() => fetchDocs()} type="text" />
      </div>
      {showOperationsPanel && (
        <Card
          className="rag-panel"
          extra={
            <Button icon={<ReloadOutlined />} loading={operationsLoading} onClick={() => void fetchOperations()}>
              刷新状态
            </Button>
          }
          title="入库与索引运维"
        >
          {operationsError && (
            <Alert
              message="运维状态暂不可用"
              description={operationsError}
              showIcon
              style={{ marginBottom: 16 }}
              type="error"
            />
          )}
          {operationsLoading && !operations && <Skeleton active paragraph={{ rows: 4 }} />}
          {operations && (
            <>
              <Row gutter={[16, 16]}>
                <Col xs={24} sm={12} lg={6}>
                  <Statistic
                    title="文档处理队列"
                    value={operations.documentQueue.enabled ? '运行中' : '未启用'}
                    valueStyle={{ color: operations.documentQueue.enabled ? '#389e0d' : '#8c8c8c' }}
                  />
                  <Space size={4} wrap>
                    <Tag>等待 {operations.documentQueue.waiting}</Tag>
                    <Tag color="processing">处理中 {operations.documentQueue.active}</Tag>
                    <Tag color="success">完成 {operations.documentQueue.completed}</Tag>
                    <Tag color="error">失败 {operations.documentQueue.failed}</Tag>
                  </Space>
                </Col>
                <Col xs={24} sm={12} lg={6}>
                  <Statistic
                    title="索引修复队列"
                    value={operations.indexRepairQueue.enabled ? '运行中' : '未启用'}
                    valueStyle={{ color: operations.indexRepairQueue.enabled ? '#389e0d' : '#8c8c8c' }}
                  />
                  <Space size={4} wrap>
                    <Tag>等待 {operations.indexRepairQueue.waiting}</Tag>
                    <Tag color="processing">处理中 {operations.indexRepairQueue.active}</Tag>
                    <Tag color="success">完成 {operations.indexRepairQueue.completed}</Tag>
                    <Tag color="error">失败 {operations.indexRepairQueue.failed}</Tag>
                  </Space>
                </Col>
                <Col xs={24} sm={12} lg={6}>
                  <Statistic
                    title="自动对账器"
                    value={operations.indexReconciler.enabled ? '已启用' : '未启用'}
                    valueStyle={{ color: operations.indexReconciler.enabled ? '#389e0d' : '#8c8c8c' }}
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
                    value={operations.failedDocumentTasks.length + operations.failedIndexRepairs.length}
                    valueStyle={{ color: operations.failedDocumentTasks.length + operations.failedIndexRepairs.length ? '#cf1322' : '#389e0d' }}
                  />
                  <Button
                    disabled={!operations.indexReconciler.queueEnabled || operations.indexReconciler.running}
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
                  message="最近一次对账失败"
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
                    message="仅可取消尚未开始的任务；处理中任务无法中断。"
                    showIcon
                    style={{ marginBottom: 12 }}
                    type="info"
                  />
                  <Table<PendingDocumentTask>
                    columns={[
                      { title: '文件', dataIndex: 'filename', ellipsis: true },
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
                        render: (value: string) => value ? new Date(value).toLocaleString() : '—',
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
                    ] as ColumnsType<PendingDocumentTask>}
                    dataSource={operations.pendingDocumentTasks ?? []}
                    locale={{
                      emptyText: (
                        <Empty
                          description={operations.documentQueue.enabled ? '没有待处理的入库任务' : '文档队列未启用'}
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
                    columns={[
                      { title: '文件', dataIndex: 'filename', ellipsis: true },
                      {
                        title: '失败原因',
                        dataIndex: 'errorMessage',
                        ellipsis: true,
                        render: (value?: string | null) => value || '未提供原因',
                      },
                      {
                        title: '更新时间',
                        dataIndex: 'updatedAt',
                        width: 160,
                        render: (value?: string) => value ? new Date(value).toLocaleString() : '—',
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
                    ] as ColumnsType<FailedDocumentTask>}
                    dataSource={operations.failedDocumentTasks}
                    locale={{ emptyText: <Empty description="没有失败的入库任务" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
                    pagination={{ pageSize: 5, hideOnSinglePage: true }}
                    rowKey="id"
                    size="small"
                  />
                </Col>
                <Col xs={24} xl={12}>
                  <h4>失败的索引修复</h4>
                  <Table<FailedIndexRepair>
                    columns={[
                      { title: '文档 ID', dataIndex: 'docId', ellipsis: true },
                      {
                        title: '失败原因',
                        dataIndex: 'failedReason',
                        ellipsis: true,
                        render: (value?: string | null) => value || '未提供原因',
                      },
                      { title: '尝试次数', dataIndex: 'attemptsMade', width: 90 },
                      {
                        title: '操作',
                        width: 90,
                        render: (_, repair) => (
                          <Button
                            disabled={!operations.indexRepairQueue.enabled}
                            loading={retryingRepairId === repair.id}
                            onClick={() => void handleRetryIndexRepair(repair)}
                            size="small"
                          >
                            重试
                          </Button>
                        ),
                      },
                    ] as ColumnsType<FailedIndexRepair>}
                    dataSource={operations.failedIndexRepairs}
                    locale={{ emptyText: <Empty description="没有失败的索引修复" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
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
        {pageState === 'loading' && (
          <Skeleton active paragraph={{ rows: 8 }} />
        )}
        {pageState === 'error' && (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <h3>加载失败</h3>
            <p style={{ color: '#999', margin: '12px 0 24px' }}>
              无法获取文档列表，请确认服务正常运行。
            </p>
            <Button icon={<ReloadOutlined />} onClick={() => fetchDocs()} type="primary">
              重新加载
            </Button>
          </div>
        )}
        {pageState === 'empty' && (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <h3>{emptyTitle}</h3>
            <p style={{ color: '#999', margin: '12px 0' }}>{emptyDescription}</p>
            {!isArchivePage && (
              <Upload
                accept=".md,.markdown,.txt,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.json,.html,.htm,.jpg,.jpeg,.png,.gif,.webp,.bmp,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus,.mp4,.webm,.mov,.avi"
                beforeUpload={handleBeforeUpload}
                showUploadList={false}
              >
                <Button icon={<UploadOutlined />} loading={uploading} type="primary">上传文档</Button>
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
        destroyOnClose
        onCancel={() => setPermissionDoc(null)}
        onOk={handleSavePermissions}
        open={!!permissionDoc}
        title="配置文档权限"
        width={620}
      >
        <p className="permission-doc-title">{permissionDoc?.filename}</p>
        <Form
          form={permissionForm}
          layout="vertical"
          preserve={false}
        >
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
                        const type = getFieldValue(['permissions', field.name, 'subjectType']);
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
                            {type === 'user' || type === 'role' || type === 'department' ? (
                              <Select
                                disabled={type === 'public'}
                                optionFilterProp="label"
                                options={options}
                                placeholder={
                                  type === 'user'
                                    ? '选择用户'
                                    : type === 'role'
                                      ? '选择角色'
                                      : '选择部门'
                                }
                                showSearch
                                style={{ width: 280 }}
                              />
                            ) : (
                              <Input
                                disabled={type === 'public'}
                                placeholder={
                                  type === 'public' ? '全部用户可读' : '输入部门 ID'
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
                <Button onClick={() => add({ subjectType: 'user', scope: 'read' })}>
                  添加权限主体
                </Button>
              </div>
            )}
          </Form.List>
        </Form>
      </Modal>
      <Modal
        destroyOnClose
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
          columns={[
            { title: '版本', dataIndex: 'docVersion' },
            { title: '状态', dataIndex: 'lifecycleStatus' },
            { title: '审核', dataIndex: 'reviewStatus', render: (value: string) => <Tag color={value === 'approved' ? 'green' : value === 'rejected' ? 'red' : 'orange'}>{value || 'approved'}</Tag> },
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
                    <Button loading={versionActionDocId === item.docId} onClick={() => handleRollback(item)} size="small">
                      回滚到此版本
                    </Button>
                  );
                }
                return (
                  <Space size={4}>
                    {item.reviewStatus === 'approved' ? <Button loading={versionActionDocId === item.docId} onClick={() => handlePromote(item)} size="small" type="primary">设为生效</Button> : item.reviewStatus === 'pending_review' ? <Button loading={versionActionDocId === item.docId} onClick={() => handleReview(item, 'approve')} size="small" type="primary">审核通过</Button> : <Button loading={versionActionDocId === item.docId} onClick={() => handleReview(item, 'submit')} size="small" type="primary">提交审核</Button>}
                    {item.reviewStatus === 'pending_review' && <Button loading={versionActionDocId === item.docId} danger onClick={() => handleReview(item, 'reject')} size="small">驳回</Button>}
                    <Button disabled={versionActionDocId === item.docId} onClick={() => handleDeprecate(item)} size="small">
                      废弃
                    </Button>
                  </Space>
                );
              },
            },
          ] as ColumnsType<DocumentVersionItem>}
        />
        <Form form={versionForm} layout="vertical" style={{ marginTop: 20 }}>
          <Form.Item label="新版本号" name="docVersion" rules={[{ required: true, message: '请输入版本号' }]}>
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
            <Input type="number" min={1} max={120} placeholder="例如 3；留空则使用显式日期或正文有效期" />
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
          <Form.Item label="增量更新" name="incremental" valuePropName="checked">
            <Checkbox>同一 docId，只重算新增/变化 chunk；保留历史规则有效期</Checkbox>
          </Form.Item>
          <Form.Item label="新规范正文" name="content" rules={[{ required: true, message: '请输入新规范正文' }]}>
            <Input.TextArea rows={8} placeholder="粘贴最新规范内容。勾选增量更新时只重算新增/变化 chunk。" />
          </Form.Item>
        </Form>
      </Modal>
    </ModulePage>
  );
};

function normalizeList(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.departments)) return raw.departments;
  if (Array.isArray(raw?.items)) return raw.items;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.data?.items)) return raw.data.items;
  if (Array.isArray(raw?.list)) return raw.list;
  return [];
}

export { Documents };

export default Documents;
