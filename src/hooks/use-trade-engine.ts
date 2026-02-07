/**
 * React hooks for Trade Engine WebSocket integration
 * Provides real-time price updates, signals, and connection management
 */

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  tradeEngineWS,
  ConnectionState,
  WSPriceUpdateMessage,
  WSSignalMessage,
  WSIndicatorMessage,
  WSEngineStatusMessage,
} from '@/services/tradeEngineWebSocket';

/**
 * Hook to manage the Trade Engine WebSocket connection
 * Automatically connects on mount and disconnects on unmount
 */
export function useTradeEngineConnection() {
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    tradeEngineWS.connectionState
  );
  const [connectionId, setConnectionId] = useState<string | null>(
    tradeEngineWS.connectionId
  );

  useEffect(() => {
    // Subscribe to connection state changes
    const unsubscribe = tradeEngineWS.onConnectionStateChange((state) => {
      setConnectionState(state);
      setConnectionId(tradeEngineWS.connectionId);
    });

    // Connect if not already connected
    if (tradeEngineWS.connectionState === 'disconnected') {
      tradeEngineWS.connect();
    }

    return () => {
      unsubscribe();
    };
  }, []);

  const connect = useCallback(() => {
    tradeEngineWS.connect();
  }, []);

  const disconnect = useCallback(() => {
    tradeEngineWS.disconnect();
  }, []);

  return {
    connectionState,
    connectionId,
    isConnected: connectionState === 'connected',
    isConnecting: connectionState === 'connecting' || connectionState === 'reconnecting',
    connect,
    disconnect,
  };
}

/**
 * Hook to subscribe to real-time price updates for specific tickers
 */
export function useTradeEnginePrices(tickers: string[]) {
  const [prices, setPrices] = useState<Record<string, WSPriceUpdateMessage>>({});
  const tickersRef = useRef<string[]>([]);
  const normalizedTickers = useMemo(() => tickers.map((ticker) => ticker.toUpperCase()), [tickers]);

  useEffect(() => {
    // Connect if not already connected
    if (tradeEngineWS.connectionState === 'disconnected') {
      tradeEngineWS.connect();
    }

    // Handle price updates
    const unsubscribe = tradeEngineWS.on('price_update', (data) => {
      setPrices((prev) => ({
        ...prev,
        [data.ticker]: data,
      }));
    });

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    // Determine which tickers to subscribe/unsubscribe
    const currentTickers = new Set(normalizedTickers);
    const previousTickers = new Set(tickersRef.current);

    const toSubscribe = [...currentTickers].filter(t => !previousTickers.has(t));
    const toUnsubscribe = [...previousTickers].filter(t => !currentTickers.has(t));

    if (toSubscribe.length > 0 && tradeEngineWS.isConnected) {
      tradeEngineWS.subscribe(toSubscribe);
    }

    if (toUnsubscribe.length > 0 && tradeEngineWS.isConnected) {
      tradeEngineWS.unsubscribe(toUnsubscribe);
    }

    tickersRef.current = [...currentTickers];

    // Subscribe when connection is established
    const unsubscribeConnection = tradeEngineWS.on('connected', () => {
      if (currentTickers.size > 0) {
        tradeEngineWS.subscribe([...currentTickers]);
      }
    });

    return () => {
      unsubscribeConnection();
      // Unsubscribe from all tickers on unmount
      if (tradeEngineWS.isConnected && tickersRef.current.length > 0) {
        tradeEngineWS.unsubscribe(tickersRef.current);
      }
    };
  }, [normalizedTickers]);

  return prices;
}

/**
 * Hook to subscribe to trading signals for specific tickers
 */
export function useTradeEngineSignals(tickers: string[]) {
  const [signals, setSignals] = useState<Record<string, WSSignalMessage>>({});
  const [allSignals, setAllSignals] = useState<WSSignalMessage[]>([]);
  const normalizedTickers = useMemo(() => tickers.map((ticker) => ticker.toUpperCase()), [tickers]);

  useEffect(() => {
    // Connect if not already connected
    if (tradeEngineWS.connectionState === 'disconnected') {
      tradeEngineWS.connect();
    }

    // Handle signal updates
    const unsubscribe = tradeEngineWS.on('signal', (data) => {
      // Only track signals for our tickers
      if (normalizedTickers.length === 0 || normalizedTickers.includes(data.ticker)) {
        setSignals((prev) => ({
          ...prev,
          [data.ticker]: data,
        }));
        setAllSignals((prev) => [data, ...prev].slice(0, 100)); // Keep last 100 signals
      }
    });

    return () => {
      unsubscribe();
    };
  }, [normalizedTickers]);

  return { signals, allSignals };
}

/**
 * Hook to subscribe to indicator updates for specific tickers
 */
export function useTradeEngineIndicators(tickers: string[]) {
  const [indicators, setIndicators] = useState<Record<string, WSIndicatorMessage>>({});
  const normalizedTickers = useMemo(() => tickers.map((ticker) => ticker.toUpperCase()), [tickers]);

  useEffect(() => {
    // Connect if not already connected
    if (tradeEngineWS.connectionState === 'disconnected') {
      tradeEngineWS.connect();
    }

    // Handle indicator updates
    const unsubscribe = tradeEngineWS.on('indicator_update', (data) => {
      if (normalizedTickers.length === 0 || normalizedTickers.includes(data.ticker)) {
        setIndicators((prev) => ({
          ...prev,
          [data.ticker]: data,
        }));
      }
    });

    return () => {
      unsubscribe();
    };
  }, [normalizedTickers]);

  return indicators;
}

/**
 * Hook to monitor trade engine status
 */
export function useTradeEngineStatus() {
  const [status, setStatus] = useState<WSEngineStatusMessage | null>(null);

  useEffect(() => {
    // Connect if not already connected
    if (tradeEngineWS.connectionState === 'disconnected') {
      tradeEngineWS.connect();
    }

    // Handle engine status updates
    const unsubscribe = tradeEngineWS.on('engine_status', (data) => {
      setStatus(data);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  return status;
}

/**
 * Combined hook for all trade engine data for a set of tickers
 */
export function useTradeEngine(tickers: string[]) {
  const { connectionState, isConnected, isConnecting } = useTradeEngineConnection();
  const prices = useTradeEnginePrices(tickers);
  const { signals, allSignals } = useTradeEngineSignals(tickers);
  const indicators = useTradeEngineIndicators(tickers);
  const engineStatus = useTradeEngineStatus();

  return {
    connectionState,
    isConnected,
    isConnecting,
    prices,
    signals,
    allSignals,
    indicators,
    engineStatus,
  };
}
