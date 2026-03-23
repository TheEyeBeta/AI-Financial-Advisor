import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { chatApi, chatsApi } from '@/services/chat-api';
import { newsApi } from '@/services/news-api';
import { stockRankingApi } from '@/services/stock-ranking-api';
import { tradeEngineApi } from '@/services/trade-engine-api';
import { portfolioApi, positionsApi, tradesApi, journalApi } from '@/services/trading-api';
import { achievementsApi, learningApi, marketApi } from '@/services/user-data-api';
import { pythonApi } from '@/services/python-api';
import { useAuth } from './use-auth';
import { useDataSource, sourceParam } from './use-data-source';
import type {
  OpenPosition,
  TradeJournalEntry,
} from '@/types/database';

// Portfolio hooks
export function usePortfolioHistory() {
  const { userId } = useAuth();
  
  return useQuery({
    queryKey: ['portfolio-history', userId],
    queryFn: () => portfolioApi.getHistory(userId!),
    enabled: !!userId,
  });
}

// Positions hooks
export function useOpenPositions() {
  const { userId } = useAuth();
  
  return useQuery({
    queryKey: ['open-positions', userId],
    queryFn: () => positionsApi.getAll(userId!),
    enabled: !!userId,
  });
}

export function useCreatePosition() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (position: Omit<OpenPosition, 'id' | 'user_id' | 'created_at' | 'updated_at'>) =>
      positionsApi.create(userId!, position),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['open-positions', userId] });
      // Sync Dashboard: a new position changes portfolio value and statistics counts
      queryClient.invalidateQueries({ queryKey: ['portfolio-history', userId] });
      queryClient.invalidateQueries({ queryKey: ['trade-statistics', userId] });
    },
  });
}

export function useDeletePosition() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: string) => {
      if (!userId) throw new Error('Not authenticated');
      return positionsApi.delete(id, userId);
    },
    onSuccess: () => {
      // Invalidate all related queries so all components refresh
      queryClient.invalidateQueries({ queryKey: ['open-positions', userId] });
      queryClient.invalidateQueries({ queryKey: ['trades', userId] });
      queryClient.invalidateQueries({ queryKey: ['closed-trades', userId] });
      queryClient.invalidateQueries({ queryKey: ['portfolio-history', userId] });
      // Sync Dashboard: closing a position alters win-rate/profit-factor shown in TradeStatistics
      queryClient.invalidateQueries({ queryKey: ['trade-statistics', userId] });
    },
  });
}

// Trades hooks
export function useTrades() {
  const { userId } = useAuth();
  
  return useQuery({
    queryKey: ['trades', userId],
    queryFn: () => tradesApi.getAll(userId!),
    enabled: !!userId,
  });
}

export function useClosedTrades() {
  const { userId } = useAuth();
  
  return useQuery({
    queryKey: ['closed-trades', userId],
    queryFn: () => tradesApi.getClosed(userId!),
    enabled: !!userId,
  });
}

export function useTradeStatistics() {
  const { userId } = useAuth();
  
  return useQuery({
    queryKey: ['trade-statistics', userId],
    queryFn: () => tradesApi.getStatistics(userId!),
    enabled: !!userId,
  });
}

// Journal hooks
export function useTradeJournal() {
  const { userId } = useAuth();
  
  return useQuery({
    queryKey: ['trade-journal', userId],
    queryFn: () => journalApi.getAll(userId!),
    enabled: !!userId,
  });
}

export function useCreateJournalEntry() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (entry: Omit<TradeJournalEntry, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'trade_id'> & { trade_id?: string | null }) =>
      journalApi.create(userId!, entry),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['trade-journal', userId] }),
        // Invalidate related queries so all components refresh
        queryClient.invalidateQueries({ queryKey: ['open-positions', userId] }),
        queryClient.invalidateQueries({ queryKey: ['trades', userId] }),
        queryClient.invalidateQueries({ queryKey: ['closed-trades', userId] }),
        queryClient.invalidateQueries({ queryKey: ['portfolio-history', userId] }),
        // Sync Dashboard: every BUY/SELL logged via TradeJournal changes win-rate and profit-factor
        queryClient.invalidateQueries({ queryKey: ['trade-statistics', userId] }),
      ]);
    },
  });
}

// Chat hooks

// Get all chats for the current user
export function useChats() {
  const { userId } = useAuth();
  
  return useQuery({
    queryKey: ['chats', userId],
    queryFn: () => chatsApi.getAll(userId!),
    enabled: !!userId,
  });
}

// Get a specific chat with its messages
export function useChat(chatId: string | null) {
  return useQuery({
    queryKey: ['chat', chatId],
    queryFn: () => chatsApi.getWithMessages(chatId!),
    enabled: !!chatId,
  });
}

// Get messages for the current chat
export function useChatMessages(chatId: string | null) {
  return useQuery({
    queryKey: ['chat-messages', chatId],
    queryFn: () => chatApi.getMessages(chatId!),
    enabled: !!chatId,
  });
}

// Create a new chat
export function useCreateChat() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (title?: string) => {
      if (!userId) throw new Error('Not authenticated');
      return chatsApi.create(userId, title);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats', userId] });
    },
  });
}

// Send a message in a chat
export function useSendChatMessage() {
  const { userId, userProfile } = useAuth();
  const { dataSource } = useDataSource();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ chatId, message, isFirstMessage }: {
      chatId: string;
      message: string;
      isFirstMessage?: boolean;
    }) => {
      if (!userId) throw new Error('Not authenticated');

      // Save user message
      await chatApi.addMessage(userId, chatId, 'user', message);

      // Fetch conversation history for context
      const history = await chatApi.getMessages(chatId);
      const chatHistory = history.map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content
      }));

      // Fetch market data context using the user's preferred data source
      const src = sourceParam(dataSource);
      const tradeEngineContext = await tradeEngineApi.getAIContext(true, 15, 48, src);
      
      if (tradeEngineContext) {
        console.log('[AI] Fetched live Trade Engine context:', {
          tickers: tradeEngineContext.tracked_tickers.length,
          signals: tradeEngineContext.recent_signals.length,
          news: tradeEngineContext.recent_news.length,
        });
      } else {
        console.log('[AI] Trade Engine not available, will use Supabase data fallback');
      }
      
      // Get AI response with user's experience level, conversation history, and live Eye data
      const experienceLevel = userProfile?.experience_level ?? null;
      const aiResponse = await pythonApi.getChatResponse(
        message, 
        userId, 
        experienceLevel, 
        chatHistory, 
        null,  // No snapshots - using live data only
        tradeEngineContext  // Live Trade Engine data
      );
      
      // Save AI response
      await chatApi.addMessage(userId, chatId, 'assistant', aiResponse);
      
      // Auto-generate title on first message
      if (isFirstMessage) {
        try {
          const title = await pythonApi.generateChatTitle(message);
          await chatsApi.updateTitle(chatId, title);
        } catch (error) {
          // Log error but don't fail the message creation if title generation fails
          console.error('Failed to generate chat title:', error);
          // Continue without updating title - chat will use default title
        }
      }
      
      return { message, response: aiResponse };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['chat-messages', variables.chatId] });
      queryClient.invalidateQueries({ queryKey: ['chat', variables.chatId] });
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
  });
}

// Update chat title
export function useUpdateChatTitle() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ chatId, title }: { chatId: string; title: string }) => {
      return chatsApi.updateTitle(chatId, title);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['chat', variables.chatId] });
      queryClient.invalidateQueries({ queryKey: ['chats', userId] });
    },
  });
}

// Delete a chat
export function useDeleteChat() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (chatId: string) => {
      return chatsApi.delete(chatId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats', userId] });
    },
  });
}

// Learning hooks
export function useLearningTopics() {
  const { userId } = useAuth();
  
  return useQuery({
    queryKey: ['learning-topics', userId],
    queryFn: () => learningApi.getTopics(userId!),
    enabled: !!userId,
  });
}

export function useInitializeLearningTopics() {
  const { userId, userProfile } = useAuth();
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (experienceLevel?: 'beginner' | 'intermediate' | 'advanced') =>
      learningApi.initializeTopics(
        userId!,
        experienceLevel || (userProfile?.experience_level as 'beginner' | 'intermediate' | 'advanced') || 'beginner'
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['learning-topics', userId] });
    },
  });
}

export function useUpdateLearningProgress() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ topicName, progress, completed }: { topicName: string; progress: number; completed?: boolean }) =>
      learningApi.updateProgress(userId!, topicName, progress, completed),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['learning-topics', userId] });
    },
  });
}

// Achievements hooks
export function useAchievements() {
  const { userId } = useAuth();
  
  return useQuery({
    queryKey: ['achievements', userId],
    queryFn: () => achievementsApi.getAll(userId!),
    enabled: !!userId,
  });
}

// Market data hooks (public, doesn't require user)
export function useMarketIndices() {
  return useQuery({
    queryKey: ['market-indices'],
    queryFn: () => marketApi.getIndices(),
    refetchInterval: 60000, // Refetch every minute
    staleTime: 30000, // Consider data fresh for 30 seconds
  });
}

export function useTrendingStocks() {
  return useQuery({
    queryKey: ['trending-stocks'],
    queryFn: () => marketApi.getTrendingStocks(),
    refetchInterval: 60000, // Refetch every minute
    staleTime: 30000, // Consider data fresh for 30 seconds
  });
}

// News hooks
export function useLatestNews(limit: number = 5) {
  return useQuery({
    queryKey: ['news-articles', limit],
    queryFn: () => newsApi.getLatest(limit),
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
    staleTime: 2 * 60 * 1000, // Consider data fresh for 2 minutes
  });
}

export function useAllNews() {
  return useQuery({
    queryKey: ['news-articles', 'all'],
    queryFn: () => newsApi.getAll(),
    refetchInterval: 5 * 60 * 1000,
    staleTime: 2 * 60 * 1000,
  });
}

export function useRecentNews(hours: number = 12, limit: number = 150) {
  return useQuery({
    queryKey: ['news-articles', 'recent', hours, limit],
    queryFn: () => newsApi.getRecent(hours, limit),
    refetchInterval: 5 * 60 * 1000,
    staleTime: 2 * 60 * 1000,
  });
}


// ============================================================
// Trade Engine API Hooks - Direct connection to TheEyeBetaLocal
// ============================================================

// Fetch news from Trade Engine (live from backend, not Supabase)
export function useTradeEngineNews(limit: number = 15) {
  return useQuery({
    queryKey: ['trade-engine-news', limit],
    queryFn: () => tradeEngineApi.getNews(limit),
    refetchInterval: 60 * 1000, // Refetch every minute
    staleTime: 30 * 1000, // Consider data fresh for 30 seconds
    retry: 2,
  });
}

// Fetch technical indicators from Trade Engine
export function useTradeEngineIndicators(ticker: string, date?: string) {
  return useQuery({
    queryKey: ['trade-engine-indicators', ticker, date],
    queryFn: () => tradeEngineApi.getTechnicalIndicators(ticker, date),
    enabled: !!ticker,
    staleTime: 60 * 1000,
    retry: 2,
  });
}

// Fetch price data from Trade Engine for charting
export function useTradeEnginePriceData(ticker: string, startDate?: string, endDate?: string, limit: number = 100) {
  return useQuery({
    queryKey: ['trade-engine-prices', ticker, startDate, endDate, limit],
    queryFn: () => tradeEngineApi.getPriceData(ticker, startDate, endDate, limit),
    enabled: !!ticker,
    staleTime: 60 * 1000,
    retry: 2,
  });
}

// Fetch available tickers from Trade Engine
export function useTradeEngineTickers(activeOnly: boolean = true) {
  return useQuery({
    queryKey: ['trade-engine-tickers', activeOnly],
    queryFn: () => tradeEngineApi.getTickers(activeOnly),
    staleTime: 5 * 60 * 1000, // Tickers change rarely
    retry: 2,
  });
}

// Health check for Trade Engine connection
export function useTradeEngineHealth() {
  return useQuery({
    queryKey: ['trade-engine-health'],
    queryFn: () => tradeEngineApi.healthCheck(),
    refetchInterval: 30 * 1000, // Check every 30 seconds
    staleTime: 10 * 1000,
    retry: 1,
  });
}

// Top stocks ranking hook — supports investment horizon and data source toggle
export function useTopStocks(limit = 20, minScore = 0, horizon: 'short' | 'long' | 'balanced' = 'balanced') {
  const { dataSource } = useDataSource();
  const src = sourceParam(dataSource);
  return useQuery({
    queryKey: ['top-stocks', limit, minScore, horizon, src],
    queryFn: () => stockRankingApi.getRanking({ limit, minScore, horizon }, src),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    retry: 2,
  });
}

// Export pythonApi and tradeEngineApi for use in components
export { pythonApi, tradeEngineApi };
