import { aiDb, meridianDb, supabase } from '@/lib/supabase';
import type { Chat, ChatMessage, ChatWithMessages } from '@/types/database';

const MAX_MESSAGE_LENGTH = 10000;
const MAX_TITLE_LENGTH = 200;

/** Idle timeout between stream chunks (ms). Resets on each `reader.read()` via `resetForChunk`. */
export const CHUNK_INTERVAL_TIMEOUT_MS = 30_000;

export function getTimeoutForMessage(message: string): number {
  const msg = message.toLowerCase().trim();
  const length = msg.length;

  // INSTANT tier - very short or trivial
  const trivial = [
    'hello',
    'hi',
    'hey',
    'thanks',
    'ok',
    'yes',
    'no',
    'bye',
    'cheers',
    'morning',
  ];
  if (trivial.some((t) => msg === t || msg.startsWith(t + ' ')) && length < 60) {
    return 15000; // 15 seconds — 3-4× headroom over expected ~2-4s INSTANT response
  }

  // Short analytical questions. Length alone can't predict backend latency:
  // a short message containing a ticker (e.g. "breakdown of NVDA") routes to
  // the backend's BALANCED tier and may run the full pipeline plus tool calls
  // before the first chunk arrives, so the time-to-first-byte budget needs to
  // cover that worst case. Subsequent chunks reset via CHUNK_INTERVAL_TIMEOUT_MS.
  if (length < 150) {
    return 60000; // 60 seconds
  }

  // Standard questions
  if (length < 400) {
    return 90000; // 90 seconds
  }

  // Long complex questions
  return 120000; // 120 seconds
}

export function createStreamTimeout(
  timeoutMs: number,
  message = '',
): { controller: AbortController; cancel: () => void; resetForChunk: () => void } {
  const controller = new AbortController();
  const label = message.slice(0, 40);

  if (import.meta.env.DEV) {
    console.log(`[TIMEOUT] message="${label}" timeout=${timeoutMs}ms ts=${Date.now()}`);
  }

  let timeoutId: ReturnType<typeof setTimeout> | null =
    timeoutMs > 0
      ? setTimeout(() => {
          if (import.meta.env.DEV) {
            console.log(`[TIMEOUT_FIRED] aborted after ${timeoutMs}ms message="${label}"`);
          }
          controller.abort();
        }, timeoutMs)
      : null;

  return {
    controller,
    cancel: () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    },
    resetForChunk: () => {
      if (timeoutId !== null) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => controller.abort(), CHUNK_INTERVAL_TIMEOUT_MS);
    },
  };
}

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

function fromAiChatTurnRequests() {
  return aiDb.from('chat_turn_requests');
}

export type ChatTurnStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface ChatTurnRequest {
  id: string;
  user_id: string;
  chat_id: string;
  user_message_id: string;
  assistant_message_id: string | null;
  correlation_id: string;
  retry_of_request_id: string | null;
  idempotency_key: string;
  status: ChatTurnStatus;
  failure_code: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

/** Thrown when a chat already has a turn in `pending`/`processing` state. */
export class ChatTurnActiveError extends Error {
  constructor(chatId: string) {
    super(`A response is already generating for chat ${chatId}.`);
    this.name = 'ChatTurnActiveError';
  }
}

function isUniqueViolation(error: unknown): error is { code: string; message: string } {
  return (
    !!error &&
    typeof error === 'object' &&
    (error as { code?: string }).code === '23505'
  );
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

// ── Bounded retrieval (#212) ─────────────────────────────────────────────────
// Conversation lists and message history are cursor-paginated on stable
// keyset orders — (updated_at, id) for chats, (created_at, id) for messages —
// so a large account never triggers unbounded queries or unbounded browser
// memory. Composite indexes live in Alembic revision 0033.

export const CHAT_LIST_PAGE_SIZE = 30;
export const MESSAGE_PAGE_SIZE = 50;
/** Newest messages sent to the model as conversation context. */
export const MESSAGE_CONTEXT_LIMIT = 50;

export interface ChatListPage {
  chats: ChatWithMessages[];
  nextCursor: string | null;
}

export interface ChatMessagesPage {
  /** Ascending (oldest → newest) within the page for direct rendering. */
  messages: ChatMessage[];
  /** Cursor for the next OLDER page; null when history is exhausted. */
  nextCursor: string | null;
}

interface PageOptions {
  cursor?: string | null;
  limit?: number;
  signal?: AbortSignal;
}

function encodeCursor(payload: Record<string, string>): string {
  return btoa(JSON.stringify(payload));
}

function decodeCursor(cursor: string): Record<string, string> {
  try {
    const parsed = JSON.parse(atob(cursor)) as Record<string, string>;
    if (!parsed || typeof parsed !== 'object') throw new Error('bad cursor');
    return parsed;
  } catch {
    throw new Error('Invalid pagination cursor');
  }
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

type ChatPageRow = {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message_id: string | null;
  last_message_role: string | null;
  last_message_content: string | null;
  last_message_created_at: string | null;
};

function chatPageRowToChat(row: ChatPageRow): ChatWithMessages {
  const lastMessage: ChatMessage | undefined = row.last_message_id
    ? {
        id: row.last_message_id,
        user_id: row.user_id,
        chat_id: row.id,
        role: row.last_message_role ?? 'assistant',
        content: row.last_message_content ?? '',
        created_at: row.last_message_created_at,
      }
    : undefined;

  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title,
    created_at: row.created_at,
    updated_at: row.updated_at,
    messages: lastMessage ? [lastMessage] : [],
    messageCount: Number(row.message_count ?? 0),
    lastMessage,
  };
}

export const chatsApi = {
  /**
   * One page of the user's conversations, newest-updated first, with exact
   * message counts and last-message previews via `ai.get_chat_page`
   * (SECURITY INVOKER — RLS scopes rows to the caller).
   */
  async getPage(_userId: string, options: PageOptions = {}): Promise<ChatListPage> {
    const limit = Math.min(Math.max(options.limit ?? CHAT_LIST_PAGE_SIZE, 1), 100);
    const cursor = options.cursor ? decodeCursor(options.cursor) : null;

    let query = aiDb.rpc('get_chat_page', {
      p_limit: limit + 1,
      p_cursor_updated_at: cursor?.u ?? null,
      p_cursor_id: cursor?.i ?? null,
    });
    if (options.signal) {
      query = query.abortSignal(options.signal);
    }
    const { data, error } = await query;

    if (error) {
      if (isSchemaOrTableNotFound(error) || (error as { code?: string }).code === '42883') {
        console.warn(
          'ai.get_chat_page unavailable (missing grants or Alembic revision 0033 not applied). Returning empty chat list.',
        );
        return { chats: [], nextCursor: null };
      }
      throw error;
    }

    const rows = (data ?? []) as ChatPageRow[];
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      chats: page.map(chatPageRowToChat),
      nextCursor: hasMore && last ? encodeCursor({ u: last.updated_at, i: last.id }) : null,
    };
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

  /**
   * One chat with its NEWEST message window (bounded, #212). Older history is
   * available via `chatApi.getMessagesPage(chatId, { cursor:
   * olderMessagesCursor })`. `messageCount` is the exact total, not the
   * window size.
   */
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

    let window: ChatMessagesPage;
    try {
      window = await chatApi.getMessagesPage(chatId, { limit: MESSAGE_PAGE_SIZE });
    } catch (error) {
      if (isSchemaOrTableNotFound(error)) {
        return { ...chat, messages: [], messageCount: 0, lastMessage: undefined, olderMessagesCursor: null };
      }
      throw error;
    }

    const { count, error: countError } = await fromAiChatMessages()
      .select('id', { count: 'exact', head: true })
      .eq('chat_id', chatId);
    if (countError && !isSchemaOrTableNotFound(countError)) throw countError;

    return {
      ...chat,
      messages: window.messages,
      messageCount: count ?? window.messages.length,
      lastMessage: window.messages[window.messages.length - 1],
      olderMessagesCursor: window.nextCursor,
    };
  },
};

export const chatApi = {
  /**
   * The NEWEST `limit` messages of a chat in ascending order (#212).
   * Used for model context and post-retry lookups; rendering paginates via
   * `getMessagesPage` instead.
   */
  async getMessages(chatId: string, limit: number = MESSAGE_CONTEXT_LIMIT): Promise<ChatMessage[]> {
    const { messages } = await chatApi.getMessagesPage(chatId, { limit });
    return messages;
  },

  /**
   * Keyset-paginated message history: the newest window first, then older
   * pages via the returned cursor. Ordering key is (created_at, id)
   * descending; each page is returned ascending for direct rendering.
   */
  async getMessagesPage(chatId: string, options: PageOptions = {}): Promise<ChatMessagesPage> {
    const limit = Math.min(Math.max(options.limit ?? MESSAGE_PAGE_SIZE, 1), 200);

    let query = fromAiChatMessages()
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    if (options.cursor) {
      const cursor = decodeCursor(options.cursor);
      query = query.or(
        `created_at.lt.${cursor.c},and(created_at.eq.${cursor.c},id.lt.${cursor.i})`,
      );
    }
    if (options.signal) {
      query = query.abortSignal(options.signal);
    }

    const { data, error } = await query;
    if (error) {
      if (isSchemaOrTableNotFound(error)) return { messages: [], nextCursor: null };
      throw error;
    }

    const rows = data || [];
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const oldest = page[page.length - 1];
    return {
      messages: [...page].reverse(),
      nextCursor:
        hasMore && oldest && oldest.created_at
          ? encodeCursor({ c: oldest.created_at, i: oldest.id })
          : null,
    };
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

export const chatTurnApi = {
  /**
   * Create (or, for a retried submission, return) the turn request for one
   * chat message. `idempotencyKey` must be stable across retries of the same
   * logical submission — a fresh key per call defeats deduplication.
   *
   * Returns `{ turn, created: false }` when a turn for this exact
   * `(chatId, idempotencyKey)` already exists, so the caller can skip
   * re-invoking the AI provider. Throws `ChatTurnActiveError` if a different
   * turn is already active for this chat.
   */
  async createProcessing(
    userId: string,
    chatId: string,
    userMessageId: string,
    correlationId: string,
    idempotencyKey: string,
  ): Promise<{ turn: ChatTurnRequest; created: boolean } | null> {
    const now = new Date().toISOString();
    const { data, error } = await fromAiChatTurnRequests()
      .insert({
        user_id: userId,
        chat_id: chatId,
        user_message_id: userMessageId,
        correlation_id: correlationId,
        idempotency_key: idempotencyKey,
        status: 'processing',
        updated_at: now,
      })
      .select()
      .single();

    if (error) {
      if (isSchemaOrTableNotFound(error)) return null;

      if (isUniqueViolation(error)) {
        if (error.message.includes('idx_chat_turn_requests_chat_idempotency')) {
          const { data: existing, error: selectError } = await fromAiChatTurnRequests()
            .select('*')
            .eq('chat_id', chatId)
            .eq('idempotency_key', idempotencyKey)
            .single();
          if (selectError) throw selectError;
          return { turn: existing as ChatTurnRequest, created: false };
        }
        if (error.message.includes('idx_chat_turn_requests_one_active')) {
          throw new ChatTurnActiveError(chatId);
        }
      }
      throw error;
    }
    return { turn: data as ChatTurnRequest, created: true };
  },

  /**
   * Persist the assistant message and mark the turn completed in one
   * database transaction via `ai.complete_chat_turn`, so the two writes
   * can never diverge on a crash/refresh between them.
   */
  async completeAtomic(turnId: string, content: string): Promise<ChatMessage> {
    const { data, error } = await aiDb.rpc('complete_chat_turn', {
      p_turn_id: turnId,
      p_content: content,
    });
    if (error) throw error;
    return data as ChatMessage;
  },

  async markFailed(turnId: string, failureCode: string, failureReason: string): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await fromAiChatTurnRequests()
      .update({
        status: 'failed',
        failure_code: failureCode,
        failure_reason: failureReason,
        updated_at: now,
        completed_at: now,
      })
      .eq('id', turnId);

    if (error && !isSchemaOrTableNotFound(error)) throw error;
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
