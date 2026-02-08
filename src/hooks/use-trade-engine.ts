/**
 * React hooks for Trade Engine WebSocket integration
 * Provides real-time price updates, signals, and connection management
 */

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  tradeEngineWS,
  ConnectionState,
  WSPriceUpdateMessage,
  WSSignalMessage,
  WSIndicatorMessage,
  WSEngineStatusMessage,
} from '@/services/tradeEngineWebSocket';

function useNormalizedTickers(tickers: string[]) {
  return useMemo(
    () => [...new Set(tickers.map((ticker) => ticker.toUpperCase()))].sort(),
    [tickers],
  );
}

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
    const unsubscribe = tradeEngineWS.onConnectionStateChange((state) => {
      setConnectionState(state);
      setConnectionId(tradeEngineWS.connectionId);
    });

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
  const subscribedTickersRef = useRef<string[]>([]);
  const normalizedTickers = useNormalizedTickers(tickers);

  useEffect(() => {
    if (tradeEngineWS.connectionState === 'disconnected') {
      tradeEngineWS.connect();
    }

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
    const currentTickers = new Set(normalizedTickers);
    const previousTickers = new Set(subscribedTickersRef.current);

    const toSubscribe = [...currentTickers].filter((ticker) => !previousTickers.has(ticker));
    const toUnsubscribe = [...previousTickers].filter((ticker) => !currentTickers.has(ticker));

    if (toSubscribe.length > 0 && tradeEngineWS.isConnected) {
      tradeEngineWS.subscribe(toSubscribe);
    }

    if (toUnsubscribe.length > 0 && tradeEngineWS.isConnected) {
      tradeEngineWS.unsubscribe(toUnsubscribe);
    }

    subscribedTickersRef.current = [...currentTickers];

    const unsubscribeConnection = tradeEngineWS.on('connected', () => {
      if (currentTickers.size > 0) {
        tradeEngineWS.subscribe([...currentTickers]);
      }
    });

    return () => {
      unsubscribeConnection();
      if (tradeEngineWS.isConnected && subscribedTickersRef.current.length > 0) {
        tradeEngineWS.unsubscribe(subscribedTickersRef.current);
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
  const normalizedTickers = useNormalizedTickers(tickers);

  useEffect(() => {
    if (tradeEngineWS.connectionState === 'disconnected') {
      tradeEngineWS.connect();
    }

    const trackedTickers = new Set(normalizedTickers);
    const unsubscribe = tradeEngineWS.on('signal', (data) => {
      if (trackedTickers.size === 0 || trackedTickers.has(data.ticker)) {
        setSignals((prev) => ({
          ...prev,
          [data.ticker]: data,
        }));
        setAllSignals((prev) => [data, ...prev].slice(0, 100));
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
  const normalizedTickers = useNormalizedTickers(tickers);

  useEffect(() => {
    if (tradeEngineWS.connectionState === 'disconnected') {
      tradeEngineWS.connect();
    }

    const trackedTickers = new Set(normalizedTickers);
    const unsubscribe = tradeEngineWS.on('indicator_update', (data) => {
      if (trackedTickers.size === 0 || trackedTickers.has(data.ticker)) {
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
    if (tradeEngineWS.connectionState === 'disconnected') {
      tradeEngineWS.connect();
    }

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
