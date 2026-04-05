import { useState, useCallback } from "react";
import { Plus, Calendar, DollarSign, FileText, BookOpen, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useCreateJournalEntry } from "@/hooks/use-data";
import { useAuth } from "@/hooks/use-auth";
import { format, parseISO } from "date-fns";
import { useForm } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/error";
import { cn } from "@/lib/utils";
import { rebuildPaperTradingState } from "@/services/paper-trading-sync";
import { AnalyticsEvents } from "@/services/analytics";
import type { OpenPosition, TradeJournalEntry } from "@/types/database";

interface JournalFormData {
  symbol: string;
  date: string;
  quantity: number;
  price: number;
  strategy: string;
  notes: string;
  tags: string;
}

type JournalEntryType = "BUY" | "SELL";

type JournalEntryDraft = {
  symbol: string;
  type: JournalEntryType;
  date: string;
  quantity: number;
  price: number;
  strategy: string | null;
  notes: string | null;
  tags: string[] | null;
};

type WorkspaceTradeJournalProps = {
  mode: 'workspace';
  openPositions: OpenPosition[];
  journalEntries: TradeJournalEntry[];
};

type JournalTradeJournalProps = {
  mode: 'journal';
  journalEntries: TradeJournalEntry[];
  isJournalLoading: boolean;
  openPositions: OpenPosition[];
};

type TradeJournalProps = WorkspaceTradeJournalProps | JournalTradeJournalProps;

function getTodayDateString() {
  return new Date().toISOString().split("T")[0];
}

function getSubmissionFingerprint(userId: string, data: Pick<JournalEntryDraft, "symbol" | "type" | "date" | "quantity" | "price">) {
  return JSON.stringify({
    userId,
    symbol: data.symbol.trim().toUpperCase(),
    type: data.type,
    date: data.date,
    quantity: data.quantity,
    price: data.price,
  });
}

function getStoredPartialFingerprints() {
  if (typeof window === 'undefined') return [];

  try {
    return JSON.parse(window.localStorage.getItem('paper-trading-partial-submissions') ?? '[]') as string[];
  } catch {
    return [];
  }
}

function storePartialFingerprint(fingerprint: string) {
  if (typeof window === 'undefined') return;

  const fingerprints = Array.from(new Set([...getStoredPartialFingerprints(), fingerprint]));
  window.localStorage.setItem('paper-trading-partial-submissions', JSON.stringify(fingerprints));
}

function clearPartialFingerprint(fingerprint: string) {
  if (typeof window === 'undefined') return;

  const fingerprints = getStoredPartialFingerprints().filter((item) => item !== fingerprint);
  window.localStorage.setItem('paper-trading-partial-submissions', JSON.stringify(fingerprints));
}

export function TradeJournal(props: TradeJournalProps) {
  const { mode, openPositions, journalEntries } = props;
  const isJournalLoading = props.mode === 'journal' ? props.isJournalLoading : false;
  const isWorkspaceMode = mode === 'workspace';
  const openPositionByEntryId = new Map(openPositions.map((position) => [position.id, position]));
  const queryClient = useQueryClient();
  const createEntry = useCreateJournalEntry();
  const { userId } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [showAllEntries, setShowAllEntries] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [closeConfirmEntry, setCloseConfirmEntry] = useState<TradeJournalEntry | null>(null);
  const { register, handleSubmit, reset, formState: { errors } } = useForm<JournalFormData>({
    defaultValues: {
      date: getTodayDateString(),
    }
  });
  const hasMoreEntries = journalEntries.length > 5;
  const visibleJournalEntries = !isWorkspaceMode && !showAllEntries ? journalEntries.slice(0, 5) : journalEntries;

  const refreshTradingQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['trade-journal', userId] }),
      queryClient.invalidateQueries({ queryKey: ['open-positions', userId] }),
      queryClient.invalidateQueries({ queryKey: ['trades', userId] }),
      queryClient.invalidateQueries({ queryKey: ['closed-trades', userId] }),
      queryClient.invalidateQueries({ queryKey: ['portfolio-history', userId] }),
      queryClient.invalidateQueries({ queryKey: ['trade-statistics', userId] }),
    ]);
  };

  const submitJournalEntry = async (
    draft: JournalEntryDraft,
    options?: {
      successDescription?: string;
      onSuccess?: () => void;
    },
  ) => {
    if (!userId) {
      toast({
        title: "Error",
        description: "User not authenticated",
        variant: "destructive",
      });
      return false;
    }

    if (isSubmitting) {
      return false;
    }

    const normalizedEntry: JournalEntryDraft = {
      ...draft,
      symbol: draft.symbol.trim().toUpperCase(),
      strategy: draft.strategy?.trim() ? draft.strategy.trim() : null,
      notes: draft.notes?.trim() ? draft.notes.trim() : null,
      tags: draft.tags?.map((tag) => tag.trim()).filter((tag) => tag.length > 0) ?? null,
    };

    const submissionFingerprint = getSubmissionFingerprint(userId, normalizedEntry);

    if (getStoredPartialFingerprints().includes(submissionFingerprint)) {
      toast({
        title: 'Review Required',
        description: 'A previous attempt may already have applied this trade. Review positions and history before retrying.',
        variant: 'default',
      });
      return false;
    }

    let createdEntry: TradeJournalEntry | null = null;
    setIsSubmitting(true);

    try {
      if (normalizedEntry.type === 'SELL') {
        const matchingPositions = openPositions
          .filter((pos) => pos.symbol.toUpperCase() === normalizedEntry.symbol && pos.type === 'LONG')
          .sort((a, b) => new Date(a.entry_date).getTime() - new Date(b.entry_date).getTime());

        const totalAvailableQuantity = matchingPositions.reduce((sum, pos) => sum + pos.quantity, 0);

        if (matchingPositions.length === 0 || totalAvailableQuantity <= 0) {
          throw new Error(`No open ${normalizedEntry.symbol} position available to sell.`);
        }

        if (normalizedEntry.quantity > totalAvailableQuantity) {
          throw new Error(
            `Cannot sell ${normalizedEntry.quantity} shares of ${normalizedEntry.symbol}. You only have ${totalAvailableQuantity} shares open.`
          );
        }
      }

      createdEntry = await createEntry.mutateAsync({
        symbol: normalizedEntry.symbol,
        type: normalizedEntry.type,
        date: normalizedEntry.date,
        quantity: normalizedEntry.quantity,
        price: normalizedEntry.price,
        strategy: normalizedEntry.strategy,
        notes: normalizedEntry.notes,
        tags: normalizedEntry.tags && normalizedEntry.tags.length > 0 ? normalizedEntry.tags : null,
        trade_id: null,
      });

      await rebuildPaperTradingState(userId, [...journalEntries, createdEntry]);
      await refreshTradingQueries();
      AnalyticsEvents.tradeExecuted(normalizedEntry.type, normalizedEntry.symbol, {
        quantity: normalizedEntry.quantity,
        price: normalizedEntry.price,
        has_strategy: Boolean(normalizedEntry.strategy),
        has_notes: Boolean(normalizedEntry.notes),
        tag_count: normalizedEntry.tags?.length ?? 0,
      });
      AnalyticsEvents.tradeJournalEntry({
        action: normalizedEntry.type,
        symbol: normalizedEntry.symbol,
      });

      clearPartialFingerprint(submissionFingerprint);

      toast({
        title: "Success",
        description: options?.successDescription
          ?? (normalizedEntry.type === 'BUY'
            ? "Position opened and journal entry created!"
            : "Position closed and journal entry created!"),
      });

      options?.onSuccess?.();
      return true;
    } catch (error: unknown) {
      if (createdEntry) {
        storePartialFingerprint(submissionFingerprint);
        await refreshTradingQueries();
      }

      const description = createdEntry
        ? `Journal entry saved but account rebuild failed - do not retry writes. ${getErrorMessage(error)}`
        : getErrorMessage(error) || "Failed to create trade";

      toast({
        title: createdEntry ? "Partial Success" : "Error",
        description,
        variant: createdEntry ? "default" : "destructive",
      });
      return false;
    } finally {
      setIsSubmitting(false);
    }
  };

  const onSubmit = async (data: JournalFormData) => {
    const didCreate = await submitJournalEntry({
      symbol: data.symbol,
      type: "BUY",
      date: data.date,
      quantity: data.quantity,
      price: data.price,
      strategy: data.strategy || null,
      notes: data.notes || null,
      tags: data.tags
        ? data.tags.split(",").map((tag) => tag.trim()).filter((tag) => tag.length > 0)
        : null,
    });

    if (!didCreate) {
      return;
    }

    reset({ date: getTodayDateString() });
    if (!isWorkspaceMode) {
      setShowForm(false);
    }
  };

  const handleSecondaryAction = () => {
    reset();

    if (!isWorkspaceMode) {
      setShowForm(false);
    }
  };

  const handleCloseTrade = useCallback((entry: TradeJournalEntry) => {
    setCloseConfirmEntry(entry);
  }, []);

  const executeCloseTrade = async () => {
    if (!closeConfirmEntry) return;

    const openPosition = openPositionByEntryId.get(closeConfirmEntry.id);
    if (!openPosition) {
      setCloseConfirmEntry(null);
      return;
    }

    const closePrice = Number((openPosition.current_price ?? openPosition.entry_price).toFixed(2));

    await submitJournalEntry(
      {
        symbol: openPosition.symbol,
        type: "SELL",
        date: getTodayDateString(),
        quantity: openPosition.quantity,
        price: closePrice,
        strategy: null,
        notes: null,
        tags: null,
      },
      {
        successDescription: `${openPosition.symbol} trade closed.`,
      },
    );
    setCloseConfirmEntry(null);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      {!isWorkspaceMode && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground/70">
            {journalEntries.length} journal {journalEntries.length === 1 ? 'entry' : 'entries'}
          </p>
          <Button 
            onClick={() => setShowForm(!showForm)} 
            size="sm" 
            className="h-8 text-xs gap-1.5"
            disabled={isSubmitting}
          >
            {showForm ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
            {showForm ? 'Cancel' : 'Log Trade'}
          </Button>
        </div>
      )}

      {/* Form */}
      {(isWorkspaceMode || showForm) && (
        <div className={cn(
          "animate-in fade-in slide-in-from-top-2 duration-200",
          isWorkspaceMode
            ? "space-y-5"
            : "rounded-xl border border-border/50 bg-card/50 px-5 pt-5 pb-4 backdrop-blur-sm"
        )}>
          {!isWorkspaceMode && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-muted/20 px-3 py-2">
              <div>
                <p className="text-sm font-medium text-foreground">Buy entry</p>
                <p className="text-xs text-muted-foreground/70">Close the position later from Journal.</p>
              </div>
              <Badge variant="outline" className="border-profit/30 bg-profit/5 text-profit">
                Buy only
              </Badge>
            </div>
          )}
          <div className={cn(!isWorkspaceMode && "pt-0")}>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="symbol" className="text-xs">Symbol</Label>
                  <Input
                    id="symbol"
                    placeholder="AAPL"
                    className="h-10 text-sm uppercase"
                    autoComplete="off"
                    {...register('symbol', { required: 'Required' })}
                  />
                  {errors.symbol && <p className="text-[10px] text-destructive">{errors.symbol.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="date" className="text-xs">Date</Label>
                  <Input
                    id="date"
                    type="date"
                    className="h-10 text-sm"
                    {...register('date', { required: true })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="quantity" className="text-xs">Quantity</Label>
                  <Input
                    id="quantity"
                    type="number"
                    placeholder="0"
                    className="h-10 text-sm"
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
                    className="h-10 text-sm"
                    {...register('price', { required: true, valueAsNumber: true, min: 0.01 })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="tags" className="text-xs">Tags</Label>
                  <Input
                    id="tags"
                    placeholder="momentum, tech"
                    className="h-10 text-sm"
                    {...register('tags')}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="strategy" className="text-xs">Strategy / Reasoning</Label>
                <Input
                  id="strategy"
                  placeholder="Why are you making this trade?"
                  className="h-10 text-sm"
                  {...register('strategy')}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="notes" className="text-xs">Notes</Label>
                <Textarea
                  id="notes"
                  placeholder="Additional observations..."
                  rows={3}
                  className="text-sm resize-none"
                  {...register('notes')}
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button type="submit" size="sm" className="h-8 text-xs" disabled={isSubmitting}>
                  {isSubmitting ? 'Saving...' : isWorkspaceMode ? 'Place Trade' : 'Save Entry'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={handleSecondaryAction}
                  disabled={isSubmitting}
                >
                  {isWorkspaceMode ? 'Reset' : 'Cancel'}
                </Button>
              </div>
            </form>
          </div>
        </div>
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
          {visibleJournalEntries.map((entry, index) => {
            const openPosition = entry.type === "BUY" ? openPositionByEntryId.get(entry.id) : undefined;

            return (
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
                    
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {entry.tags && entry.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 justify-end">
                          {entry.tags.map((tag, i) => (
                            <Badge key={i} variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-muted/50">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                      {openPosition && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => void handleCloseTrade(entry)}
                          disabled={isSubmitting}
                        >
                          <X className="h-3.5 w-3.5" />
                          Close
                        </Button>
                      )}
                    </div>
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
            );
          })}
          {hasMoreEntries && (
            <div className="flex justify-center pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setShowAllEntries((current) => !current)}
              >
                {showAllEntries ? "Show less" : `Show more (${journalEntries.length - visibleJournalEntries.length} more)`}
              </Button>
            </div>
          )}
        </div>
      )}
      {/* Close-trade confirmation dialog */}
      <AlertDialog open={closeConfirmEntry !== null} onOpenChange={(open) => { if (!open) setCloseConfirmEntry(null); }}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">Close trade?</AlertDialogTitle>
            <AlertDialogDescription className="text-sm">
              {(() => {
                if (!closeConfirmEntry) return "";
                const pos = openPositionByEntryId.get(closeConfirmEntry.id);
                if (!pos) return "This position is no longer open.";
                const closePrice = Number((pos.current_price ?? pos.entry_price).toFixed(2));
                return `Close the remaining ${pos.quantity} shares of ${pos.symbol} at $${closePrice.toFixed(2)}?`;
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-9">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void executeCloseTrade()}
              className="h-9 bg-destructive hover:bg-destructive/90"
              disabled={isSubmitting}
            >
              Close Trade
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
