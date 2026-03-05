import { useState } from "react";
import { Plus, Calendar, DollarSign, FileText, BookOpen, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useCreatePosition, useOpenPositions } from "@/hooks/use-data";
import { useAuth } from "@/hooks/use-auth";
import { format, parseISO } from "date-fns";
import { useForm } from "react-hook-form";
import { toast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/error";

interface BuyTradeFormData {
  symbol: string;
  buy_date: string;
  quantity: number;
  buy_price: number;
  reasons: string;
  notes: string;
  tags: string;
}

export function TradeJournal() {
  const { data: openPositions = [], isLoading } = useOpenPositions();
  const createPosition = useCreatePosition();
  const { userId } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const todayDate = format(new Date(), "yyyy-MM-dd");

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<BuyTradeFormData>({
    defaultValues: {
      buy_date: todayDate,
    },
  });

  const onSubmit = async (data: BuyTradeFormData) => {
    if (!userId) {
      toast({
        title: "Error",
        description: "User not authenticated",
        variant: "destructive",
      });
      return;
    }

    try {
      const symbol = data.symbol.trim().toUpperCase();
      const buyDateIso = new Date(`${data.buy_date}T12:00:00.000Z`).toISOString();
      const tags = data.tags
        ? data.tags.split(",").map((tag) => tag.trim()).filter((tag) => tag.length > 0)
        : [];

      const reasonText = data.reasons?.trim();
      const notesText = data.notes?.trim();
      const combinedNotes = [
        reasonText ? `Reason: ${reasonText}` : null,
        notesText || null,
      ].filter(Boolean).join("\n\n");

      await createPosition.mutateAsync({
        symbol,
        name: symbol,
        quantity: data.quantity,
        entry_price: data.buy_price,
        current_price: null,
        type: "LONG",
        entry_date: buyDateIso,
        tags: tags.length > 0 ? tags : null,
        notes: combinedNotes || null,
      });

      toast({
        title: "Success",
        description: "BUY trade logged successfully.",
      });

      reset({
        symbol: "",
        buy_date: todayDate,
        quantity: undefined,
        buy_price: undefined,
        reasons: "",
        notes: "",
        tags: "",
      });
      setShowForm(false);
    } catch (error: unknown) {
      toast({
        title: "Error",
        description: getErrorMessage(error) || "Failed to log BUY trade",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground/70">
          {openPositions.length} open BUY {openPositions.length === 1 ? "lot" : "lots"}
        </p>
        <Button
          onClick={() => setShowForm(!showForm)}
          size="sm"
          className="h-8 w-full text-xs gap-1.5 sm:w-auto"
        >
          {showForm ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
          {showForm ? "Cancel" : "Log Trade"}
        </Button>
      </div>

      {showForm && (
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm animate-in fade-in slide-in-from-top-2 duration-200">
          <CardContent className="pt-5 pb-4">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1.5">
                  <Label htmlFor="symbol" className="text-xs">Symbol</Label>
                  <Input
                    id="symbol"
                    placeholder="AAPL"
                    className="h-9 text-sm"
                    {...register("symbol", { required: "Required" })}
                  />
                  {errors.symbol && <p className="text-[10px] text-destructive">{errors.symbol.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="buy_date" className="text-xs">Buy Date</Label>
                  <Input
                    id="buy_date"
                    type="date"
                    max={todayDate}
                    className="h-9 text-sm"
                    {...register("buy_date", {
                      required: true,
                      validate: (value) =>
                        value <= todayDate || "Buy date cannot be in the future",
                    })}
                  />
                  {errors.buy_date && <p className="text-[10px] text-destructive">{errors.buy_date.message}</p>}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="quantity" className="text-xs">Quantity</Label>
                  <Input
                    id="quantity"
                    type="number"
                    min="1"
                    placeholder="0"
                    className="h-9 text-sm"
                    {...register("quantity", { required: true, valueAsNumber: true, min: 1 })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="buy_price" className="text-xs">Buy Price</Label>
                  <Input
                    id="buy_price"
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="0.00"
                    className="h-9 text-sm"
                    {...register("buy_price", { required: true, valueAsNumber: true, min: 0.01 })}
                  />
                  <p className="text-[10px] text-muted-foreground/60">Stored exactly as entered.</p>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tags" className="text-xs">Tags (optional)</Label>
                <Input
                  id="tags"
                  placeholder="swing, earnings, breakout"
                  className="h-9 text-sm"
                  {...register("tags")}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="reasons" className="text-xs">Reasons (optional)</Label>
                <Input
                  id="reasons"
                  placeholder="Why are you entering this BUY?"
                  className="h-9 text-sm"
                  {...register("reasons")}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="notes" className="text-xs">Notes (optional)</Label>
                <Textarea
                  id="notes"
                  placeholder="Additional observations..."
                  rows={2}
                  className="text-sm resize-none"
                  {...register("notes")}
                />
              </div>

              <div className="flex flex-col gap-2 pt-1 sm:flex-row">
                <Button type="submit" size="sm" className="h-8 w-full text-xs sm:w-auto" disabled={createPosition.isPending}>
                  {createPosition.isPending ? "Saving..." : "Save BUY Trade"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-full text-xs sm:w-auto"
                  onClick={() => {
                    setShowForm(false);
                    reset();
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-24 bg-muted/30 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : openPositions.length === 0 ? (
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardContent className="py-12 text-center">
            <BookOpen className="h-8 w-8 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No BUY trades logged yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Click "Log Trade" to add your first BUY lot</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {openPositions.map((entry, index) => (
            <Card
              key={entry.id}
              className="border-border/50 bg-card/50 backdrop-blur-sm hover:bg-card/80 transition-colors animate-in fade-in"
              style={{ animationDelay: `${index * 30}ms` }}
            >
              <CardContent className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-profit/10 flex items-center justify-center shrink-0">
                      <DollarSign className="h-4 w-4 text-profit" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{entry.symbol}</span>
                        <Badge className="h-5 text-[10px] bg-profit/10 text-profit border-profit/20">OPEN</Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground/60">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {format(parseISO(entry.entry_date), "MMM d, yyyy")}
                        </span>
                        <span>{entry.quantity} shares @ ${entry.entry_price.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-left sm:text-right">
                    <div className="text-sm font-mono font-medium">${entry.entry_price.toFixed(2)}</div>
                    <div className="text-[10px] text-muted-foreground/50">BUY price</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card className="border-border/50 bg-card/30 backdrop-blur-sm">
        <CardContent className="py-3 px-4 flex items-center gap-2">
          <FileText className="h-3.5 w-3.5 text-muted-foreground/60" />
          <p className="text-[11px] text-muted-foreground/70">
            SELL actions are created only through <span className="font-medium text-foreground/90">Close Trade</span> on each BUY lot.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
