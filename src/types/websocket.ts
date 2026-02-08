export interface WSConnectedMessage {
  type: 'connected';
  connection_id: string;
  message: string;
}

export interface WSSubscribedMessage {
  type: 'subscribed';
  tickers: string[];
  message: string;
}

export interface WSUnsubscribedMessage {
  type: 'unsubscribed';
  tickers: string[];
  message: string;
}

export interface WSSubscriptionsMessage {
  type: 'subscriptions';
  tickers: string[];
  count: number;
}

export interface WSPriceUpdateMessage {
  type: 'price_update';
  ticker: string;
  price: number;
  change: number;
  change_percent: number;
  volume: number;
  timestamp: string;
}

export interface WSSignalMessage {
  type: 'signal';
  ticker: string;
  signal_type: 'BUY' | 'SELL' | 'STRONG_BUY' | 'STRONG_SELL' | 'HOLD';
  confidence: number;
  strategy: string;
  timestamp: string;
}

export interface WSIndicatorMessage {
  type: 'indicator_update';
  ticker: string;
  sma_10: number | null;
  sma_50: number | null;
  sma_200: number | null;
  rsi_14: number | null;
  macd: number | null;
  timestamp: string;
}

export interface WSEngineStatusMessage {
  type: 'engine_status';
  is_operational: boolean;
  is_halted: boolean;
  halt_reason: string | null;
  workers: {
    price: boolean;
    news: boolean;
    algorithm: boolean;
  };
  timestamp: string;
}

export interface WSErrorMessage {
  type: 'error';
  message: string;
  supported_actions?: string[];
}

export interface WSPongMessage {
  type: 'pong';
  timestamp: number;
}

export type WSMessage =
  | WSConnectedMessage
  | WSSubscribedMessage
  | WSUnsubscribedMessage
  | WSSubscriptionsMessage
  | WSPriceUpdateMessage
  | WSSignalMessage
  | WSIndicatorMessage
  | WSEngineStatusMessage
  | WSErrorMessage
  | WSPongMessage;

export type WSMessageType = WSMessage['type'];
export type MessageHandler<T extends WSMessage = WSMessage> = (data: T) => void;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === 'number';
}

export function parseWSMessage(raw: string): WSMessage | null {
  const parsed = JSON.parse(raw) as unknown;

  if (!isObject(parsed) || typeof parsed.type !== 'string') {
    return null;
  }

  switch (parsed.type) {
    case 'connected':
      return typeof parsed.connection_id === 'string' && typeof parsed.message === 'string'
        ? (parsed as WSConnectedMessage)
        : null;
    case 'subscribed':
    case 'unsubscribed':
      return isStringArray(parsed.tickers) && typeof parsed.message === 'string'
        ? (parsed as WSSubscribedMessage | WSUnsubscribedMessage)
        : null;
    case 'subscriptions':
      return isStringArray(parsed.tickers) && typeof parsed.count === 'number'
        ? (parsed as WSSubscriptionsMessage)
        : null;
    case 'price_update':
      return typeof parsed.ticker === 'string' &&
        typeof parsed.price === 'number' &&
        typeof parsed.change === 'number' &&
        typeof parsed.change_percent === 'number' &&
        typeof parsed.volume === 'number' &&
        typeof parsed.timestamp === 'string'
        ? (parsed as WSPriceUpdateMessage)
        : null;
    case 'signal':
      return typeof parsed.ticker === 'string' &&
        typeof parsed.signal_type === 'string' &&
        typeof parsed.confidence === 'number' &&
        typeof parsed.strategy === 'string' &&
        typeof parsed.timestamp === 'string'
        ? (parsed as WSSignalMessage)
        : null;
    case 'indicator_update':
      return typeof parsed.ticker === 'string' &&
        isNullableNumber(parsed.sma_10) &&
        isNullableNumber(parsed.sma_50) &&
        isNullableNumber(parsed.sma_200) &&
        isNullableNumber(parsed.rsi_14) &&
        isNullableNumber(parsed.macd) &&
        typeof parsed.timestamp === 'string'
        ? (parsed as WSIndicatorMessage)
        : null;
    case 'engine_status':
      return typeof parsed.is_operational === 'boolean' &&
        typeof parsed.is_halted === 'boolean' &&
        (typeof parsed.halt_reason === 'string' || parsed.halt_reason === null) &&
        isObject(parsed.workers) &&
        typeof parsed.workers.price === 'boolean' &&
        typeof parsed.workers.news === 'boolean' &&
        typeof parsed.workers.algorithm === 'boolean' &&
        typeof parsed.timestamp === 'string'
        ? (parsed as WSEngineStatusMessage)
        : null;
    case 'error':
      return typeof parsed.message === 'string' &&
        (parsed.supported_actions === undefined || isStringArray(parsed.supported_actions))
        ? (parsed as WSErrorMessage)
        : null;
    case 'pong':
      return typeof parsed.timestamp === 'number' ? (parsed as WSPongMessage) : null;
    default:
      return null;
  }
}
