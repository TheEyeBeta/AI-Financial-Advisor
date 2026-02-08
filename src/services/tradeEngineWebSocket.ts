/**
 * WebSocket service for connecting to The Eye Trade Engine
 * Provides real-time price updates, trading signals, and engine status
 */

import { MessageHandler, WSMessage, WSMessageType, parseWSMessage } from '@/types/websocket';

export type {
  MessageHandler,
  WSConnectedMessage,
  WSMessage,
  WSMessageType,
  WSPriceUpdateMessage,
  WSSignalMessage,
  WSIndicatorMessage,
  WSEngineStatusMessage,
} from '@/types/websocket';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

class TradeEngineWebSocket {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 2000; // Base delay in ms
  private handlers: Map<WSMessageType | '*', Set<MessageHandler<WSMessage>>> = new Map();
  private connectionStateHandlers: Set<(state: ConnectionState) => void> = new Set();
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private _connectionState: ConnectionState = 'disconnected';
  private _connectionId: string | null = null;

  private get baseUrl(): string {
    const httpUrl = import.meta.env.VITE_PYTHON_API_URL || 'http://localhost:8000';
    return httpUrl.replace(/^http/, 'ws');
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

  private setConnectionState(state: ConnectionState) {
    this._connectionState = state;
    this.connectionStateHandlers.forEach(handler => handler(state));
  }

  /**
   * Connect to the trade engine WebSocket
   */
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    this.setConnectionState('connecting');

    try {
      this.ws = new WebSocket(`${this.baseUrl}/ws/live`);

      this.ws.onopen = () => {
        console.log('[TradeEngine WS] Connected');
        this.reconnectAttempts = 0;
        this.setConnectionState('connected');
        this.startPingInterval();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = parseWSMessage(event.data);
          if (!data) {
            console.warn('[TradeEngine WS] Received unsupported message payload');
            return;
          }

          if (data.type === 'connected') {
            this._connectionId = data.connection_id;
          }

          // Call all registered handlers for this message type
          const handlers = this.handlers.get(data.type);
          if (handlers) {
            handlers.forEach(handler => {
              try {
                handler(data);
              } catch (err) {
                console.error(`[TradeEngine WS] Handler error for ${data.type}:`, err);
              }
            });
          }

          // Also call wildcard handlers
          const wildcardHandlers = this.handlers.get('*');
          if (wildcardHandlers) {
            wildcardHandlers.forEach(handler => {
              try {
                handler(data);
              } catch (err) {
                console.error('[TradeEngine WS] Wildcard handler error:', err);
              }
            });
          }
        } catch (err) {
          console.error('[TradeEngine WS] Failed to parse message:', err);
        }
      };

      this.ws.onclose = (event) => {
        console.log(`[TradeEngine WS] Disconnected (code: ${event.code})`);
        this.stopPingInterval();
        this._connectionId = null;

        if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.setConnectionState('reconnecting');
          const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
          console.log(`[TradeEngine WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);
          
          setTimeout(() => {
            this.reconnectAttempts++;
            this.connect();
          }, delay);
        } else {
          this.setConnectionState('disconnected');
        }
      };

      this.ws.onerror = (error) => {
        console.error('[TradeEngine WS] Error:', error);
      };
    } catch (err) {
      console.error('[TradeEngine WS] Failed to create WebSocket:', err);
      this.setConnectionState('disconnected');
    }
  }

  /**
   * Disconnect from the trade engine WebSocket
   */
  disconnect(): void {
    this.stopPingInterval();
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this._connectionId = null;
    this.reconnectAttempts = this.maxReconnectAttempts; // Prevent reconnection
    this.setConnectionState('disconnected');
  }

  /**
   * Subscribe to price updates for specific tickers
   */
  subscribe(tickers: string[]): void {
    if (!this.isConnected) {
      console.warn('[TradeEngine WS] Cannot subscribe: not connected');
      return;
    }

    this.ws?.send(JSON.stringify({
      action: 'subscribe',
      tickers: tickers.map(t => t.toUpperCase()),
    }));
  }

  /**
   * Unsubscribe from price updates for specific tickers
   */
  unsubscribe(tickers: string[]): void {
    if (!this.isConnected) {
      return;
    }

    this.ws?.send(JSON.stringify({
      action: 'unsubscribe',
      tickers: tickers.map(t => t.toUpperCase()),
    }));
  }

  /**
   * Get current subscriptions
   */
  getSubscriptions(): void {
    if (!this.isConnected) {
      return;
    }

    this.ws?.send(JSON.stringify({
      action: 'get_subscriptions',
    }));
  }

  /**
   * Send a ping to keep the connection alive
   */
  ping(): void {
    if (!this.isConnected) {
      return;
    }

    this.ws?.send(JSON.stringify({
      action: 'ping',
      timestamp: Date.now(),
    }));
  }

  /**
   * Register a handler for a specific message type
   * Use '*' to receive all messages
   */
  on<T extends WSMessage['type'] | '*'>(
    type: T,
    handler: MessageHandler<T extends '*' ? WSMessage : Extract<WSMessage, { type: T }>>
  ): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler as MessageHandler<WSMessage>);

    // Return unsubscribe function
    return () => {
      this.handlers.get(type)?.delete(handler as MessageHandler<WSMessage>);
    };
  }

  /**
   * Remove a handler for a specific message type
   */
  off<T extends WSMessage['type'] | '*'>(
    type: T,
    handler: MessageHandler<T extends '*' ? WSMessage : Extract<WSMessage, { type: T }>>
  ): void {
    this.handlers.get(type)?.delete(handler as MessageHandler<WSMessage>);
  }

  /**
   * Register a handler for connection state changes
   */
  onConnectionStateChange(handler: (state: ConnectionState) => void): () => void {
    this.connectionStateHandlers.add(handler);
    // Return unsubscribe function
    return () => {
      this.connectionStateHandlers.delete(handler);
    };
  }

  private startPingInterval(): void {
    this.stopPingInterval();
    // Send ping every 30 seconds to keep connection alive
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

// Export singleton instance
export const tradeEngineWS = new TradeEngineWebSocket();

// Also export class for testing
export { TradeEngineWebSocket };
