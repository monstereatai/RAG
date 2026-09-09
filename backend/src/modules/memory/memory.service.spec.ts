/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

/* eslint-disable @typescript-eslint/no-unsafe-call */

import { Test, TestingModule } from '@nestjs/testing';
import { MemoryService } from './memory.service';
import { Mem0Provider } from '../../providers/mem0/mem0.provider';
import { LlmProvider } from '../../providers/llm/llm.provider';

describe('MemoryService', () => {
  let service: MemoryService;
  let mockMem0Provider: any;
  let mockLlmProvider: any;
  let mockModel: any;

  beforeEach(async () => {
    mockMem0Provider = {
      isEnabled: jest.fn().mockReturnValue(true),
      search: jest.fn(),
      add: jest.fn(),
      getAll: jest.fn(),
      deleteAll: jest.fn(),
    };

    mockModel = {
      withStructuredOutput: jest.fn().mockReturnThis(),
      invoke: jest.fn(),
    };

    mockLlmProvider = {
      getModel: jest.fn().mockReturnValue(mockModel),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemoryService,
        { provide: Mem0Provider, useValue: mockMem0Provider },
        { provide: LlmProvider, useValue: mockLlmProvider },
      ],
    }).compile();

    service = module.get<MemoryService>(MemoryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('isEnabled', () => {
    it('should return mem0Provider.isEnabled()', () => {
      mockMem0Provider.isEnabled.mockReturnValueOnce(true);
      expect(service.isEnabled()).toBe(true);

      mockMem0Provider.isEnabled.mockReturnValueOnce(false);
      expect(service.isEnabled()).toBe(false);
    });
  });

  describe('searchMemory', () => {
    it('should return empty memories if mem0 is disabled', async () => {
      mockMem0Provider.isEnabled.mockReturnValue(false);
      const res = await service.searchMemory('query', 'user-1');
      expect(res).toEqual({
        userMemories: [],
        sessionMemories: [],
        systemMessage: null,
      });
    });

    it('should search user and session memories and build system message', async () => {
      mockMem0Provider.search.mockImplementation(
        ({ runId }: { runId?: string }) => {
          if (runId) {
            return Promise.resolve([
              { id: 's1', memory: 'Session memory snippet' },
            ]);
          }
          return Promise.resolve([{ id: 'u1', memory: 'User memory snippet' }]);
        },
      );

      const res = await service.searchMemory('query', 'user-1', 'conv-1');
      expect(res.userMemories).toEqual([
        { id: 'u1', memory: 'User memory snippet' },
      ]);
      expect(res.sessionMemories).toEqual([
        { id: 's1', memory: 'Session memory snippet' },
      ]);
      expect(res.systemMessage).toBeDefined();
      expect(res.systemMessage?.content).toContain('【用户长期记忆】');
      expect(res.systemMessage?.content).toContain('User memory snippet');
      expect(res.systemMessage?.content).toContain('【当前会话记忆】');
      expect(res.systemMessage?.content).toContain('Session memory snippet');
    });
  });

  describe('classifyAndPersist', () => {
    it('should return disabled result if mem0 is disabled', async () => {
      mockMem0Provider.isEnabled.mockReturnValue(false);
      const res = await service.classifyAndPersist(
        'user-1',
        'conv-1',
        'hi',
        'hello',
      );
      expect(res).toEqual({ written: [], reason: 'mem0 disabled' });
    });

    it('should classify and call mem0Provider.add for user memory', async () => {
      mockModel.invoke.mockResolvedValue({
        write_user: true,
        write_session: false,
        reason: 'User mentioned a long term preference',
      });

      const res = await service.classifyAndPersist(
        'user-1',
        'conv-1',
        'I like Python',
        'Understood',
      );
      expect(res.written).toEqual(['user']);
      expect(res.reason).toBe('User mentioned a long term preference');
      expect(mockMem0Provider.add).toHaveBeenCalledWith({
        messages: [
          { role: 'user', content: 'I like Python' },
          { role: 'assistant', content: 'Understood' },
        ],
        userId: 'user-1',
      });
      expect(mockMem0Provider.add).not.toHaveBeenCalledWith(
        expect.objectContaining({ runId: 'conv-1' }),
      );
    });

    it('should classify and call mem0Provider.add for session memory', async () => {
      mockModel.invoke.mockResolvedValue({
        write_user: false,
        write_session: true,
        reason: 'User specified session task',
      });

      const res = await service.classifyAndPersist(
        'user-1',
        'conv-1',
        'For this session let us do math',
        'Sure',
      );
      expect(res.written).toEqual(['session']);
      expect(mockMem0Provider.add).toHaveBeenCalledWith({
        messages: [
          { role: 'user', content: 'For this session let us do math' },
          { role: 'assistant', content: 'Sure' },
        ],
        userId: 'user-1',
        runId: 'conv-1',
      });
    });
  });

  describe('listMemories and clearMemories', () => {
    it('should list memories', async () => {
      mockMem0Provider.getAll.mockResolvedValue([{ id: '1', memory: 'Fact' }]);
      const res = await service.listMemories('user-1');
      expect(res).toEqual([{ id: '1', memory: 'Fact' }]);
      expect(mockMem0Provider.getAll).toHaveBeenCalledWith('user-1');
    });

    it('should clear memories', async () => {
      await service.clearMemories('user-1');
      expect(mockMem0Provider.deleteAll).toHaveBeenCalledWith('user-1');
    });
  });
});
