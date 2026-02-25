import { Wifi, WifiOff, AlertCircle, CheckCircle, RefreshCw, Activity, Zap, TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useTradeEngineConnection,
  useTradeEngineStatus,
  useTradeEngineSignals,
} from "@/hooks/use-trade-engine";

import { cn } from "@/lib/utils";

interface TradeEngineStatusProps {
  /** Tickers to track signals for (optional) */
  tickers?: string[];
  /** Show recent signals panel */
  showSignals?: boolean;
  /** Compact mode for sidebar/header placement */
  compact?: boolean;
}

export function TradeEngineStatus({
  tickers = [],
  showSignals = true,
  compact = false,
}: TradeEngineStatusProps) {
  const { connectionState, isConnected, isConnecting, connect, disconnect } = useTradeEngineConnection();
  const engineStatus = useTradeEngineStatus();
  const { allSignals } = useTradeEngineSignals(tickers);

  const handleReconnect = () => {
    disconnect();
    setTimeout(() => connect(), 500);
  };

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <div className={cn(
          "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors",
          isConnected 
            ? "bg-profit/10 text-profit" 
            : isConnecting 
              ? "bg-yellow-500/10 text-yellow-500" 
              : "bg-muted text-muted-foreground"
        )}>
          {isConnected ? (
            <Wifi className="h-3 w-3" />
          ) : isConnecting ? (
            <RefreshCw className="h-3 w-3 animate-spin" />
          ) : (
            <WifiOff className="h-3 w-3" />
          )}
          <span>
            {isConnected ? "Engine Live" : isConnecting ? "Connecting..." : "Engine Offline"}
          </span>
        </div>
        {!isConnected && !isConnecting && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={connect}
          >
            Connect
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Connection Status Card */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              Trade Engine
            </span>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px]",
                isConnected
                  ? "border-profit/30 bg-profit/10 text-profit"
                  : isConnecting
                    ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-500"
                    : "border-muted-foreground/30"
              )}
            >
              {connectionState.toUpperCase()}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Connection Status */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isConnected ? (
                <CheckCircle className="h-4 w-4 text-profit" />
              ) : isConnecting ? (
                <RefreshCw className="h-4 w-4 text-yellow-500 animate-spin" />
              ) : (
                <AlertCircle className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="text-sm">
                {isConnected
                  ? "Connected to Trade Engine"
                  : isConnecting
                    ? "Establishing connection..."
                    : "Not connected"}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={isConnected ? handleReconnect : connect}
            >
              {isConnected ? "Reconnect" : "Connect"}
            </Button>
          </div>

          {/* Engine Status (if available) */}
          {engineStatus && (
            <div className="pt-2 border-t border-border/30 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Engine Status</span>
                <span className={cn(
                  "font-medium",
                  engineStatus.is_operational && !engineStatus.is_halted
                    ? "text-profit"
                    : "text-loss"
                )}>
                  {engineStatus.is_halted
                    ? "HALTED"
                    : engineStatus.is_operational
                      ? "OPERATIONAL"
                      : "ERROR"}
                </span>
              </div>
              {engineStatus.halt_reason && (
                <div className="text-xs text-loss bg-loss/10 p-2 rounded">
                  {engineStatus.halt_reason}
                </div>
              )}
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="flex items-center gap-1">
                  <span className={cn(
                    "h-2 w-2 rounded-full",
                    engineStatus.workers.price ? "bg-profit" : "bg-loss"
                  )} />
                  <span className="text-muted-foreground">Prices</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className={cn(
                    "h-2 w-2 rounded-full",
                    engineStatus.workers.news ? "bg-profit" : "bg-loss"
                  )} />
                  <span className="text-muted-foreground">News</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className={cn(
                    "h-2 w-2 rounded-full",
                    engineStatus.workers.algorithm ? "bg-profit" : "bg-loss"
                  )} />
                  <span className="text-muted-foreground">Algo</span>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Signals Card */}
      {showSignals && allSignals.length > 0 && (
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Recent Signals
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[200px] overflow-y-auto">
              {allSignals.slice(0, 10).map((signal, index) => (
                <div
                  key={`${signal.ticker}-${signal.timestamp}-${index}`}
                  className="flex items-center justify-between py-2 border-b border-border/20 last:border-0"
                >
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      "h-6 w-6 rounded flex items-center justify-center text-[10px] font-bold",
                      signal.signal_type.includes('BUY')
                        ? "bg-profit/10 text-profit"
                        : signal.signal_type.includes('SELL')
                          ? "bg-loss/10 text-loss"
                          : "bg-muted text-muted-foreground"
                    )}>
                      {signal.signal_type.includes('BUY') ? (
                        <TrendingUp className="h-3 w-3" />
                      ) : signal.signal_type.includes('SELL') ? (
                        <TrendingDown className="h-3 w-3" />
                      ) : (
                        <span>H</span>
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-xs">{signal.ticker}</span>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[9px] px-1 py-0 h-3.5",
                            signal.signal_type.includes('STRONG')
                              ? signal.signal_type.includes('BUY')
                                ? "border-profit/30 text-profit"
                                : "border-loss/30 text-loss"
                              : "border-muted-foreground/30"
                          )}
                        >
                          {signal.signal_type}
                        </Badge>
                      </div>
                      <div className="text-[10px] text-muted-foreground/60">
                        {signal.strategy}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-mono">
                      {(signal.confidence * 100).toFixed(0)}%
                    </div>
                    <div className="text-[10px] text-muted-foreground/50">
                      {new Date(signal.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * Inline connection indicator for headers/navbars
 */
export function TradeEngineIndicator() {
  const { isConnected, isConnecting, connect } = useTradeEngineConnection();

  return (
    <button
      onClick={!isConnected && !isConnecting ? connect : undefined}
      className={cn(
        "flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all",
        isConnected
          ? "bg-profit/10 text-profit cursor-default"
          : isConnecting
            ? "bg-yellow-500/10 text-yellow-500 cursor-wait"
            : "bg-muted/50 text-muted-foreground hover:bg-muted cursor-pointer"
      )}
      disabled={isConnected || isConnecting}
    >
      {isConnected ? (
        <>
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-profit opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-profit"></span>
          </span>
          <span>LIVE</span>
        </>
      ) : isConnecting ? (
        <>
          <RefreshCw className="h-2.5 w-2.5 animate-spin" />
          <span>CONNECTING</span>
        </>
      ) : (
        <>
          <WifiOff className="h-2.5 w-2.5" />
          <span>OFFLINE</span>
        </>
      )}
    </button>
  );
}
