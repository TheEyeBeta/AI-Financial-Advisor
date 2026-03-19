import { useState } from "react";
import { Plus, Calendar, DollarSign, FileText, BookOpen, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useCreateJournalEntry } from "@/hooks/use-data";
import { positionsApi, tradesApi } from "@/services/api";
import { useAuth } from "@/hooks/use-auth";
import { format, parseISO } from "date-fns";
import { useForm, Controller } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/error";
import { cn } from "@/lib/utils";
import type { OpenPosition, TradeJournalEntry } from "@/types/database";

interface JournalFormData {
  symbol: string;
  type: 'BUY' | 'SELL';
  date: string;
  quantity: number;
  price: number;
  strategy: string;
  notes: string;
  tags: string;
}

interface TradeJournalProps {
  mode?: 'workspace' | 'journal';
  journalEntries?: TradeJournalEntry[];
  isJournalLoading?: boolean;
  openPositions?: OpenPosition[];
}

export function TradeJournal({
  mode = 'workspace',
  journalEntries = [],
  isJournalLoading = false,
  openPositions = [],
}: TradeJournalProps) {
  const isWorkspaceMode = mode === 'workspace';
  const queryClient = useQueryClient();
  const createEntry = useCreateJournalEntry();
  const { userId } = useAuth();
  const [showForm, setShowForm] = useState(mode === 'workspace');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { register, handleSubmit, reset, control, formState: { errors } } = useForm<JournalFormData>({
    defaultValues: {
      type: 'BUY',
      date: new Date().toISOString().split('T')[0],
    }
  });

  const refreshTradingQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['open-positions', userId] }),
      queryClient.invalidateQueries({ queryKey: ['trades', userId] }),
      queryClient.invalidateQueries({ queryKey: ['closed-trades', userId] }),
      queryClient.invalidateQueries({ queryKey: ['portfolio-history', userId] }),
      queryClient.invalidateQueries({ queryKey: ['trade-statistics', userId] }),
    ]);
  };

  const onSubmit = async (data: JournalFormData) => {
    if (!userId) {
      toast({
        title: "Error",
        description: "User not authenticated",
        variant: "destructive",
      });
      return;
    }

    if (isSubmitting) {
      return;
    }

    let shouldRefreshTradingData = false;
    setIsSubmitting(true);

    try {
      const tags = data.tags
        ? data.tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0)
        : [];

      const symbol = data.symbol.trim().toUpperCase();
      const tradeDateIso = new Date(`${data.date}T12:00:00.000Z`).toISOString();
      let tradeId: string | null = null;

      // If BUY, create an open position
      if (data.type === 'BUY') {
        await positionsApi.create(userId, {
          symbol,
          name: symbol,
          quantity: data.quantity,
          entry_price: data.price,
          current_price: data.price,
          type: 'LONG',
          entry_date: tradeDateIso,
        });

        shouldRefreshTradingData = true;

        const trade = await tradesApi.create(userId, {
          symbol,
          type: 'LONG',
          action: 'OPENED',
          quantity: data.quantity,
          entry_price: data.price,
          exit_price: null,
          entry_date: tradeDateIso,
          exit_date: null,
          pnl: null,
        });
        tradeId = trade.id;
        shouldRefreshTradingData = true;
      } 
      else if (data.type === 'SELL') {
        const matchingPositions = openPositions
          .filter((pos) => pos.symbol.toUpperCase() === symbol && pos.type === 'LONG')
          .sort((a, b) => new Date(a.entry_date).getTime() - new Date(b.entry_date).getTime());

        const totalAvailableQuantity = matchingPositions.reduce((sum, pos) => sum + pos.quantity, 0);

        if (matchingPositions.length === 0 || totalAvailableQuantity <= 0) {
          throw new Error(`No open ${symbol} position available to sell.`);
        }

        if (data.quantity > totalAvailableQuantity) {
          throw new Error(
            `Cannot sell ${data.quantity} shares of ${symbol}. You only have ${totalAvailableQuantity} shares open.`
          );
        }

        let remainingToSell = data.quantity;
        let soldQuantity = 0;
        let costBasisSold = 0;
        const oldestEntryDate = matchingPositions[0].entry_date;

        for (const position of matchingPositions) {
          if (remainingToSell <= 0) break;

          const quantityFromLot = Math.min(position.quantity, remainingToSell);
          soldQuantity += quantityFromLot;
          costBasisSold += quantityFromLot * position.entry_price;
          remainingToSell -= quantityFromLot;

          if (quantityFromLot === position.quantity) {
            await positionsApi.delete(position.id, userId);
          } else {
            await positionsApi.update(position.id, userId, {
              quantity: position.quantity - quantityFromLot,
            });
          }

          shouldRefreshTradingData = true;
        }

        const averageEntryPrice = soldQuantity > 0 ? costBasisSold / soldQuantity : data.price;
        const pnl = (data.price - averageEntryPrice) * soldQuantity;

        shouldRefreshTradingData = true;

        const trade = await tradesApi.create(userId, {
          symbol,
          type: 'LONG',
          action: 'CLOSED',
          quantity: soldQuantity,
          entry_price: averageEntryPrice,
          exit_price: data.price,
          entry_date: oldestEntryDate,
          exit_date: tradeDateIso,
          pnl,
        });
        tradeId = trade.id;
      }

      if (shouldRefreshTradingData) {
        await refreshTradingQueries();
      }

      await createEntry.mutateAsync({
        symbol,
        type: data.type,
        date: data.date,
        quantity: data.quantity,
        price: data.price,
        strategy: data.strategy || null,
        notes: data.notes || null,
        tags: tags.length > 0 ? tags : null,
        trade_id: tradeId,
      });

      toast({
        title: "Success",
        description: data.type === 'BUY' 
          ? "Position opened and journal entry created!" 
          : "Position closed and journal entry created!",
      });

      reset();
      if (!isWorkspaceMode) {
        setShowForm(false);
      }
    } catch (error: unknown) {
      if (shouldRefreshTradingData) {
        await refreshTradingQueries();
      }

      toast({
        title: "Error",
        description: getErrorMessage(error) || "Failed to create trade",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        {!isWorkspaceMode && (
          <p className="text-xs text-muted-foreground/70">
            {journalEntries.length} journal {journalEntries.length === 1 ? 'entry' : 'entries'}
          </p>
        )}
        <Button 
          onClick={() => setShowForm(!showForm)} 
          size="sm" 
          className="h-8 text-xs gap-1.5"
          disabled={isSubmitting}
        >
          {showForm ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
          {isWorkspaceMode && showForm ? 'Cancel' : isWorkspaceMode ? 'Place Trade' : showForm ? 'Cancel' : 'Log Trade'}
        </Button>
      </div>

      {/* Form */}
      {showForm && (
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm animate-in fade-in slide-in-from-top-2 duration-200">
          <CardContent className="pt-5 pb-4">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="symbol" className="text-xs">Symbol</Label>
                  <Input
                    id="symbol"
                    placeholder="AAPL"
                    className="h-9 text-sm"
                    {...register('symbol', { required: 'Required' })}
                  />
                  {errors.symbol && <p className="text-[10px] text-destructive">{errors.symbol.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Action</Label>
                  <Controller
                    name="type"
                    control={control}
                    rules={{ required: true }}
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger className="h-9 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="BUY">Buy</SelectItem>
                          <SelectItem value="SELL">Sell</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="date" className="text-xs">Date</Label>
                  <Input
                    id="date"
                    type="date"
                    className="h-9 text-sm"
                    {...register('date', { required: true })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="quantity" className="text-xs">Quantity</Label>
                  <Input
                    id="quantity"
                    type="number"
                    placeholder="0"
                    className="h-9 text-sm"
                    {...register('quantity', { required: true, valueAsNumber: true, min: 1 })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="price" className="text-xs">Price</Label>
                  <Input
                    id="price"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    className="h-9 text-sm"
                    {...register('price', { required: true, valueAsNumber: true, min: 0.01 })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="tags" className="text-xs">Tags</Label>
                  <Input
                    id="tags"
                    placeholder="momentum, tech"
                    className="h-9 text-sm"
                    {...register('tags')}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="strategy" className="text-xs">Strategy / Reasoning</Label>
                <Input
                  id="strategy"
                  placeholder="Why are you making this trade?"
                  className="h-9 text-sm"
                  {...register('strategy')}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="notes" className="text-xs">Notes</Label>
                <Textarea
                  id="notes"
                  placeholder="Additional observations..."
                  rows={2}
                  className="text-sm resize-none"
                  {...register('notes')}
                />
              </div>

              <div className="flex gap-2 pt-1">
                <Button type="submit" size="sm" className="h-8 text-xs" disabled={isSubmitting}>
                  {isSubmitting ? 'Saving...' : isWorkspaceMode ? 'Place Trade' : 'Save Entry'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => { if (!isWorkspaceMode) setShowForm(false); reset(); }}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Journal Entries */}
      {isWorkspaceMode ? null : isJournalLoading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-24 bg-muted/30 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : journalEntries.length === 0 ? (
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardContent className="py-12 text-center">
            <BookOpen className="h-8 w-8 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No journal entries yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Click "Log Trade" to document your first trade</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {journalEntries.map((entry, index) => (
            <Card 
              key={entry.id} 
              className="border-border/50 bg-card/50 backdrop-blur-sm hover:bg-card/80 transition-colors animate-in fade-in"
              style={{ animationDelay: `${index * 30}ms` }}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "h-9 w-9 rounded-lg flex items-center justify-center shrink-0",
                      entry.type === "BUY" ? "bg-profit/10" : "bg-loss/10"
                    )}>
                      <span className={cn(
                        "text-xs font-bold",
                        entry.type === "BUY" ? "text-profit" : "text-loss"
                      )}>
                        {entry.type === "BUY" ? "B" : "S"}
                      </span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{entry.symbol}</span>
                        <Badge 
                          variant="outline" 
                          className={cn(
                            "text-[10px] px-1.5 py-0 h-4",
                            entry.type === "BUY" ? "text-profit border-profit/30" : "text-loss border-loss/30"
                          )}
                        >
                          {entry.type}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground/60 mt-0.5">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {format(parseISO(entry.date), "MMM d, yyyy")}
                        </span>
                        <span className="flex items-center gap-1">
                          <DollarSign className="h-3 w-3" />
                          {entry.quantity} shares @ ${entry.price.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  {entry.tags && entry.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 justify-end">
                      {entry.tags.map((tag, i) => (
                        <Badge key={i} variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-muted/50">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                {(entry.strategy || entry.notes) && (
                  <div className="mt-3 pt-3 border-t border-border/30 space-y-2">
                    {entry.strategy && (
                      <div className="flex items-start gap-2">
                        <FileText className="h-3.5 w-3.5 text-primary/70 mt-0.5 shrink-0" />
                        <p className="text-xs text-muted-foreground">{entry.strategy}</p>
                      </div>
                    )}
                    {entry.notes && (
                      <div className="rounded-lg bg-muted/30 p-2.5">
                        <p className="text-xs text-muted-foreground/80">{entry.notes}</p>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
