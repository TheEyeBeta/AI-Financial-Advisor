import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatTurnActiveError, chatApi, chatsApi, chatTurnApi } from '../chat-api';
import { newsApi } from '../news-api';
import { portfolioApi, tradesApi } from '../trading-api';
import { learningApi } from '../user-data-api';

// Mock supabase with a more robust mock
const createChainableMock = (finalResult: { data: unknown; error: unknown; count?: number | null }) => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(finalResult),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    abortSignal: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(finalResult),
    then: (resolve: (val: typeof finalResult) => void) => Promise.resolve(resolve(finalResult)),
  };
  return chain;
};

let mockChain = createChainableMock({ data: [], error: null });
let mockChainsByTable: Record<string, ReturnType<typeof createChainableMock>> = {};
let mockSchemaChainsBySchemaAndTable: Record<string, ReturnType<typeof createChainableMock>> = {};
let mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });

vi.mock('@/lib/supabase', () => {
  const schema = vi.fn((schemaName: string) => ({
    from: vi.fn((table: string) => mockSchemaChainsBySchemaAndTable[`${schemaName}.${table}`] ?? mockChainsByTable[table] ?? mockChain),
  }));

  return {
    supabase: {
      from: vi.fn((table: string) => mockChainsByTable[table] ?? mockChain),
      schema,
    },
    aiDb: {
      from: vi.fn((table: string) => mockSchemaChainsBySchemaAndTable[`ai.${table}`] ?? mockChainsByTable[table] ?? mockChain),
      rpc: (...args: unknown[]) => mockRpc(...args),
    },
    getCurrentUserId: vi.fn().mockResolvedValue('user-123'),
  };
});

beforeEach(() => {
  mockChain = createChainableMock({ data: [], error: null });
  mockChainsByTable = {};
  mockSchemaChainsBySchemaAndTable = {};
  mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });
});

describe('tradesApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAll', () => {
    it('fetches all trades for a user', async () => {
      const mockTrades = [
        { id: '1', symbol: 'AAPL', action: 'BUY', quantity: 10, entry_price: 150 },
        { id: '2', symbol: 'GOOGL', action: 'SELL', quantity: 5, entry_price: 2800 },
      ];

      mockChain = createChainableMock({ data: mockTrades, error: null });

      const result = await tradesApi.getAll('user-123');

      expect(mockChain.select).toHaveBeenCalledWith('*');
      expect(mockChain.eq).toHaveBeenCalledWith('user_id', 'user-123');
      expect(result).toEqual(mockTrades);
    });

    it('returns empty array when no trades exist', async () => {
      mockChain = createChainableMock({ data: null, error: null });

      const result = await tradesApi.getAll('user-123');

      expect(result).toEqual([]);
    });

    it('throws error on fetch failure', async () => {
      const mockError = new Error('Database error');
      mockChain = createChainableMock({ data: null, error: mockError });

      await expect(tradesApi.getAll('user-123')).rejects.toThrow('Database error');
    });
  });

  describe('getStatistics', () => {
    it('calculates correct win rate and statistics', async () => {
      const mockTrades = [
        { id: '1', pnl: 100, action: 'CLOSED' },  // winner
        { id: '2', pnl: 200, action: 'CLOSED' },  // winner
        { id: '3', pnl: -50, action: 'CLOSED' },  // loser
        { id: '4', pnl: -30, action: 'CLOSED' },  // loser
      ];

      mockChain = createChainableMock({ data: mockTrades, error: null });

      const stats = await tradesApi.getStatistics('user-123');

      expect(stats.totalTrades).toBe(4);
      expect(stats.winningTrades).toBe(2);
      expect(stats.losingTrades).toBe(2);
      expect(stats.winRate).toBe(50); // 2 wins out of 4 trades = 50%
      expect(stats.avgProfit).toBe(150); // (100 + 200) / 2 = 150
      expect(stats.avgLoss).toBe(40); // (50 + 30) / 2 = 40
    });

    it('handles zero trades correctly', async () => {
      mockChain = createChainableMock({ data: [], error: null });

      const stats = await tradesApi.getStatistics('user-123');

      expect(stats.winRate).toBe(0);
      expect(stats.totalTrades).toBe(0);
      expect(stats.profitFactor).toBe(0);
    });

    it('calculates profit factor correctly', async () => {
      const mockTrades = [
        { id: '1', pnl: 200, action: 'CLOSED' },  // winner
        { id: '2', pnl: -100, action: 'CLOSED' }, // loser
      ];

      mockChain = createChainableMock({ data: mockTrades, error: null });

      const stats = await tradesApi.getStatistics('user-123');

      // avgProfit = 200, avgLoss = 100
      // profitFactor = 200 / 100 = 2
      expect(stats.profitFactor).toBe(2);
    });
  });

  describe('create', () => {
    it('creates a new trade', async () => {
      const newTrade = {
        symbol: 'AAPL',
        action: 'BUY' as const,
        quantity: 10,
        entry_price: 150,
        entry_date: '2024-01-15',
        exit_date: null,
        exit_price: null,
        pnl: null,
        notes: 'Test trade',
      };

      const createdTrade = {
        id: 'trade-123',
        user_id: 'user-123',
        ...newTrade,
        created_at: '2024-01-15T00:00:00Z',
        updated_at: '2024-01-15T00:00:00Z',
      };

      mockChain = createChainableMock({ data: createdTrade, error: null });

      const result = await tradesApi.create('user-123', newTrade);

      expect(mockChain.insert).toHaveBeenCalledWith({ ...newTrade, user_id: 'user-123' });
      expect(result).toEqual(createdTrade);
    });
  });

});

describe('chatApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('addMessage', () => {
    it('validates that message content is not empty', async () => {
      await expect(chatApi.addMessage('user-123', 'chat-123', 'user', '')).rejects.toThrow(
        'Message content cannot be empty'
      );
    });

    it('validates message length limit', async () => {
      const longMessage = 'a'.repeat(10001); // Exceeds MAX_MESSAGE_LENGTH (10000)
      
      await expect(chatApi.addMessage('user-123', 'chat-123', 'user', longMessage)).rejects.toThrow(
        /Message too long/
      );
    });

    it('creates a new message with valid content', async () => {
      const mockMessage = {
        id: 'msg-123',
        user_id: 'user-123',
        chat_id: 'chat-123',
        role: 'user',
        content: 'Hello, world!',
        created_at: '2024-01-15T00:00:00Z',
      };

      mockChain = createChainableMock({ data: mockMessage, error: null });

      const result = await chatApi.addMessage('user-123', 'chat-123', 'user', 'Hello, world!');

      expect(mockChain.insert).toHaveBeenCalledWith({
        user_id: 'user-123',
        chat_id: 'chat-123',
        role: 'user',
        content: 'Hello, world!',
      });
      expect(result).toEqual(mockMessage);
    });
  });

  describe('getMessages', () => {
    it('returns messages without deleting stale trailing user messages', async () => {
      const staleUserMessage = {
        id: 'msg-stale',
        user_id: 'user-123',
        chat_id: 'chat-123',
        role: 'user',
        content: 'Still waiting for a reply',
        created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      };

      mockSchemaChainsBySchemaAndTable['ai.chat_messages'] = createChainableMock({
        data: [staleUserMessage],
        error: null,
      });

      const result = await chatApi.getMessages('chat-123');

      expect(result).toEqual([staleUserMessage]);
      expect(mockSchemaChainsBySchemaAndTable['ai.chat_messages'].delete).not.toHaveBeenCalled();
    });
  });

  describe('getMessagesPage', () => {
    const message = (i: number) => ({
      id: `msg-${i}`,
      user_id: 'user-123',
      chat_id: 'chat-123',
      role: 'user',
      content: `Message ${i}`,
      created_at: `2024-01-0${i}T00:00:00Z`,
    });

    it('bounds the query, returns ascending order, and emits an older-page cursor', async () => {
      // Backend returns newest-first; 3 rows for a limit of 2 signals more history.
      const chain = createChainableMock({
        data: [message(3), message(2), message(1)],
        error: null,
      });
      mockSchemaChainsBySchemaAndTable['ai.chat_messages'] = chain;

      const page = await chatApi.getMessagesPage('chat-123', { limit: 2 });

      expect(chain.limit).toHaveBeenCalledWith(3); // limit + 1 lookahead
      expect(page.messages.map((m) => m.id)).toEqual(['msg-2', 'msg-3']);
      expect(page.nextCursor).not.toBeNull();
    });

    it('applies the keyset cursor filter when paging older history', async () => {
      const chain = createChainableMock({ data: [message(3), message(2), message(1)], error: null });
      mockSchemaChainsBySchemaAndTable['ai.chat_messages'] = chain;
      const first = await chatApi.getMessagesPage('chat-123', { limit: 2 });

      await chatApi.getMessagesPage('chat-123', { limit: 2, cursor: first.nextCursor! });
      expect(chain.or).toHaveBeenCalledWith(
        'created_at.lt.2024-01-02T00:00:00Z,and(created_at.eq.2024-01-02T00:00:00Z,id.lt.msg-2)',
      );
    });

    it('returns no cursor on the final page', async () => {
      const chain = createChainableMock({ data: [message(2), message(1)], error: null });
      mockSchemaChainsBySchemaAndTable['ai.chat_messages'] = chain;

      const page = await chatApi.getMessagesPage('chat-123', { limit: 2 });
      expect(page.messages).toHaveLength(2);
      expect(page.nextCursor).toBeNull();
    });
  });
});

describe('chatTurnApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createProcessing', () => {
    it('creates a new turn when the idempotency key is unused', async () => {
      const turnRow = {
        id: 'turn-1',
        user_id: 'user-123',
        chat_id: 'chat-123',
        user_message_id: 'msg-1',
        correlation_id: 'corr-1',
        idempotency_key: 'idem-1',
        status: 'processing',
      };
      mockSchemaChainsBySchemaAndTable['ai.chat_turn_requests'] = createChainableMock({
        data: turnRow,
        error: null,
      });

      const result = await chatTurnApi.createProcessing('user-123', 'chat-123', 'msg-1', 'corr-1', 'idem-1');

      expect(result).toEqual({ turn: turnRow, created: true });
    });

    it('returns the existing turn instead of throwing on a duplicate submission', async () => {
      const existingTurn = {
        id: 'turn-1',
        chat_id: 'chat-123',
        idempotency_key: 'idem-1',
        status: 'completed',
      };
      const chain = createChainableMock({
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_chat_turn_requests_chat_idempotency"' },
      });
      chain.single = vi.fn()
        .mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_chat_turn_requests_chat_idempotency"' } })
        .mockResolvedValueOnce({ data: existingTurn, error: null });
      mockSchemaChainsBySchemaAndTable['ai.chat_turn_requests'] = chain;

      const result = await chatTurnApi.createProcessing('user-123', 'chat-123', 'msg-1', 'corr-1', 'idem-1');

      expect(result).toEqual({ turn: existingTurn, created: false });
    });

    it('throws ChatTurnActiveError when another turn is already in flight for the chat', async () => {
      mockSchemaChainsBySchemaAndTable['ai.chat_turn_requests'] = createChainableMock({
        data: null,
        error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_chat_turn_requests_one_active"' },
      });

      await expect(
        chatTurnApi.createProcessing('user-123', 'chat-123', 'msg-1', 'corr-1', 'idem-2'),
      ).rejects.toThrow(ChatTurnActiveError);
    });
  });

  describe('completeAtomic', () => {
    it('calls the complete_chat_turn RPC and returns the assistant message', async () => {
      const assistantMessage = { id: 'msg-2', chat_id: 'chat-123', role: 'assistant', content: 'Hello back' };
      mockRpc.mockResolvedValueOnce({ data: assistantMessage, error: null });

      const result = await chatTurnApi.completeAtomic('turn-1', 'Hello back');

      expect(mockRpc).toHaveBeenCalledWith('complete_chat_turn', { p_turn_id: 'turn-1', p_content: 'Hello back' });
      expect(result).toEqual(assistantMessage);
    });

    it('throws when the RPC returns an error', async () => {
      mockRpc.mockResolvedValueOnce({ data: null, error: new Error('turn not found') });

      await expect(chatTurnApi.completeAtomic('turn-missing', 'content')).rejects.toThrow('turn not found');
    });
  });
});

describe('chatsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('updateTitle', () => {
    it('validates that title is not empty', async () => {
      await expect(chatsApi.updateTitle('chat-123', '')).rejects.toThrow(
        'Title cannot be empty'
      );
    });

    it('validates title length limit', async () => {
      const longTitle = 'a'.repeat(201); // Exceeds MAX_TITLE_LENGTH (200)
      
      await expect(chatsApi.updateTitle('chat-123', longTitle)).rejects.toThrow(
        /Title too long/
      );
    });

    it('updates chat title with valid input', async () => {
      const mockChat = {
        id: 'chat-123',
        user_id: 'user-123',
        title: 'New Title',
        updated_at: '2024-01-15T00:00:00Z',
      };

      mockChain = createChainableMock({ data: mockChat, error: null });

      const result = await chatsApi.updateTitle('chat-123', 'New Title');

      expect(mockChain.update).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'New Title' })
      );
      expect(result).toEqual(mockChat);
    });
  });

  describe('create', () => {
    it('rejects empty titles after trimming', async () => {
      await expect(chatsApi.create('user-123', '   ')).rejects.toThrow(
        'Title cannot be empty'
      );
    });

    it('rejects titles that exceed the max length', async () => {
      await expect(chatsApi.create('user-123', 'a'.repeat(201))).rejects.toThrow(
        /Title too long/
      );
    });

    it('creates a new chat with default title', async () => {
      const mockChat = {
        id: 'chat-123',
        user_id: 'user-123',
        title: 'New Chat',
        created_at: '2024-01-15T00:00:00Z',
        updated_at: '2024-01-15T00:00:00Z',
      };

      mockChain = createChainableMock({ data: mockChat, error: null });

      const result = await chatsApi.create('user-123');

      expect(mockChain.insert).toHaveBeenCalledWith({
        user_id: 'user-123',
        title: 'New Chat',
      });
      expect(result).toEqual(mockChat);
    });

    it('creates a new chat with custom title', async () => {
      const mockChat = {
        id: 'chat-123',
        user_id: 'user-123',
        title: 'Custom Title',
        created_at: '2024-01-15T00:00:00Z',
        updated_at: '2024-01-15T00:00:00Z',
      };

      mockChain = createChainableMock({ data: mockChat, error: null });

      const result = await chatsApi.create('user-123', '  Custom Title  ');

      expect(mockChain.insert).toHaveBeenCalledWith({
        user_id: 'user-123',
        title: 'Custom Title',
      });
      expect(result).toEqual(mockChat);
    });
  });

  describe('ai schema access', () => {
    const chatPageRow = (overrides: Record<string, unknown> = {}) => ({
      id: 'chat-ai',
      user_id: 'user-123',
      title: 'AI Chat',
      created_at: '2024-01-16T00:00:00Z',
      updated_at: '2024-01-17T00:00:00Z',
      message_count: 3,
      last_message_id: 'msg-ai',
      last_message_role: 'assistant',
      last_message_content: 'AI message',
      last_message_created_at: '2024-01-17T00:00:00Z',
      ...overrides,
    });

    it('loads the chat list page via ai.get_chat_page with exact counts', async () => {
      mockRpc = vi.fn().mockResolvedValue({ data: [chatPageRow()], error: null });

      const page = await chatsApi.getPage('user-123');

      expect(mockRpc).toHaveBeenCalledWith('get_chat_page', {
        p_limit: 31,
        p_cursor_updated_at: null,
        p_cursor_id: null,
      });
      expect(page.chats).toHaveLength(1);
      expect(page.chats[0].id).toBe('chat-ai');
      expect(page.chats[0].messageCount).toBe(3);
      expect(page.chats[0].lastMessage?.id).toBe('msg-ai');
      expect(page.nextCursor).toBeNull();
      expect(mockSchemaChainsBySchemaAndTable['public.chats']).toBeUndefined();
    });

    it('returns a next cursor when more chats exist and honors it on the next call', async () => {
      const rows = Array.from({ length: 3 }, (_, i) =>
        chatPageRow({ id: `chat-${i}`, updated_at: `2024-01-1${7 - i}T00:00:00Z` }),
      );
      mockRpc = vi.fn().mockResolvedValue({ data: rows, error: null });

      const page = await chatsApi.getPage('user-123', { limit: 2 });
      expect(page.chats).toHaveLength(2);
      expect(page.nextCursor).not.toBeNull();

      await chatsApi.getPage('user-123', { limit: 2, cursor: page.nextCursor! });
      expect(mockRpc).toHaveBeenLastCalledWith('get_chat_page', {
        p_limit: 3,
        p_cursor_updated_at: '2024-01-16T00:00:00Z',
        p_cursor_id: 'chat-1',
      });
    });

    it('surfaces an error when the RPC is missing so the UI can show its unavailable state', async () => {
      const rpcError = { code: '42883', message: 'function ai.get_chat_page does not exist' };
      mockRpc = vi.fn().mockResolvedValue({ data: null, error: rpcError });

      await expect(chatsApi.getPage('user-123')).rejects.toEqual(rpcError);
    });

    it('returns null when a chat does not exist', async () => {
      const missingChat = createChainableMock({ data: null, error: null });
      missingChat.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });

      mockSchemaChainsBySchemaAndTable['ai.chats'] = missingChat;

      const result = await chatsApi.getWithMessages('missing-chat');

      expect(missingChat.eq).toHaveBeenCalledWith('id', 'missing-chat');
      expect(result).toBeNull();
    });

    it('returns all user messages from ai.chat_messages in ascending order', async () => {
      const aiMessages = createChainableMock({
        data: [
          {
            id: 'msg-100',
            user_id: 'user-123',
            chat_id: 'chat-ai',
            role: 'user',
            content: 'First',
            created_at: '2024-01-15T00:00:00Z',
          },
          {
            id: 'msg-200',
            user_id: 'user-123',
            chat_id: 'chat-ai',
            role: 'assistant',
            content: 'Second',
            created_at: '2024-01-16T00:00:00Z',
          },
        ],
        error: null,
      });

      mockSchemaChainsBySchemaAndTable['ai.chat_messages'] = aiMessages;

      const result = await chatApi.getAllUserMessages('user-123');

      expect(aiMessages.eq).toHaveBeenCalledWith('user_id', 'user-123');
      expect(result.map((message) => message.id)).toEqual(['msg-100', 'msg-200']);
      expect(mockSchemaChainsBySchemaAndTable['public.chat_messages']).toBeUndefined();
    });
  });
});

describe('portfolioApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getHistory', () => {
    it('fetches portfolio history for a user', async () => {
      const mockHistory = [
        { id: '1', user_id: 'user-123', date: '2024-01-01', value: 10000 },
        { id: '2', user_id: 'user-123', date: '2024-01-02', value: 10500 },
      ];

      mockChain = createChainableMock({ data: mockHistory, error: null });

      const result = await portfolioApi.getHistory('user-123');

      expect(mockChain.select).toHaveBeenCalledWith('*');
      expect(mockChain.eq).toHaveBeenCalledWith('user_id', 'user-123');
      expect(mockChain.order).toHaveBeenCalledWith('date', { ascending: true });
      expect(result).toEqual(mockHistory);
    });
  });

  describe('addHistoryEntry', () => {
    it('adds a new portfolio history entry', async () => {
      const mockEntry = {
        id: 'history-123',
        user_id: 'user-123',
        date: '2024-01-15',
        value: 12000,
      };

      mockChain = createChainableMock({ data: mockEntry, error: null });

      const result = await portfolioApi.addHistoryEntry('user-123', '2024-01-15', 12000);

      expect(mockChain.insert).toHaveBeenCalledWith({
        user_id: 'user-123',
        date: '2024-01-15',
        value: 12000,
      });
      expect(result).toEqual(mockEntry);
    });
  });
});


describe('learningApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('updateProgress', () => {
    it('preserves existing best quiz score when manual progress changes', async () => {
      const lessonChain = createChainableMock({
        data: {
          id: 'lesson-1',
          tier_id: 'tier-1',
          title: 'Topic 1',
          created_at: '2026-03-01T00:00:00.000Z',
          updated_at: '2026-03-02T00:00:00.000Z',
        },
        error: null,
      });
      const progressChain = createChainableMock({
        data: {
          id: 'progress-1',
          best_quiz_score: 85,
          completed_at: '2026-03-03T00:00:00.000Z',
        },
        error: null,
      });
      progressChain.maybeSingle = vi.fn().mockResolvedValue({
        data: {
          id: 'progress-1',
          best_quiz_score: 85,
          completed_at: '2026-03-03T00:00:00.000Z',
        },
        error: null,
      });
      progressChain.upsert = vi.fn().mockReturnThis();

      mockSchemaChainsBySchemaAndTable = {
        'academy.lessons': lessonChain,
        'academy.user_lesson_progress': progressChain,
      };

      await learningApi.updateProgress('user-123', 'Topic 1', 100, true);

      expect(progressChain.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user-123',
          lesson_id: 'lesson-1',
          status: 'completed',
          best_quiz_score: 85,
          completed_at: '2026-03-03T00:00:00.000Z',
        }),
        { onConflict: 'user_id,lesson_id' },
      );
    });
  });
});

describe('newsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getLatest', () => {
    it('fetches latest news from canonical news table', async () => {
      const canonicalRows = [
        {
          id: 'news-1',
          title: 'Fed keeps rates unchanged',
          summary: 'Policy update summary',
          link: 'https://example.com/fed',
          provider: 'Reuters',
          published_at: '2026-03-01T10:00:00.000Z',
          created_at: '2026-03-01T10:00:00.000Z',
          updated_at: '2026-03-01T10:00:00.000Z',
        },
      ];

      const canonicalChain = createChainableMock({ data: canonicalRows, error: null });
      mockChainsByTable = { news: canonicalChain };

      const result = await newsApi.getLatest(5);

      expect(canonicalChain.select).toHaveBeenCalledWith('*');
      expect(canonicalChain.order).toHaveBeenCalledWith('published_at', { ascending: false });
      expect(canonicalChain.limit).toHaveBeenCalledWith(5);
      expect(result).toEqual(canonicalRows);
    });

    it('throws when the canonical news table is missing', async () => {
      const missingTableError = {
        code: '42P01',
        message: 'relation "market.news" does not exist',
      };

      const canonicalChain = createChainableMock({ data: null, error: missingTableError });
      mockChainsByTable = { news: canonicalChain };

      await expect(newsApi.getLatest(3)).rejects.toMatchObject(missingTableError);
      expect(canonicalChain.limit).toHaveBeenCalledWith(3);
    });
  });
});
