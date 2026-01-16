import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './use-auth';
import {
  portfolioApi,
  positionsApi,
  tradesApi,
  journalApi,
  chatsApi,
  chatApi,
  learningApi,
  achievementsApi,
  marketApi,
  pythonApi,
} from '@/services/api';
import type {
  OpenPosition,
  Trade,
  TradeJournalEntry,
  LearningTopic,
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
    },
  });
}

export function useDeletePosition() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: string) => positionsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['open-positions', userId] });
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
    mutationFn: (entry: Omit<TradeJournalEntry, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'trade_id'>) =>
      journalApi.create(userId!, entry),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-journal', userId] });
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
      
      // Get AI response with user's experience level
      const experienceLevel = userProfile?.experience_level ?? null;
      const aiResponse = await pythonApi.getChatResponse(message, userId, experienceLevel);
      
      // Save AI response
      await chatApi.addMessage(userId, chatId, 'assistant', aiResponse);
      
      // Auto-generate title on first message
      if (isFirstMessage) {
        const title = await pythonApi.generateChatTitle(message);
        await chatsApi.updateTitle(chatId, title);
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

// Export pythonApi for use in components
export { pythonApi };
