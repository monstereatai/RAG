import { Injectable, Logger } from '@nestjs/common';
import type {
  ISubAgent,
  AgentInput,
  AgentOutput,
  AgentPipelineState,
} from './agent.interface';
import { ResearcherAgent } from './researcher.agent';
import { AnalystAgent } from './analyst.agent';
import { WriterAgent } from './writer.agent';
import { CriticAgent } from './critic.agent';
import { EditorAgent } from './editor.agent';

/**
 * 子 Agent 编排管线服务
 *
 * 支持两种编排模式：
 * 1. sequential — 顺序管线：researcher → analyst → writer → critic → editor
 * 2. partial — 部分管线：按需选择子集 Agent 执行
 */
@Injectable()
export class AgentPipelineService {
  private readonly logger = new Logger(AgentPipelineService.name);
  private readonly agentRegistry: Map<string, ISubAgent>;

  constructor(
    private readonly researcher: ResearcherAgent,
    private readonly analyst: AnalystAgent,
    private readonly writer: WriterAgent,
    private readonly critic: CriticAgent,
    private readonly editor: EditorAgent,
  ) {
    this.agentRegistry = new Map<string, ISubAgent>([
      ['researcher', researcher],
      ['analyst', analyst],
      ['writer', writer],
      ['critic', critic],
      ['editor', editor],
    ]);
  }

  /**
   * 顺序执行完整管线：researcher → analyst → writer → critic → editor
   * 每个 Agent 的输出作为下一个 Agent 的上下文输入
   */
  async runSequential(
    task: string,
    context?: string,
    onStage?: (agent: string, output: AgentOutput) => void,
    signal?: AbortSignal,
  ): Promise<AgentPipelineState> {
    const pipeline: ISubAgent[] = [
      this.researcher,
      this.analyst,
      this.writer,
      this.critic,
      this.editor,
    ];

    const state: AgentPipelineState = {
      task,
      stages: [],
      overallConfidence: 0,
    };

    let currentContext = context ?? '';

    for (const agent of pipeline) {
      signal?.throwIfAborted();
      this.logger.log(`Pipeline stage: ${agent.name}`);

      const input: AgentInput = {
        task,
        context: currentContext,
        signal,
      };

      const output = await agent.execute(input);
      state.stages.push(output);
      currentContext = output.content;

      onStage?.(agent.name, output);

      // 如果某个阶段完全失败，仍继续但标记
      if (output.confidence === 0) {
        this.logger.warn(
          `Pipeline stage ${agent.name} failed, continuing with degraded quality`,
        );
      }
    }

    // 最终输出取最后一个 Agent（editor）的内容
    const lastStage = state.stages[state.stages.length - 1];
    state.finalOutput = lastStage?.content ?? '';

    // 综合置信度：取所有阶段的加权平均
    const totalConf = state.stages.reduce((sum, s) => sum + s.confidence, 0);
    state.overallConfidence =
      state.stages.length > 0 ? totalConf / state.stages.length : 0;

    this.logger.log(
      `Pipeline completed: ${state.stages.length} stages, overall confidence=${state.overallConfidence.toFixed(2)}`,
    );

    return state;
  }

  /**
   * 部分管线：只执行指定的 Agent 子集
   */
  async runPartial(
    task: string,
    agentNames: string[],
    context?: string,
    signal?: AbortSignal,
  ): Promise<AgentPipelineState> {
    const state: AgentPipelineState = {
      task,
      stages: [],
      overallConfidence: 0,
    };

    let currentContext = context ?? '';

    for (const name of agentNames) {
      signal?.throwIfAborted();
      const agent = this.agentRegistry.get(name);
      if (!agent) {
        this.logger.warn(`Agent "${name}" not found in registry, skipping`);
        continue;
      }

      const output = await agent.execute({
        task,
        context: currentContext,
        signal,
      });
      state.stages.push(output);
      currentContext = output.content;
    }

    const lastStage = state.stages[state.stages.length - 1];
    state.finalOutput = lastStage?.content ?? '';
    const totalConf = state.stages.reduce((sum, s) => sum + s.confidence, 0);
    state.overallConfidence =
      state.stages.length > 0 ? totalConf / state.stages.length : 0;

    return state;
  }

  /**
   * 列出所有已注册的 Agent
   */
  listAgents(): Array<{ name: string; role: string }> {
    return Array.from(this.agentRegistry.values()).map((agent) => ({
      name: agent.name,
      role: agent.role,
    }));
  }
}
