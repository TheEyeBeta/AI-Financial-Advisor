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

export type MessageHandler<T extends WSMessage = WSMessage> = (data: T) => void;
