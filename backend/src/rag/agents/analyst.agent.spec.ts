/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { Test, TestingModule } from '@nestjs/testing';
import { AnalystAgent } from './analyst.agent';
import { LlmProvider } from '../../providers/llm/llm.provider';

describe('AnalystAgent', () => {
  let agent: AnalystAgent;
  let mockLlmProvider: any;
  let mockModel: any;

  beforeEach(async () => {
    mockModel = {
      invoke: jest.fn().mockResolvedValue({
        content: 'Fallback analysis output',
      }),
    };

    mockLlmProvider = {
      getModel: jest.fn().mockReturnValue(mockModel),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalystAgent,
        { provide: LlmProvider, useValue: mockLlmProvider },
      ],
    }).compile();

    agent = module.get<AnalystAgent>(AnalystAgent);
  });

  it('should be defined', () => {
    expect(agent).toBeDefined();
  });

  it('should fallback to standard model invoke if DeepAgent or QuickJS fails', async () => {
    const res = await agent.execute({
      task: 'Compare Vue vs React performance',
      context: 'Vue render: 5ms, React render: 12ms',
    });

    expect(res.agent).toBe('analyst');
    expect(res.content).toBe('Fallback analysis output');
    expect(res.confidence).toBe(0.8);
    expect(mockModel.invoke).toHaveBeenCalled();
  });
});
