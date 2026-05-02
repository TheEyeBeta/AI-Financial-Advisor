/**
 * WebSocket service for connecting to The Eye Trade Engine
 * Provides real-time price updates, trading signals, and engine status
 */

import { getPythonWebSocketUrl } from '@/lib/env';
import { supabase } from '@/lib/supabase';
import {
  WSConnectedMessage,
  WSMessage,
  WSMessageHandler,
  WSMessageType,
  isWSMessage,
} from '@/types/websocket';

export type {
  WSConnectedMessage,
  WSSubscribedMessage,
  WSUnsubscribedMessage,
  WSSubscriptionsMessage,
  WSPriceUpdateMessage,
  WSSignalMessage,
  WSIndicatorMessage,
  WSEngineStatusMessage,
  WSErrorMessage,
  WSPongMessage,
  WSMessage,
} from '@/types/websocket';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

type HandlerKey = WSMessageType | '*';

class TradeEngineWebSocket {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private readonly reconnectDelay = 2000;
  // Hard ceiling on the exponential backoff so a future bump of
  // maxReconnectAttempts can't extend the wait into multi-minute territory,
  // and so the user sees a fresh attempt within a bounded window during a
  // partial outage. Current sequence with cap: 2s → 4s → 8s → 16s → 30s.
  private readonly maxReconnectDelay = 30000;
  private readonly handlers: Map<HandlerKey, Set<WSMessageHandler<WSMessage>>> = new Map();
  private readonly connectionStateHandlers: Set<(state: ConnectionState) => void> = new Set();
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private _connectionState: ConnectionState = 'disconnected';
  private _connectionId: string | null = null;

  private get baseUrl(): string {
    return getPythonWebSocketUrl();
  }

  get connectionState(): ConnectionState {
    return this._connectionState;
  }

  get connectionId(): string | null {
    return this._connectionId;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private setConnectionState(state: ConnectionState): void {
    this._connectionState = state;
    this.connectionStateHandlers.forEach((handler) => handler(state));
  }

  private handleMessage(rawData: unknown): void {
    if (typeof rawData !== 'string') {
      console.error('[TradeEngine WS] Received non-string message payload');
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawData);
    } catch (error) {
      console.error('[TradeEngine WS] Failed to parse message:', error);
      return;
    }

    if (!isWSMessage(parsed)) {
      console.error('[TradeEngine WS] Ignored unknown message payload:', parsed);
      return;
    }

    if (parsed.type === 'connected') {
      this._connectionId = (parsed as WSConnectedMessage).connection_id;
    }

    this.dispatchMessage(parsed);
  }

  private dispatchMessage<T extends WSMessage>(message: T): void {
    const handlers = this.handlers.get(message.type);
    handlers?.forEach((handler) => {
      try {
        handler(message);
      } catch (error) {
        console.error(`[TradeEngine WS] Handler error for ${message.type}:`, error);
      }
    });

    const wildcardHandlers = this.handlers.get('*');
    wildcardHandlers?.forEach((handler) => {
      try {
        handler(message);
      } catch (error) {
        console.error('[TradeEngine WS] Wildcard handler error:', error);
      }
    });
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    this.setConnectionState('connecting');

    void supabase.auth.getSession()
      .then(({ data: { session } }) => {
        const accessToken = session?.access_token;
        const tokenQuery = accessToken ? `?token=${encodeURIComponent(accessToken)}` : "";

        try {
          this.ws = new WebSocket(`${this.baseUrl}/ws/live${tokenQuery}`);

          this.ws.onopen = () => {
            console.log('[TradeEngine WS] Connected');
            this.reconnectAttempts = 0;
            this.setConnectionState('connected');
            this.startPingInterval();
          };

          this.ws.onmessage = (event) => {
            this.handleMessage(event.data);
          };

          this.ws.onclose = (event) => {
            console.log(`[TradeEngine WS] Disconnected (code: ${event.code})`);
            this.stopPingInterval();
            this._connectionId = null;

            if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
              this.setConnectionState('reconnecting');
              // Capped exponential backoff with ±20% jitter so a fleet of
              // clients reconnecting after a backend blip doesn't synchronise
              // and thunder the server.
              const exponential = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
              const capped = Math.min(exponential, this.maxReconnectDelay);
              const jitter = capped * (0.8 + Math.random() * 0.4);
              const delay = Math.round(jitter);
              console.log(
                `[TradeEngine WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`
              );

              setTimeout(() => {
                this.reconnectAttempts += 1;
                this.connect();
              }, delay);
            } else {
              this.setConnectionState('disconnected');
            }
          };

          this.ws.onerror = (error) => {
            console.error('[TradeEngine WS] Error:', error);
          };
        } catch (error) {
          console.error('[TradeEngine WS] Failed to create WebSocket:', error);
          this.setConnectionState('disconnected');
        }
      })
      .catch((error) => {
        console.error('[TradeEngine WS] Failed to read auth session:', error);
        this.setConnectionState('disconnected');
      });
  }

  disconnect(): void {
    this.stopPingInterval();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this._connectionId = null;
    this.reconnectAttempts = this.maxReconnectAttempts;
    this.setConnectionState('disconnected');
  }

  subscribe(tickers: string[]): void {
    if (!this.isConnected) {
      console.warn('[TradeEngine WS] Cannot subscribe: not connected');
      return;
    }

    this.ws?.send(
      JSON.stringify({
        action: 'subscribe',
        tickers: tickers.map((ticker) => ticker.toUpperCase()),
      })
    );
  }

  unsubscribe(tickers: string[]): void {
    if (!this.isConnected) {
      return;
    }

    this.ws?.send(
      JSON.stringify({
        action: 'unsubscribe',
        tickers: tickers.map((ticker) => ticker.toUpperCase()),
      })
    );
  }

  getSubscriptions(): void {
    if (!this.isConnected) {
      return;
    }

    this.ws?.send(
      JSON.stringify({
        action: 'get_subscriptions',
      })
    );
  }

  ping(): void {
    if (!this.isConnected) {
      return;
    }

    this.ws?.send(
      JSON.stringify({
        action: 'ping',
        timestamp: Date.now(),
      })
    );
  }

  on<T extends HandlerKey>(
    type: T,
    handler: WSMessageHandler<T extends '*' ? WSMessage : Extract<WSMessage, { type: T }>>
  ): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }

    const typedHandlers = this.handlers.get(type) as Set<
      WSMessageHandler<T extends '*' ? WSMessage : Extract<WSMessage, { type: T }>>
    >;

    typedHandlers.add(handler);

    return () => {
      typedHandlers.delete(handler);
    };
  }

  off<T extends HandlerKey>(
    type: T,
    handler: WSMessageHandler<T extends '*' ? WSMessage : Extract<WSMessage, { type: T }>>
  ): void {
    const typedHandlers = this.handlers.get(type) as
      | Set<WSMessageHandler<T extends '*' ? WSMessage : Extract<WSMessage, { type: T }>>>
      | undefined;

    typedHandlers?.delete(handler);
  }

  onConnectionStateChange(handler: (state: ConnectionState) => void): () => void {
    this.connectionStateHandlers.add(handler);
    return () => {
      this.connectionStateHandlers.delete(handler);
    };
  }

  private startPingInterval(): void {
    this.stopPingInterval();
    this.pingInterval = setInterval(() => {
      this.ping();
    }, 30000);
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
}

export const tradeEngineWS = new TradeEngineWebSocket();
export { TradeEngineWebSocket };
