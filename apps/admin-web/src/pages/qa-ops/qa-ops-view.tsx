import {
  CloseOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EllipsisOutlined,
  FileAddOutlined,
  FileWordOutlined,
  FlagOutlined,
  FolderOpenOutlined,
  MenuOutlined,
  PaperClipOutlined,
  PlusOutlined,
  SendOutlined,
  ShareAltOutlined,
  SoundOutlined,
} from '@ant-design/icons';
import { history } from '@umijs/max';
import {
  Avatar,
  message as antdMessage,
  Button,
  Drawer,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Tag,
} from 'antd';
import React from 'react';
import { ModulePage, qaNav } from '@/components/AdminShell';
import type { QaOpsController } from './qa-ops-controller';
import {
  formatEventTrace,
  getStreamingStatusText,
  insufficientEvidenceMessage,
  isConversationAttachmentReference,
  isExternalReference,
  referenceLabel,
  routeLabel,
  TypewriterAnswer,
} from './qa-ops-view-utils';
import {
  type ChatModel,
  deleteConversation,
  deleteConversationAttachments,
  downloadArtifact,
  submitConversationBadCase,
} from './service';

export function QaOpsView(props: QaOpsController) {
  const {
    PAGE_SIZE,
    activeRolePreset,
    activeTitle,
    artifactDrawerOpen,
    artifactForm,
    artifactKindLabel,
    artifactLoading,
    artifactModalOpen,
    artifactSubmitting,
    artifacts,
    attachmentInputRef,
    attachmentUploading,
    attachments,
    availableQaPlugins,
    badCaseForm,
    badCaseMessage,
    badCaseSubmitting,
    chatBodyRef,
    convPage,
    conversations,
    formatTime,
    getTtsButtonText,
    handleAttachmentSelection,
    handleClearConversation,
    handleCreateArtifact,
    handleCreateShare,
    handleNewConversation,
    handlePlayTts,
    handleRemoveAttachment,
    handleRolePresetChange,
    handleSelectConversation,
    handleSend,
    input,
    loading,
    messages,
    model,
    modelOptions,
    openArtifactModal,
    pluginKeys,
    rolePresetId,
    rolePresets,
    rolePresetsLoading,
    selectedArtifact,
    setActiveTitle,
    setArtifactDrawerOpen,
    setArtifactModalOpen,
    setAttachments,
    setBadCaseMessage,
    setBadCaseSubmitting,
    setConvPage,
    setConversations,
    setInput,
    setMessages,
    setModel,
    setPluginKeys,
    setSelectedArtifact,
    setShareModalOpen,
    setThreadId,
    shareForm,
    shareModalOpen,
    sidebarLoading,
    threadId,
    threadIdRef,
    ttsStatusByMessageId,
  } = props;

  return (
    <ModulePage activeKey="new" navItems={qaNav} title="AI问答">
      <div className="qa-workspace">
        <aside className="rag-panel qa-list">
          <div className="panel-head">
            <h3>会话列表</h3>
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'sortNewest',
                    label: '按时间排序',
                  },
                  {
                    key: 'sortCount',
                    label: '按消息数排序',
                  },
                ],
                onClick: ({ key }) => {
                  const sorted = [...conversations];
                  if (key === 'sortNewest') {
                    sorted.sort(
                      (a, b) =>
                        new Date(b.updatedAt).getTime() -
                        new Date(a.updatedAt).getTime(),
                    );
                  } else if (key === 'sortCount') {
                    sorted.sort((a, b) => b.messageCount - a.messageCount);
                  }
                  setConversations(sorted);
                },
              }}
              placement="bottomRight"
            >
              <Button type="text" icon={<MenuOutlined />} />
            </Dropdown>
          </div>
          <Button
            block
            ghost
            icon={<PlusOutlined />}
            onClick={handleNewConversation}
            size="large"
            type="primary"
          >
            新建对话
          </Button>
          <div className="conversation-list">
            {sidebarLoading ? (
              <div className="empty-conversations">加载中...</div>
            ) : conversations.length === 0 ? (
              <div className="empty-conversations">暂无对话</div>
            ) : (
              conversations.slice(0, convPage * PAGE_SIZE).map((item) => (
                <button
                  className={`conv-item${item.threadId === threadId ? ' active' : ''}`}
                  key={item.threadId}
                  onClick={() => handleSelectConversation(item)}
                  type="button"
                  onKeyDown={(e) =>
                    e.key === 'Enter' && handleSelectConversation(item)
                  }
                >
                  <strong>{item.title}</strong>
                  <span>{formatTime(item.updatedAt)}</span>
                  <p>{item.messageCount} 条消息</p>
                  <Dropdown
                    menu={{
                      items: [
                        {
                          key: 'delete',
                          label: '删除会话',
                          danger: true,
                          icon: <DeleteOutlined />,
                        },
                      ],
                      onClick: async ({ domEvent }) => {
                        domEvent.stopPropagation();
                        try {
                          await deleteConversationAttachments(item.threadId);
                          await deleteConversation(item.threadId);
                          setConversations((prev) =>
                            prev.filter((c) => c.threadId !== item.threadId),
                          );
                          if (threadId === item.threadId) {
                            setMessages([]);
                            setThreadId(undefined);
                            threadIdRef.current = undefined;
                            setAttachments([]);
                            setActiveTitle('');
                          }
                        } catch {
                          // 删除失败
                        }
                      },
                    }}
                    placement="bottomRight"
                    trigger={['click']}
                  >
                    <span
                      className="conv-more-btn"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <EllipsisOutlined />
                    </span>
                  </Dropdown>
                </button>
              ))
            )}
            {conversations.length > convPage * PAGE_SIZE && (
              <Button
                block
                type="link"
                onClick={() => setConvPage((p) => p + 1)}
              >
                查看更多会话（{conversations.length - convPage * PAGE_SIZE}）⌄
              </Button>
            )}
          </div>
        </aside>
        <section className="rag-panel qa-chat">
          <div className="chat-head">
            <h2>{activeTitle || 'AI 智能问答'}</h2>
            <Space>
              <Button
                icon={<FolderOpenOutlined />}
                onClick={() => setArtifactDrawerOpen(true)}
              >
                文件
              </Button>
              <Button
                icon={<DeleteOutlined />}
                onClick={handleClearConversation}
              >
                清空对话
              </Button>
            </Space>
          </div>
          <div className="qa-role-toolbar">
            <span>服务岗位</span>
            <Select
              aria-label="服务岗位"
              loading={rolePresetsLoading}
              onChange={handleRolePresetChange}
              options={rolePresets.map((role) => ({
                label: role.name,
                value: role.id,
              }))}
              placeholder="选择岗位"
              value={rolePresetId}
            />
            <p>{activeRolePreset?.summary ?? '正在加载岗位能力...'}</p>
          </div>
          <div className="chat-body" ref={chatBodyRef}>
            {messages.map((message, messageIndex) =>
              message.role === 'user' ? (
                <div className="message user" key={message.id}>
                  <div>
                    <p>{message.content}</p>
                    <span>{message.createdAt}</span>
                  </div>
                  <Avatar style={{ background: '#f0f2f5', color: '#8c8c8c' }}>
                    <svg
                      viewBox="0 0 24 24"
                      width="18"
                      height="18"
                      fill="currentColor"
                    >
                      <title>用户</title>
                      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                    </svg>
                  </Avatar>
                </div>
              ) : (
                <div className="message assistant" key={message.id}>
                  <Avatar>AI</Avatar>
                  <div className="answer-card">
                    {message.content ? (
                      <TypewriterAnswer
                        animate={message.animate === true}
                        content={message.content}
                        status={
                          message.status === 'streaming' ? 'streaming' : 'done'
                        }
                      />
                    ) : (
                      message.status === 'streaming' && (
                        <p className="answer-loading">
                          {getStreamingStatusText(message.runState?.phase)}
                        </p>
                      )
                    )}
                    {message.status === 'done' && message.content && (
                      <Space>
                        <Button
                          className="answer-voice-btn"
                          icon={<SoundOutlined />}
                          loading={
                            ttsStatusByMessageId[message.id] === 'connecting' ||
                            ttsStatusByMessageId[message.id] === 'synthesizing'
                          }
                          onClick={() =>
                            handlePlayTts(message.id, message.content)
                          }
                          size="small"
                          type="text"
                        >
                          {getTtsButtonText(ttsStatusByMessageId[message.id])}
                        </Button>
                        <Button
                          icon={<FlagOutlined />}
                          onClick={() => {
                            setBadCaseMessage(message);
                            badCaseForm.resetFields();
                            badCaseForm.setFieldValue(
                              'correctedAnswer',
                              message.content,
                            );
                          }}
                          size="small"
                          type="text"
                        >
                          提交 Bad Case
                        </Button>
                      </Space>
                    )}
                    {message.media && message.media.length > 0 && (
                      <div className="answer-media-grid">
                        {message.media.map((item) => (
                          <figure key={item.id}>
                            <img
                              alt={item.alt ?? item.title ?? '回答图片'}
                              loading="lazy"
                              src={item.url}
                            />
                            {(item.title || item.alt) && (
                              <figcaption>{item.title ?? item.alt}</figcaption>
                            )}
                          </figure>
                        ))}
                      </div>
                    )}
                    {message.artifacts && message.artifacts.length > 0 && (
                      <div className="answer-artifacts">
                        {message.artifacts.map((artifact) => (
                          <article key={artifact.id}>
                            <FileAddOutlined />
                            <div>
                              <strong>{artifact.title}</strong>
                              <span>{artifact.filename}</span>
                            </div>
                            <Tag
                              color={
                                artifact.status === 'ready'
                                  ? 'success'
                                  : artifact.status === 'failed'
                                    ? 'error'
                                    : 'processing'
                              }
                            >
                              {
                                {
                                  queued: '排队中',
                                  generating: '生成中',
                                  ready: '可下载',
                                  failed: '失败',
                                }[artifact.status]
                              }
                            </Tag>
                            <Button
                              disabled={artifact.status !== 'ready'}
                              icon={<DownloadOutlined />}
                              onClick={() =>
                                void downloadArtifact(
                                  artifact.id,
                                  artifact.filename,
                                ).catch((error) =>
                                  antdMessage.error(error.message),
                                )
                              }
                              size="small"
                              title="下载"
                            />
                            <Button
                              disabled={artifact.status !== 'ready'}
                              icon={<ShareAltOutlined />}
                              onClick={() => {
                                setSelectedArtifact(artifact);
                                shareForm.setFieldsValue({
                                  visibility: 'external',
                                  expiresInHours: 72,
                                });
                                setShareModalOpen(true);
                              }}
                              size="small"
                              title="分享"
                            />
                          </article>
                        ))}
                      </div>
                    )}
                    {message.route && (
                      <div className="answer-meta">
                        <span>
                          处理方式：{routeLabel[message.route] ?? message.route}
                        </span>
                        {message.retrievalSufficient !== undefined && (
                          <span>
                            证据：
                            {message.retrievalSufficient
                              ? '已确认'
                              : '资料不足'}
                          </span>
                        )}
                        {message.retrievalSufficient !== false &&
                          message.confidence !== undefined && (
                            <span>
                              回答评分：{message.confidence.toFixed(2)}
                            </span>
                          )}
                        {message.retryCount !== undefined &&
                          message.retryCount > 0 && (
                            <span>重试：{message.retryCount}</span>
                          )}
                        {message.model && (
                          <span>
                            模型：
                            {message.model === 'qwen'
                              ? '通义千问'
                              : message.model === 'zhipu'
                                ? '智谱 GLM'
                                : 'DeepSeek'}
                          </span>
                        )}
                      </div>
                    )}
                    {message.status === 'done' &&
                      message.retrievalSufficient === false && (
                        <div className="answer-insufficient">
                          <strong>
                            {insufficientEvidenceMessage(message.route)}
                          </strong>
                          <span>
                            可补充版本、项目、时间范围或具体业务场景后重新提问。
                          </span>
                          <Button
                            onClick={() => {
                              const sourceQuery = messages
                                .slice(0, messageIndex)
                                .reverse()
                                .find((item) => item.role === 'user')?.content;
                              setInput(`${sourceQuery ?? ''}\n\n补充信息：`);
                            }}
                            size="small"
                          >
                            补充问题信息
                          </Button>
                        </div>
                      )}
                    {(message.retrievalReason ||
                      (message.events && message.events.length > 0)) && (
                      <details className="answer-debug-details">
                        <summary>查看检索与运行详情</summary>
                        {message.runState && (
                          <div className="run-state-timeline">
                            {[
                              'routing',
                              'retrieval',
                              'evidence',
                              'generation',
                              'citation',
                              'completed',
                            ].map((phase) => (
                              <span
                                key={phase}
                                className={
                                  message.runState?.phase === phase
                                    ? 'active'
                                    : ''
                                }
                              >
                                {phase === 'routing'
                                  ? '路由'
                                  : phase === 'retrieval'
                                    ? '检索'
                                    : phase === 'evidence'
                                      ? '证据'
                                      : phase === 'generation'
                                        ? '生成'
                                        : phase === 'citation'
                                          ? '引用'
                                          : '完成'}
                              </span>
                            ))}
                          </div>
                        )}
                        {message.retrievalReason && (
                          <p className="retrieval-reason">
                            {message.retrievalReason}
                          </p>
                        )}
                        {message.events && message.events.length > 0 && (
                          <p className="event-trace">
                            {formatEventTrace(message.events)}
                          </p>
                        )}
                      </details>
                    )}
                    {message.references && message.references.length > 0 && (
                      <div className="reference-box">
                        <strong>引用文档（{message.references.length}）</strong>
                        <div>
                          {message.references.map((item) => (
                            <article key={`${item.id}-${item.chunkIndex}`}>
                              <FileWordOutlined className="file-icon word" />
                              <div>
                                {isConversationAttachmentReference(item) ? (
                                  <strong>{referenceLabel(item)}</strong>
                                ) : (
                                  <a
                                    href={
                                      isExternalReference(item)
                                        ? item.docId
                                        : undefined
                                    }
                                    target={
                                      isExternalReference(item)
                                        ? '_blank'
                                        : undefined
                                    }
                                    rel={
                                      isExternalReference(item)
                                        ? 'noreferrer'
                                        : undefined
                                    }
                                    onClick={(event) => {
                                      if (!isExternalReference(item)) {
                                        event.preventDefault();
                                        history.push(
                                          `/documents/${encodeURIComponent(item.docId)}`,
                                        );
                                      }
                                    }}
                                  >
                                    {referenceLabel(item)}
                                  </a>
                                )}
                                <span>
                                  {isConversationAttachmentReference(item)
                                    ? `当前会话附件 · ${item.citationLabel ?? `片段 ${item.chunkIndex}`}`
                                    : `${isExternalReference(item) ? '外部网页' : '本地知识库'} · chunk #${item.chunkIndex} · score ${(item.totalScore ?? 0).toFixed(2)}`}
                                </span>
                              </div>
                            </article>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ),
            )}
          </div>
          {messages.length === 0 && (
            <div className="qa-role-workspace">
              <div className="qa-role-intro">
                <span className="qa-role-mark">
                  {activeRolePreset?.shortName ?? '岗位'}
                </span>
                <div>
                  <strong>{activeRolePreset?.name ?? '岗位能力加载中'}</strong>
                  <p>{activeRolePreset?.summary}</p>
                </div>
              </div>
              <div className="qa-role-responsibilities">
                {activeRolePreset?.responsibilities.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
              <div className="qa-role-actions">
                <strong>常用任务</strong>
                <div>
                  {activeRolePreset?.starterTasks.map((item) => (
                    <Button key={item} onClick={() => setInput(item)}>
                      {item}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="qa-role-questions">
                <strong>直接开始</strong>
                <div>
                  {activeRolePreset?.suggestedQuestions.map((item) => (
                    <button
                      key={item}
                      onClick={() => setInput(item)}
                      type="button"
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          <div className="chat-input">
            <input
              ref={attachmentInputRef}
              accept=".png,.jpg,.jpeg,.gif,.webp,.bmp,.md,.markdown,.docx,.pdf"
              aria-label="上传对话附件"
              hidden
              multiple
              onChange={(event) => void handleAttachmentSelection(event)}
              type="file"
            />
            <Input.TextArea
              autoSize={{ minRows: 2, maxRows: 3 }}
              maxLength={2000}
              onChange={(event) => setInput(event.target.value)}
              onPressEnter={(event) => {
                if (!event.shiftKey) {
                  event.preventDefault();
                  handleSend();
                }
              }}
              placeholder="请输入问题，Shift + Enter 换行"
              value={input}
            />
            {attachments.length > 0 && (
              <div className="qa-attachment-list" aria-live="polite">
                {attachments.map((attachment) => (
                  <div
                    className={`qa-attachment-item ${attachment.status ?? 'ready'}`}
                    key={attachment.id}
                    title={attachment.errorMessage ?? attachment.filename}
                  >
                    <FileWordOutlined />
                    <span className="qa-attachment-name">
                      {attachment.filename}
                    </span>
                    <span className="qa-attachment-status">
                      {attachment.status === 'uploading'
                        ? '解析中…'
                        : attachment.status === 'error'
                          ? '解析失败'
                          : `${Math.ceil(attachment.size / 1024)} KB`}
                    </span>
                    <Button
                      aria-label={`移除 ${attachment.filename}`}
                      disabled={attachment.status === 'uploading'}
                      icon={<CloseOutlined />}
                      onClick={() => void handleRemoveAttachment(attachment)}
                      size="small"
                      type="text"
                    />
                  </div>
                ))}
                <span className="qa-attachment-note">
                  附件只用于当前会话，不会进入长期知识库
                </span>
              </div>
            )}
            <div>
              <select
                aria-label="模型"
                onChange={(event) => setModel(event.target.value as ChatModel)}
                value={model}
              >
                {modelOptions.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
              <span className="chat-plugin-label">插件</span>
              <Select
                aria-label="插件能力包"
                className="chat-plugin-control"
                mode="multiple"
                allowClear
                maxTagCount="responsive"
                placeholder={
                  availableQaPlugins.length
                    ? '选择插件能力包（可多选）'
                    : '当前链路暂无可用插件'
                }
                value={pluginKeys}
                disabled={!availableQaPlugins.length}
                options={availableQaPlugins.map((plugin) => ({
                  label: plugin.displayName ?? plugin.key,
                  value: plugin.key,
                  title: plugin.key,
                }))}
                onChange={(values) => setPluginKeys(values)}
              />
              <span>{input.length} / 2000</span>
              <Button
                disabled={
                  loading || attachmentUploading || attachments.length >= 5
                }
                icon={<PaperClipOutlined />}
                onClick={() => attachmentInputRef.current?.click()}
              >
                附件
              </Button>
              <Button
                disabled={
                  loading ||
                  (!input.trim() &&
                    !messages.length &&
                    !attachments.some((item) => item.status === 'ready'))
                }
                icon={<FileAddOutlined />}
                onClick={() => openArtifactModal()}
              >
                生成文件
              </Button>
              <Button
                disabled={
                  (!input.trim() &&
                    !attachments.some((item) => item.status === 'ready')) ||
                  loading ||
                  attachmentUploading
                }
                icon={<SendOutlined />}
                loading={loading}
                onClick={handleSend}
                type="primary"
              >
                发送
              </Button>
            </div>
          </div>
        </section>
      </div>
      <Modal
        open={Boolean(badCaseMessage)}
        title="提交 Bad Case"
        okText="提交审核"
        confirmLoading={badCaseSubmitting}
        onCancel={() => setBadCaseMessage(null)}
        onOk={async () => {
          if (!threadId || !badCaseMessage) return;
          const values = await badCaseForm.validateFields();
          setBadCaseSubmitting(true);
          try {
            await submitConversationBadCase(threadId, values);
            antdMessage.success('Bad Case 已提交，等待审核');
            setBadCaseMessage(null);
          } catch (error) {
            antdMessage.error(
              error instanceof Error ? error.message : '提交失败',
            );
          } finally {
            setBadCaseSubmitting(false);
          }
        }}
      >
        <Form form={badCaseForm} layout="vertical">
          <Form.Item
            label="错误类型"
            name="errorType"
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { value: 'retrieval_miss', label: '召回遗漏' },
                { value: 'ranking_error', label: '排序错误' },
                { value: 'citation_error', label: '引用错误' },
                { value: 'hallucination', label: '幻觉／编造' },
                { value: 'outdated_content', label: '内容过期' },
                { value: 'incomplete_answer', label: '回答不完整' },
                { value: 'other', label: '其他' },
              ]}
            />
          </Form.Item>
          <Form.Item label="问题描述" name="comment">
            <Input.TextArea rows={3} placeholder="说明回答哪里不对" />
          </Form.Item>
          <Form.Item
            label="纠正答案"
            name="correctedAnswer"
            rules={[{ required: true, whitespace: true }]}
          >
            <Input.TextArea rows={6} />
          </Form.Item>
          <Form.Item
            label="允许进入回归集"
            name="includeInRegression"
            initialValue={false}
            valuePropName="checked"
          >
            <Switch checkedChildren="是" unCheckedChildren="否" />
          </Form.Item>
        </Form>
      </Modal>
      <Drawer
        open={artifactDrawerOpen}
        onClose={() => setArtifactDrawerOpen(false)}
        size="large"
        title="生成文件"
        extra={
          <Button
            icon={<FileAddOutlined />}
            type="primary"
            onClick={() => openArtifactModal()}
          >
            新建
          </Button>
        }
      >
        <div className="artifact-list" aria-busy={artifactLoading}>
          {!artifacts.length && !artifactLoading ? (
            <p className="artifact-empty">暂无生成文件</p>
          ) : (
            artifacts.map((artifact) => (
              <article className="artifact-item" key={artifact.id}>
                <div className="artifact-item-main">
                  <strong>{artifact.title}</strong>
                  <span>{artifact.filename}</span>
                  {artifact.errorMessage && <p>{artifact.errorMessage}</p>}
                </div>
                <div className="artifact-item-actions">
                  <Tag>{artifactKindLabel[artifact.kind]}</Tag>
                  <Tag
                    color={
                      artifact.status === 'ready'
                        ? 'success'
                        : artifact.status === 'failed'
                          ? 'error'
                          : 'processing'
                    }
                  >
                    {
                      {
                        queued: '排队中',
                        generating: '生成中',
                        ready: '可下载',
                        failed: '失败',
                      }[artifact.status]
                    }
                  </Tag>
                  <Button
                    disabled={artifact.status !== 'ready'}
                    icon={<DownloadOutlined />}
                    onClick={() =>
                      void downloadArtifact(
                        artifact.id,
                        artifact.filename,
                      ).catch((error) => antdMessage.error(error.message))
                    }
                    title="下载"
                  />
                  <Button
                    disabled={artifact.status !== 'ready'}
                    icon={<ShareAltOutlined />}
                    onClick={() => {
                      setSelectedArtifact(artifact);
                      shareForm.setFieldsValue({
                        visibility: 'external',
                        expiresInHours: 72,
                      });
                      setShareModalOpen(true);
                    }}
                    title="分享"
                  />
                </div>
              </article>
            ))
          )}
        </div>
      </Drawer>
      <Modal
        open={artifactModalOpen}
        zIndex={1100}
        title="生成可传播文件"
        okText="开始生成"
        cancelText="取消"
        confirmLoading={artifactSubmitting}
        onCancel={() => setArtifactModalOpen(false)}
        onOk={() => void handleCreateArtifact()}
      >
        <Form form={artifactForm} layout="vertical" preserve={false}>
          <Form.Item
            name="title"
            label="文件标题"
            rules={[{ required: true, message: '请输入文件标题' }]}
          >
            <Input maxLength={80} />
          </Form.Item>
          <Form.Item name="kind" label="文件类型" rules={[{ required: true }]}>
            <Select
              options={Object.entries(artifactKindLabel).map(
                ([value, label]) => ({ value, label }),
              )}
            />
          </Form.Item>
          <Form.Item
            name="sourceText"
            label="文件内容"
            rules={[{ required: true, message: '请输入或保留问答内容' }]}
          >
            <Input.TextArea
              autoSize={{ minRows: 8, maxRows: 16 }}
              maxLength={200000}
            />
          </Form.Item>
          <Form.Item name="prompt" label="图片补充描述">
            <Input.TextArea
              autoSize={{ minRows: 2, maxRows: 4 }}
              maxLength={4000}
            />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        open={shareModalOpen}
        title={`分享：${selectedArtifact?.title ?? ''}`}
        okText="创建并复制链接"
        cancelText="取消"
        confirmLoading={artifactSubmitting}
        onCancel={() => setShareModalOpen(false)}
        onOk={() => void handleCreateShare()}
      >
        <Form form={shareForm} layout="vertical" preserve={false}>
          <Form.Item
            name="visibility"
            label="分享范围"
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { value: 'external', label: '外部分享，无需登录' },
                { value: 'internal', label: '内部分享，需要登录' },
              ]}
            />
          </Form.Item>
          <Form.Item name="expiresInHours" label="有效时长（小时）">
            <InputNumber min={1} max={8760} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="maxDownloads" label="最多下载次数">
            <InputNumber
              min={1}
              max={100000}
              placeholder="不填则不限次数"
              style={{ width: '100%' }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </ModulePage>
  );
}
