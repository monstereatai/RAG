import { Form, Modal, message, Upload } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import type { DocumentListPageProps, PageState } from './documents-types';
import {
  normalizeList,
  repairMojibake,
  unwrapResponseData,
} from './documents-utils';
import {
  approveDocumentReview,
  archiveDocument,
  cancelQueuedDocumentTask,
  createDocumentVersion,
  type DocumentItem,
  type DocumentOperations,
  type DocumentPermissionInput,
  type DocumentVersionItem,
  type FailedDocumentTask,
  type FailedIndexRepair,
  getDocumentOperations,
  getDocuments,
  getDocumentTask,
  getDocumentVersions,
  getOrganizations,
  getRoles,
  getUsers,
  incrementalUpdateDocument,
  type PendingDocumentTask,
  promoteDocumentVersion,
  rejectDocumentReview,
  retryFailedDocumentTask,
  retryIndexRepair,
  rollbackDocumentVersion,
  runIndexReconciler,
  submitDocumentReview,
  unarchiveDocument,
  updateDocumentLifecycle,
  updateDocumentPermissions,
  uploadDocument,
} from './service';

export function useDocumentsController({
  scope,
  lifecycleStatus,
  activeKey = 'mine',
  emptyTitle = '暂无文档',
  emptyDescription = '知识库还没有文档，请上传文档开始使用。',
}: DocumentListPageProps) {
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

  const [userOptions, setUserOptions] = useState<
    { label: string; value: string }[]
  >([]);

  const [roleOptions, setRoleOptions] = useState<
    { label: string; value: string }[]
  >([]);

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

  const [permissionForm] = Form.useForm<{
    permissions: DocumentPermissionInput[];
  }>();

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
        const rawTotal =
          payload?.total ?? (Array.isArray(items) ? items.length : 0);

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
        const departments = normalizeList(
          orgRaw?.departments ? orgRaw : orgRaw?.data,
        );
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
                fileType:
                  (repairMojibake(item.filename) ?? '').split('.').pop() ?? '',
                fileSize: 0,
                chunkCount: item.chunkCount ?? 0,
                uploadedBy:
                  userMap.get(String(item.userId)) ?? item.userId ?? '',
                createdAt: item.createdAt,
                updatedAt: item.createdAt,
                metadata: {
                  category: repairMojibake(item.category),
                  title: repairMojibake(item.title),
                },
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
        message.error(
          error instanceof Error ? error.message : '文档列表加载失败，请重试',
        );
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
      setOperationsError(
        error instanceof Error ? error.message : '运维状态加载失败',
      );
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
          subjectId:
            item.subjectType === 'public' ? 'public' : item.subjectId?.trim(),
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
      setVersionItems(Array.isArray(raw) ? raw : (raw?.data ?? []));
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
      changeType?:
        | 'standalone'
        | 'new'
        | 'replace'
        | 'amend'
        | 'supplement'
        | 'deprecate';
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

  const handleReview = async (
    item: DocumentVersionItem,
    action: 'submit' | 'approve' | 'reject',
  ) => {
    setVersionActionDocId(item.docId);
    try {
      if (action === 'submit') await submitDocumentReview(item.docId);
      if (action === 'approve') await approveDocumentReview(item.docId);
      if (action === 'reject') await rejectDocumentReview(item.docId);
      message.success(
        action === 'submit'
          ? '已提交审核'
          : action === 'approve'
            ? '审核已通过'
            : '已驳回，请补充资料后新建版本',
      );
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
      message.error(
        error instanceof Error ? error.message : '文档任务重试失败',
      );
    } finally {
      setRetryingTaskId(undefined);
    }
  };

  const handleCancelQueuedTask = (task: PendingDocumentTask) => {
    Modal.confirm({
      title: `取消 ${task.filename} 的排队任务？`,
      content:
        '仅可取消仍在等待中的任务，处理中任务无法中断。取消后会将原文件加入清理队列。',
      okText: '取消排队任务',
      cancelText: '继续等待',
      onOk: async () => {
        setCancellingTaskId(task.id);
        try {
          const result = unwrapResponseData(
            await cancelQueuedDocumentTask(task.id),
          );
          if (result?.cancelled) {
            if (result.cleanupCompleted) {
              message.warning('原文件清理队列不可用，已直接删除原文件');
            } else if (result.cleanupScheduled === false) {
              message.warning(
                result.reason || '任务已取消，但原文件清理未能入队',
              );
            } else {
              message.success(`${task.filename} 已取消并加入原文件清理队列`);
            }
          } else {
            message.warning(result?.reason || '任务当前不可取消');
          }
          await fetchOperations();
        } catch (error) {
          message.error(
            error instanceof Error ? error.message : '取消排队任务失败',
          );
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
      message.error(
        error instanceof Error ? error.message : '索引修复重试失败',
      );
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
            message.success(
              `对账完成：扫描 ${result.scanned ?? 0} 份，排入修复队列 ${result.queued ?? 0} 项`,
            );
          }
          await fetchOperations();
        } catch (error) {
          message.error(
            error instanceof Error ? error.message : '索引对账失败',
          );
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
      content:
        '归档后文档不再参与智能搜索与 AI 问答召回，可在「文档归档」页恢复。',
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

  return {
    scope,
    lifecycleStatus,
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
    archiveActionDocId,
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
    openPermissionModal,
    handleSavePermissions,
    openVersionModal,
    handleCreateVersion,
    handlePromote,
    handleReview,
    handleRetryDocumentTask,
    handleCancelQueuedTask,
    handleRetryIndexRepair,
    handleRunReconciler,
    handleDeprecate,
    handleRollback,
    handleArchive,
    handleUnarchive,
  };
}

export type DocumentsController = ReturnType<typeof useDocumentsController>;
