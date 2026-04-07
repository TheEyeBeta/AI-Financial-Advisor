import { aiDb, meridianDb, supabase } from '@/lib/supabase';
import type { Chat, ChatMessage, ChatWithMessages } from '@/types/database';

const MAX_MESSAGE_LENGTH = 10000;
const MAX_TITLE_LENGTH = 200;

function normalizeChatTitle(title?: string): string {
  const trimmedTitle = title?.trim();

  if (trimmedTitle == null) {
    return 'New Chat';
  }

  if (trimmedTitle.length === 0) {
    throw new Error('Title cannot be empty');
  }

  if (trimmedTitle.length > MAX_TITLE_LENGTH) {
    throw new Error(`Title too long. Maximum length is ${MAX_TITLE_LENGTH} characters.`);
  }

  return trimmedTitle;
}

function fromAiChats() {
  return aiDb.from('chats');
}

function fromAiChatMessages() {
  return aiDb.from('chat_messages');
}

function isSchemaOrTableNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { status?: number; code?: string; message?: string };
  if (e.status === 404) return true;
  if (e.status === 400 && e.message?.includes('schema')) return true;
  if (e.code === '42P01') return true;
  if (e.code === '42501') return true;
  return false;
}

const CHAT_SETUP_ERROR =
  'Chat is unavailable: the ai schema is missing required GRANT permissions. ' +
  'Run sql/fix_ai_chat_grants.sql in the Supabase SQL Editor to fix this.';

async function fetchChatsForUser(userId: string): Promise<ChatWithMessages[]> {
  const { data: chats, error: chatsError } = await fromAiChats()
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (chatsError) {
    if (isSchemaOrTableNotFound(chatsError)) {
      console.warn(
        'ai.chats returned 404. The table exists and the schema is exposed, so the likely cause is missing GRANT permissions. Run sql/fix_ai_chat_grants.sql in the Supabase SQL Editor. Returning empty chat list.',
      );
      return [];
    }
    throw chatsError;
  }
  if (!Array.isArray(chats) || chats.length === 0) return [];

  const chatIds = chats.map((chat) => chat.id);
  const { data: messages, error: messagesError } = await fromAiChatMessages()
    .select('*')
    .in('chat_id', chatIds)
    .order('created_at', { ascending: false });

  if (messagesError) {
    if (isSchemaOrTableNotFound(messagesError)) {
      console.warn(
        'ai.chat_messages returned 404. Missing GRANT permissions. Run sql/fix_ai_chat_grants.sql in the Supabase SQL Editor. Returning chats without messages.',
      );
      return chats.map((chat) => ({ ...chat, messages: [], messageCount: 0, lastMessage: undefined }));
    }
    throw messagesError;
  }

  const messagesByChat = (messages || []).reduce(
    (accumulator, message) => {
      if (!accumulator[message.chat_id!]) {
        accumulator[message.chat_id!] = [];
      }
      accumulator[message.chat_id!].push(message);
      return accumulator;
    },
    {} as Record<string, ChatMessage[]>,
  );

  return chats.map((chat) => ({
    ...chat,
    messages: [...(messagesByChat[chat.id] || [])].reverse(),
    messageCount: (messagesByChat[chat.id] || []).length,
    lastMessage: (messagesByChat[chat.id] || [])[0],
  }));
}

async function fetchMessagesForUser(userId: string): Promise<ChatMessage[]> {
  const { data, error } = await fromAiChatMessages()
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) {
    if (isSchemaOrTableNotFound(error)) {
      console.warn(
        'ai.chat_messages returned 404. Missing GRANT permissions. Run sql/fix_ai_chat_grants.sql in the Supabase SQL Editor. Returning empty message list.',
      );
      return [];
    }
    throw error;
  }
  return data || [];
}

export const chatsApi = {
  async getAll(userId: string): Promise<ChatWithMessages[]> {
    return fetchChatsForUser(userId);
  },

  async create(userId: string, title?: string): Promise<Chat> {
    const normalizedTitle = normalizeChatTitle(title);

    const { data, error } = await fromAiChats()
      .insert({ user_id: userId, title: normalizedTitle })
      .select()
      .single();

    if (error) {
      if (isSchemaOrTableNotFound(error)) throw new Error(CHAT_SETUP_ERROR);
      throw error;
    }
    return data;
  },

  async updateTitle(chatId: string, title: string): Promise<Chat> {
    const normalizedTitle = normalizeChatTitle(title);

    const { data, error } = await fromAiChats()
      .update({ title: normalizedTitle, updated_at: new Date().toISOString() })
      .eq('id', chatId)
      .select()
      .single();

    if (error) {
      if (isSchemaOrTableNotFound(error)) throw new Error(CHAT_SETUP_ERROR);
      throw error;
    }
    return data;
  },

  async delete(chatId: string): Promise<void> {
    const { error } = await fromAiChats()
      .delete()
      .eq('id', chatId);

    if (error) throw error;
  },

  async getWithMessages(chatId: string): Promise<ChatWithMessages | null> {
    const { data: chat, error: chatError } = await fromAiChats()
      .select('*')
      .eq('id', chatId)
      .maybeSingle();

    if (chatError) {
      if (isSchemaOrTableNotFound(chatError)) return null;
      throw chatError;
    }
    if (!chat) return null;

    const { data: messages, error: messagesError } = await fromAiChatMessages()
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });

    if (messagesError) {
      if (isSchemaOrTableNotFound(messagesError)) {
        return { ...chat, messages: [], messageCount: 0, lastMessage: undefined };
      }
      throw messagesError;
    }

    return {
      ...chat,
      messages: messages || [],
      messageCount: (messages || []).length,
      lastMessage: messages?.[messages.length - 1],
    };
  },
};

export const chatApi = {
  async getMessages(chatId: string): Promise<ChatMessage[]> {
    const { data, error } = await fromAiChatMessages()
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true });

    if (error) {
      if (isSchemaOrTableNotFound(error)) return [];
      throw error;
    }
    return data || [];
  },

  async getAllUserMessages(userId: string): Promise<ChatMessage[]> {
    return fetchMessagesForUser(userId);
  },

  async addMessage(
    userId: string,
    chatId: string,
    role: 'user' | 'assistant',
    content: string,
  ): Promise<ChatMessage> {
    if (!content || content.trim().length === 0) {
      throw new Error('Message content cannot be empty');
    }
    if (content.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Message too long. Maximum length is ${MAX_MESSAGE_LENGTH} characters.`);
    }

    const { data, error } = await fromAiChatMessages()
      .insert({ user_id: userId, chat_id: chatId, role, content })
      .select()
      .single();

    if (error) {
      if (isSchemaOrTableNotFound(error)) throw new Error(CHAT_SETUP_ERROR);
      throw error;
    }

    const { error: updateChatError } = await fromAiChats()
      .update({ updated_at: new Date().toISOString() })
      .eq('id', chatId);

    if (updateChatError) {
      console.error('Failed to update chat timestamp', { chatId, error: updateChatError });
    }

    return data;
  },

  async clearMessages(chatId: string): Promise<void> {
    const { error } = await fromAiChatMessages()
      .delete()
      .eq('chat_id', chatId);

    if (error) throw error;
  },
};

// ── Intelligence Digests ──────────────────────────────────────────────────────

/**
 * Mark a single intelligence digest as read.
 *
 * Scopes the update to both the digest ID and the current authenticated user's
 * ID so a user can never mark another user's digest as read — even if RLS is
 * misconfigured.  Throws on any error; callers are responsible for handling.
 */
export async function markDigestRead(digestId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await meridianDb
    .from('intelligence_digests')
    .update({ delivered: true })
    .eq('id', digestId)
    .eq('user_id', user.id);

  if (error) throw error;
}
