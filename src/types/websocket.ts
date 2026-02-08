export interface WSBaseMessage {
  type: string;
}

export interface WSConnectedMessage extends WSBaseMessage {
  type: 'connected';
  connection_id: string;
  message: string;
}

export interface WSSubscribedMessage extends WSBaseMessage {
  type: 'subscribed';
  tickers: string[];
  message: string;
}

export interface WSUnsubscribedMessage extends WSBaseMessage {
  type: 'unsubscribed';
  tickers: string[];
  message: string;
}

export interface WSSubscriptionsMessage extends WSBaseMessage {
  type: 'subscriptions';
  tickers: string[];
  count: number;
}

export interface WSPriceUpdateMessage extends WSBaseMessage {
  type: 'price_update';
  ticker: string;
  price: number;
  change: number;
  change_percent: number;
  volume: number;
  timestamp: string;
}

export interface WSSignalMessage extends WSBaseMessage {
  type: 'signal';
  ticker: string;
  signal_type: 'BUY' | 'SELL' | 'STRONG_BUY' | 'STRONG_SELL' | 'HOLD';
  confidence: number;
  strategy: string;
  timestamp: string;
}

export interface WSIndicatorMessage extends WSBaseMessage {
  type: 'indicator_update';
  ticker: string;
  sma_10: number | null;
  sma_50: number | null;
  sma_200: number | null;
  rsi_14: number | null;
  macd: number | null;
  timestamp: string;
}

export interface WSEngineStatusMessage extends WSBaseMessage {
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

export interface WSErrorMessage extends WSBaseMessage {
  type: 'error';
  message: string;
  supported_actions?: string[];
}

export interface WSPongMessage extends WSBaseMessage {
  type: 'pong';
  timestamp: number;
}

export type WSKnownMessage =
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

export type WSMessage = WSKnownMessage;

export type WSMessageType = WSMessage['type'];

export type WSMessageHandler<T extends WSMessage = WSMessage> = (data: T) => void;

const WS_MESSAGE_TYPES: ReadonlySet<WSMessageType> = new Set([
  'connected',
  'subscribed',
  'unsubscribed',
  'subscriptions',
  'price_update',
  'signal',
  'indicator_update',
  'engine_status',
  'error',
  'pong',
]);

export function isWSMessage(value: unknown): value is WSMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const data = value as { type?: unknown };
  return typeof data.type === 'string' && WS_MESSAGE_TYPES.has(data.type as WSMessageType);
}
