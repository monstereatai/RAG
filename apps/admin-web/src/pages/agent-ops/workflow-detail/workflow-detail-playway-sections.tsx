import { CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { Button, Card, Collapse, Form, Input, Tag } from 'antd';
import type { WorkflowDetailLoadedController } from './workflow-detail-controller';
import { ROLE_LABELS, SelectRoles } from './workflow-detail-shared';

export function renderWorkflowPlayway(
  controller: WorkflowDetailLoadedController,
) {
  const {
    form,
    workflow,
    submitting,
    componentRules,
    componentQuery,
    setComponentQuery,
    activityTemplates,
    searchComponentRules,
    handleResume,
    handleRevise,
  } = controller;
  return (
    <>
      <Card title="Playway 组件规则" style={{ marginTop: 16 }}>
        <Input.Search
          placeholder="搜索活动或玩法，例如：新服预约 抽卡"
          allowClear
          value={componentQuery}
          onChange={(event) => setComponentQuery(event.target.value)}
          onSearch={(value) => void searchComponentRules(value)}
          style={{ maxWidth: 520, marginBottom: 12 }}
        />
        <Collapse
          items={componentRules.map((rule) => ({
            key: rule.type,
            label: `${rule.displayName}（${rule.type}）`,
            children: (
              <div>
                <p>{rule.description}</p>
                <p>依赖：{rule.requires.join('、') || '无'}</p>
                <p>配置字段：{rule.configFields.join('、') || '无'}</p>
                <p>产出事件：{rule.emits.join('、') || '无'}</p>
                <Tag
                  color={
                    rule.risk === 'high'
                      ? 'red'
                      : rule.risk === 'medium'
                        ? 'orange'
                        : 'green'
                  }
                >
                  风险：{rule.risk}
                </Tag>
                {rule.compliance.map((item) => (
                  <Tag key={item}>{item}</Tag>
                ))}
              </div>
            ),
          }))}
        />
      </Card>
      <Card title="Playway 活动模板" style={{ marginTop: 16 }}>
        <Collapse
          items={activityTemplates.map((template) => ({
            key: template.id,
            label: template.name,
            children: (
              <div>
                <p>{template.goal}</p>
                <p>必选组件：{template.requiredComponents.join('、')}</p>
                <p>可选组件：{template.optionalComponents.join('、')}</p>
                <p>接口：{template.requiredApis.join('、')}</p>
                <p>埋点：{template.requiredEvents.join('、')}</p>
                <p>验收：</p>
                {template.acceptanceChecks.map((check) => (
                  <p key={check} style={{ marginBottom: 4 }}>
                    ・{check}
                  </p>
                ))}
                {template.riskNotes.map((risk) => (
                  <Tag key={risk} color="orange">
                    {risk}
                  </Tag>
                ))}
              </div>
            ),
          }))}
        />
      </Card>
      {workflow.requiresApproval && (
        <Card title="审批操作" style={{ marginTop: 16 }}>
          <Form form={form} layout="vertical">
            <Form.Item name="feedback" label="审批意见">
              <Input.TextArea
                rows={3}
                placeholder="驳回时必须填写具体修改意见"
              />
            </Form.Item>
            <Form.Item name="rerunRoles" label="需要修订的岗位">
              <SelectRoles roles={workflow.currentBatch} />
            </Form.Item>
            <Button
              icon={<CheckOutlined />}
              type="primary"
              loading={submitting}
              onClick={() => void handleResume('approved')}
            >
              批准并继续
            </Button>
            <Button
              icon={<CloseOutlined />}
              danger
              loading={submitting}
              onClick={() => void handleResume('rejected')}
              style={{ marginLeft: 8 }}
            >
              驳回并要求修订
            </Button>
          </Form>
        </Card>
      )}
      {workflow.requiresRevision && (
        <Card
          title={`待修订：准备生成 v${workflow.revisionNumber ?? 2}`}
          style={{ marginTop: 16 }}
        >
          <Form form={form} layout="vertical">
            <p>
              <strong>驳回意见：</strong>
              {workflow.feedback}
            </p>
            <p>
              <strong>受影响下游：</strong>
              {(workflow.staleRoles ?? [])
                .map((role) => ROLE_LABELS[role])
                .join('、') || '无'}
            </p>
            <Form.Item
              name="rerunRoles"
              label="本次局部重试岗位"
              extra="只能从被驳回的岗位中选择；受影响下游会在修订版本审批通过后按依赖重新执行。"
            >
              <SelectRoles roles={workflow.rerunRoles} />
            </Form.Item>
            <Form.Item
              name="supplementalMaterials"
              label="补充缺失资料／已核验来源／业务约束"
              extra="可填写规则补充、接口字段、来源链接或验收约束。本次仅作为待核验修订上下文；要成为正式知识请另行走文档入库和审核。"
            >
              <Input.TextArea
                rows={6}
                maxLength={12000}
                showCount
                placeholder="例如：库存扣减以 reward_stock.remaining 为准；发奖失败须写入 compensation_queue；已核验来源：https://…"
              />
            </Form.Item>
            <Button
              type="primary"
              loading={submitting}
              onClick={() => void handleRevise()}
            >
              提交修订包并局部重试
            </Button>
          </Form>
        </Card>
      )}
      {(workflow.revisionHistory ?? []).length > 0 && (
        <Card title="产物版本历史" style={{ marginTop: 16 }}>
          <Collapse
            items={(workflow.revisionHistory ?? []).map((record) => ({
              key: String(record.revision),
              label: `v${record.revision} · 已驳回 · ${new Date(record.rejectedAt).toLocaleString()}`,
              children: (
                <div>
                  <p>
                    <strong>驳回意见：</strong>
                    {record.feedback}
                  </p>
                  <p>
                    <strong>驳回岗位：</strong>
                    {record.rejectedRoles
                      .map((role) => ROLE_LABELS[role])
                      .join('、')}
                  </p>
                  <p>
                    <strong>下游过期：</strong>
                    {record.staleRoles
                      .map((role) => ROLE_LABELS[role])
                      .join('、') || '无'}
                  </p>
                  {record.revisedAt && (
                    <>
                      <p>
                        <strong>局部重试：</strong>
                        {(record.rerunRoles ?? [])
                          .map((role) => ROLE_LABELS[role])
                          .join('、')}
                      </p>
                      <p>
                        <strong>补充资料：</strong>
                        {record.supplementalMaterials || '未补充'}
                      </p>
                    </>
                  )}
                </div>
              ),
            }))}
          />
        </Card>
      )}
    </>
  );
}
