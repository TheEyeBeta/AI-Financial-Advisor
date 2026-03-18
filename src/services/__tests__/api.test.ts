import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  tradesApi,
  chatsApi,
  chatApi,
  portfolioApi,
  newsApi,
} from '../api';

// Mock supabase with a more robust mock
const createChainableMock = (finalResult: { data: unknown; error: unknown }) => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(finalResult),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(finalResult),
    then: (resolve: (val: typeof finalResult) => void) => Promise.resolve(resolve(finalResult)),
  };
  return chain;
};

let mockChain = createChainableMock({ data: [], error: null });
let mockChainsByTable: Record<string, ReturnType<typeof createChainableMock>> = {};
let mockSchemaChainsBySchemaAndTable: Record<string, ReturnType<typeof createChainableMock>> = {};

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
    },
    getCurrentUserId: vi.fn().mockResolvedValue('user-123'),
  };
});

beforeEach(() => {
  mockChain = createChainableMock({ data: [], error: null });
  mockChainsByTable = {};
  mockSchemaChainsBySchemaAndTable = {};
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
    it('loads chats and messages from ai.chats and ai.chat_messages only', async () => {
      const aiChats = createChainableMock({
        data: [
          {
            id: 'chat-ai',
            user_id: 'user-123',
            title: 'AI Chat',
            created_at: '2024-01-16T00:00:00Z',
            updated_at: '2024-01-17T00:00:00Z',
          },
        ],
        error: null,
      });
      const aiMessages = createChainableMock({
        data: [
          {
            id: 'msg-ai',
            user_id: 'user-123',
            chat_id: 'chat-ai',
            role: 'assistant',
            content: 'AI message',
            created_at: '2024-01-17T00:00:00Z',
          },
        ],
        error: null,
      });

      mockSchemaChainsBySchemaAndTable['ai.chats'] = aiChats;
      mockSchemaChainsBySchemaAndTable['ai.chat_messages'] = aiMessages;

      const result = await chatsApi.getAll('user-123');

      expect(aiChats.eq).toHaveBeenCalledWith('user_id', 'user-123');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('chat-ai');
      expect(result[0].lastMessage?.id).toBe('msg-ai');
      expect(mockSchemaChainsBySchemaAndTable['public.chats']).toBeUndefined();
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

    it('falls back to legacy news_articles when canonical table is missing', async () => {
      const missingTableError = {
        code: '42P01',
        message: 'relation "public.news" does not exist',
      };

      const canonicalChain = createChainableMock({ data: null, error: missingTableError });
      const legacyRows = [
        {
          id: 'legacy-1',
          title: 'Earnings beat expectations',
          summary: 'Quarterly earnings summary',
          link: 'https://example.com/earnings',
          source: 'Bloomberg',
          published_at: '2026-02-28T09:00:00.000Z',
          created_at: '2026-02-28T09:00:00.000Z',
          updated_at: '2026-02-28T09:00:00.000Z',
        },
      ];
      const legacyChain = createChainableMock({ data: legacyRows, error: null });

      mockChainsByTable = {
        news: canonicalChain,
        news_articles: legacyChain,
      };

      const result = await newsApi.getLatest(3);

      expect(canonicalChain.limit).toHaveBeenCalledWith(3);
      expect(legacyChain.limit).toHaveBeenCalledWith(3);
      expect(result).toEqual([
        {
          id: 'legacy-1',
          title: 'Earnings beat expectations',
          summary: 'Quarterly earnings summary',
          link: 'https://example.com/earnings',
          provider: 'Bloomberg',
          published_at: '2026-02-28T09:00:00.000Z',
          created_at: '2026-02-28T09:00:00.000Z',
          updated_at: '2026-02-28T09:00:00.000Z',
        },
      ]);
    });
  });
});
