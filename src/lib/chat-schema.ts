export type ChatSchemaName = 'ai';

export const CHAT_SCHEMA_FALLBACKS: ChatSchemaName[] = ['ai'];

export function isMissingChatSchemaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const candidate = error as {
    code?: string;
    status?: number;
    message?: string;
    details?: string;
  };
  const message = `${candidate.message ?? ''} ${candidate.details ?? ''}`.toLowerCase();

  return (
    candidate.code === 'PGRST205' ||
    candidate.status === 404 ||
    message.includes('could not find the table') ||
    (message.includes('relation') && message.includes('does not exist'))
  );
}
