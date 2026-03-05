import { useMemo, useState } from "react";
import { TrendingUp, TrendingDown, X, Briefcase, DollarSign, Activity } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useOpenPositions, useClosePosition } from "@/hooks/use-data";
import type { OpenPosition } from "@/types/database";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/error";

interface CloseTradeFormState {
  closeDate: string;
  closeQuantity: number;
  closePrice: number;
  reason: string;
  tags: string;
  notes: string;
}

function toDateTimeLocalValue(date: Date): string {
  const tzOffsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - tzOffsetMs).toISOString().slice(0, 16);
}

function buildCloseReason(reason: string, notes: string): string | null {
  const trimmedReason = reason.trim();
  const trimmedNotes = notes.trim();
  const combined = [
    trimmedReason ? `Reason: ${trimmedReason}` : null,
    trimmedNotes ? `Notes: ${trimmedNotes}` : null,
  ].filter(Boolean).join("\n\n");

  return combined || null;
}

export function OpenPositions() {
  const { data: positions = [], isLoading } = useOpenPositions();
  const closePosition = useClosePosition();
  const [selectedPosition, setSelectedPosition] = useState<OpenPosition | null>(null);
  const [isCloseDialogOpen, setIsCloseDialogOpen] = useState(false);
  const [closeForm, setCloseForm] = useState<CloseTradeFormState>({
    closeDate: toDateTimeLocalValue(new Date()),
    closeQuantity: 1,
    closePrice: 0,
    reason: "",
    tags: "",
    notes: "",
  });

  const portfolioSummary = useMemo(() => {
    let totalValue = 0;
    let totalPnL = 0;
    let totalCostBasis = 0;
    let missingPriceCount = 0;

    positions.forEach((position) => {
      const costBasis = position.entry_price * position.quantity;
      totalCostBasis += costBasis;

      if (position.current_price === null) {
        missingPriceCount += 1;
        return;
      }

      totalValue += position.current_price * position.quantity;
      totalPnL += (position.current_price - position.entry_price) * position.quantity;
    });

    const totalPnLPercent = totalCostBasis > 0 ? (totalPnL / totalCostBasis) * 100 : 0;

    return {
      totalValue,
      totalPnL,
      totalPnLPercent,
      missingPriceCount,
      hasCompletePricing: missingPriceCount === 0,
    };
  }, [positions]);

  const calculatePnL = (position: OpenPosition) => {
    if (position.current_price === null) {
      return null;
    }

    const pnl = (position.current_price - position.entry_price) * position.quantity;
    const pnlPercent = ((position.current_price - position.entry_price) / position.entry_price) * 100;
    return { pnl, pnlPercent };
  };

  const openCloseDialog = (position: OpenPosition) => {
    setSelectedPosition(position);
    setCloseForm({
      closeDate: toDateTimeLocalValue(new Date()),
      closeQuantity: position.quantity,
      closePrice: position.current_price ?? position.entry_price,
      reason: "",
      tags: "",
      notes: "",
    });
    setIsCloseDialogOpen(true);
  };

  const handleSubmitClose = async () => {
    if (!selectedPosition) return;

    try {
      const parsedCloseDate = new Date(closeForm.closeDate);
      if (Number.isNaN(parsedCloseDate.getTime())) {
        throw new Error("Close date is required.");
      }

      if (closeForm.closeQuantity <= 0 || closeForm.closeQuantity > selectedPosition.quantity) {
        throw new Error(`Close quantity must be between 1 and ${selectedPosition.quantity}.`);
      }

      if (closeForm.closePrice <= 0) {
        throw new Error("Close price must be greater than 0.");
      }

      const tags = closeForm.tags
        ? closeForm.tags.split(",").map((tag) => tag.trim()).filter((tag) => tag.length > 0)
        : [];

      await closePosition.mutateAsync({
        id: selectedPosition.id,
        close_time: parsedCloseDate.toISOString(),
        close_quantity: closeForm.closeQuantity,
        close_price: closeForm.closePrice,
        reason: buildCloseReason(closeForm.reason, closeForm.notes),
        tags: tags.length > 0 ? tags : null,
      });

      toast({
        title: "Trade Closed",
        description: `${selectedPosition.symbol} close recorded successfully.`,
      });

      setIsCloseDialogOpen(false);
      setSelectedPosition(null);
    } catch (error: unknown) {
      toast({
        title: "Close Failed",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-muted/30 rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-48 bg-muted/30 rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="h-3.5 w-3.5 text-muted-foreground/50" />
              <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide">Market Value</span>
            </div>
            <div className="text-xl font-bold">
              {portfolioSummary.hasCompletePricing
                ? `$${portfolioSummary.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                : "N/A"}
            </div>
            {!portfolioSummary.hasCompletePricing && (
              <div className="text-[10px] text-muted-foreground/60 mt-1">
                Missing latest price for {portfolioSummary.missingPriceCount} lot(s)
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="h-3.5 w-3.5 text-muted-foreground/50" />
              <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide">Unrealized P&amp;L</span>
            </div>
            {portfolioSummary.hasCompletePricing ? (
              <>
                <div className={cn("text-xl font-bold", portfolioSummary.totalPnL >= 0 ? "text-profit" : "text-loss")}>
                  {portfolioSummary.totalPnL >= 0 ? "+" : ""}${portfolioSummary.totalPnL.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </div>
                <div className={cn("text-[10px] mt-1", portfolioSummary.totalPnL >= 0 ? "text-profit/70" : "text-loss/70")}>
                  {portfolioSummary.totalPnLPercent >= 0 ? "+" : ""}{portfolioSummary.totalPnLPercent.toFixed(2)}%
                </div>
              </>
            ) : (
              <div className="text-xl font-bold text-muted-foreground/60">N/A</div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Briefcase className="h-3.5 w-3.5 text-muted-foreground/50" />
              <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wide">Open Lots</span>
            </div>
            <div className="text-xl font-bold">{positions.length}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden">
        <CardContent className="p-0">
          {positions.length === 0 ? (
            <div className="py-12 text-center">
              <Briefcase className="h-8 w-8 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No open BUY lots</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Log a BUY trade to create your first open lot</p>
            </div>
          ) : (
            <div className="divide-y divide-border/30">
              {positions.map((position, index) => {
                const pnlData = calculatePnL(position);
                const isProfit = (pnlData?.pnl || 0) >= 0;

                return (
                  <div
                    key={position.id}
                    className="flex flex-col gap-3 p-4 hover:bg-muted/30 transition-colors animate-in fade-in sm:flex-row sm:items-center sm:justify-between"
                    style={{ animationDelay: `${index * 30}ms` }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                        <span className="text-xs font-bold text-primary">{position.symbol.slice(0, 2)}</span>
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-sm">{position.symbol}</span>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-primary/5">
                            BUY LOT
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground/60 mt-0.5">
                          {position.quantity} open shares @ ${position.entry_price.toFixed(2)}
                        </div>
                      </div>
                    </div>

                    <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end sm:gap-4">
                      <div className="text-right hidden sm:block">
                        <div className="text-sm font-mono transition-colors text-foreground">
                          {position.current_price !== null ? `$${position.current_price.toFixed(2)}` : "N/A"}
                        </div>
                        <div className="text-[10px] text-muted-foreground/50">
                          {position.current_price !== null ? "latest db" : "no latest price"}
                        </div>
                      </div>

                      <div className="text-right min-w-[80px]">
                        {pnlData ? (
                          <>
                            <div className={cn("flex items-center justify-end gap-1 text-sm font-medium", isProfit ? "text-profit" : "text-loss")}>
                              {isProfit ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                              <span className="font-mono">{isProfit ? "+" : ""}${pnlData.pnl.toFixed(2)}</span>
                            </div>
                            <div className={cn("text-[10px]", isProfit ? "text-profit/70" : "text-loss/70")}>
                              {pnlData.pnlPercent >= 0 ? "+" : ""}{pnlData.pnlPercent.toFixed(2)}%
                            </div>
                          </>
                        ) : (
                          <div className="text-[12px] text-muted-foreground/60">N/A</div>
                        )}
                      </div>

                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted sm:h-7 sm:px-2"
                        onClick={() => openCloseDialog(position)}
                      >
                        <X className="h-3.5 w-3.5 mr-1" />
                        Close
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isCloseDialogOpen} onOpenChange={setIsCloseDialogOpen}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Close Trade</DialogTitle>
            <DialogDescription>
              Close all or part of this BUY lot. Close price defaults to latest database price and can be overridden.
            </DialogDescription>
          </DialogHeader>

          {selectedPosition && (
            <div className="space-y-3">
              <div className="rounded-md bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
                {selectedPosition.symbol} · Open quantity: <span className="font-medium text-foreground">{selectedPosition.quantity}</span> · Buy @ <span className="font-medium text-foreground">${selectedPosition.entry_price.toFixed(2)}</span>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="close-date" className="text-xs">Close Date</Label>
                <Input
                  id="close-date"
                  type="datetime-local"
                  value={closeForm.closeDate}
                  onChange={(event) => setCloseForm((prev) => ({ ...prev, closeDate: event.target.value }))}
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="close-quantity" className="text-xs">Close Quantity</Label>
                  <Input
                    id="close-quantity"
                    type="number"
                    min={1}
                    max={selectedPosition.quantity}
                    value={closeForm.closeQuantity}
                    onChange={(event) => setCloseForm((prev) => ({ ...prev, closeQuantity: Number(event.target.value) || 0 }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="close-price" className="text-xs">Close Price</Label>
                  <Input
                    id="close-price"
                    type="number"
                    min={0.01}
                    step="0.01"
                    value={closeForm.closePrice}
                    onChange={(event) => setCloseForm((prev) => ({ ...prev, closePrice: Number(event.target.value) || 0 }))}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="close-reason" className="text-xs">Sell Reason (optional)</Label>
                <Input
                  id="close-reason"
                  value={closeForm.reason}
                  onChange={(event) => setCloseForm((prev) => ({ ...prev, reason: event.target.value }))}
                  placeholder="Why are you closing this?"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="close-tags" className="text-xs">Tags (optional)</Label>
                <Input
                  id="close-tags"
                  value={closeForm.tags}
                  onChange={(event) => setCloseForm((prev) => ({ ...prev, tags: event.target.value }))}
                  placeholder="take-profit, risk-management"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="close-notes" className="text-xs">Notes (optional)</Label>
                <Textarea
                  id="close-notes"
                  rows={2}
                  value={closeForm.notes}
                  onChange={(event) => setCloseForm((prev) => ({ ...prev, notes: event.target.value }))}
                  placeholder="Additional context"
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => setIsCloseDialogOpen(false)}
              disabled={closePosition.isPending}
            >
              Cancel
            </Button>
            <Button
              className="w-full sm:w-auto"
              onClick={handleSubmitClose}
              disabled={
                closePosition.isPending ||
                !selectedPosition ||
                closeForm.closeQuantity <= 0 ||
                closeForm.closeQuantity > (selectedPosition?.quantity || 0) ||
                closeForm.closePrice <= 0
              }
            >
              {closePosition.isPending ? "Closing..." : "Close Trade"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
