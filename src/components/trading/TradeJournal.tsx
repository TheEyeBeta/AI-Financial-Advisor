import { useState } from "react";
import { Plus, Calendar, DollarSign, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useTradeJournal, useCreateJournalEntry } from "@/hooks/use-data";
import { format, parseISO } from "date-fns";
import { useForm, Controller } from "react-hook-form";
import { toast } from "@/hooks/use-toast";

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

export function TradeJournal() {
  const { data: journalEntries = [], isLoading } = useTradeJournal();
  const createEntry = useCreateJournalEntry();
  const [showForm, setShowForm] = useState(false);
  const { register, handleSubmit, reset, control, formState: { errors } } = useForm<JournalFormData>({
    defaultValues: {
      type: 'BUY',
      date: new Date().toISOString().split('T')[0],
    }
  });

  const onSubmit = async (data: JournalFormData) => {
    try {
      const tags = data.tags
        ? data.tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0)
        : [];

      await createEntry.mutateAsync({
        symbol: data.symbol.toUpperCase(),
        type: data.type,
        date: data.date,
        quantity: data.quantity,
        price: data.price,
        strategy: data.strategy || null,
        notes: data.notes || null,
        tags: tags.length > 0 ? tags : null,
      });

      toast({
        title: "Success",
        description: "Trade journal entry created successfully!",
      });

      reset();
      setShowForm(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create journal entry",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">Trade Journal</h2>
          <p className="text-sm text-muted-foreground">
            Document your trades and trading rationale
          </p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          <Plus className="mr-2 h-4 w-4" />
          Log Trade
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">New Trade Entry</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="symbol">Symbol *</Label>
                <Input
                  id="symbol"
                  placeholder="e.g., AAPL"
                  {...register('symbol', { required: 'Symbol is required' })}
                />
                {errors.symbol && (
                  <p className="text-xs text-destructive">{errors.symbol.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="type">Action *</Label>
                <Controller
                  name="type"
                  control={control}
                  rules={{ required: 'Action is required' }}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select action" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="BUY">Buy</SelectItem>
                        <SelectItem value="SELL">Sell</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.type && (
                  <p className="text-xs text-destructive">{errors.type.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="quantity">Quantity *</Label>
                <Input
                  id="quantity"
                  type="number"
                  placeholder="0"
                  {...register('quantity', {
                    required: 'Quantity is required',
                    valueAsNumber: true,
                    min: { value: 1, message: 'Quantity must be at least 1' }
                  })}
                />
                {errors.quantity && (
                  <p className="text-xs text-destructive">{errors.quantity.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="price">Price *</Label>
                <Input
                  id="price"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  {...register('price', {
                    required: 'Price is required',
                    valueAsNumber: true,
                    min: { value: 0.01, message: 'Price must be greater than 0' }
                  })}
                />
                {errors.price && (
                  <p className="text-xs text-destructive">{errors.price.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="date">Date *</Label>
                <Input
                  id="date"
                  type="date"
                  {...register('date', { required: 'Date is required' })}
                />
                {errors.date && (
                  <p className="text-xs text-destructive">{errors.date.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="tags">Tags (comma separated)</Label>
                <Input
                  id="tags"
                  placeholder="e.g., momentum, tech"
                  {...register('tags')}
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="strategy">Strategy / Reasoning</Label>
                <Input
                  id="strategy"
                  placeholder="Why are you making this trade?"
                  {...register('strategy')}
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  placeholder="Additional notes, observations, risk management..."
                  rows={3}
                  {...register('notes')}
                />
              </div>

              <div className="flex gap-2 md:col-span-2">
                <Button type="submit" disabled={createEntry.isPending}>
                  {createEntry.isPending ? 'Saving...' : 'Save Entry'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
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
        <div className="text-sm text-muted-foreground py-4">Loading journal entries...</div>
      ) : journalEntries.length === 0 ? (
        <div className="text-sm text-muted-foreground py-4">
          No journal entries yet. Click "Log Trade" to add your first entry!
        </div>
      ) : (
        <div className="space-y-4">
          {journalEntries.map((entry) => (
            <Card key={entry.id}>
              <CardContent className="pt-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-3">
                      <span className="text-xl font-bold">{entry.symbol}</span>
                      <Badge variant={entry.type === "BUY" ? "default" : "destructive"}>
                        {entry.type}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        {format(parseISO(entry.date), "MMM d, yyyy")}
                      </span>
                      <span className="flex items-center gap-1">
                        <DollarSign className="h-3.5 w-3.5" />
                        {entry.quantity} @ ${entry.price.toFixed(2)}
                      </span>
                    </div>
                  </div>
                  {entry.tags && entry.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {entry.tags.map((tag, index) => (
                        <Badge key={index} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                {(entry.strategy || entry.notes) && (
                  <div className="mt-4 space-y-2">
                    {entry.strategy && (
                      <div className="flex items-start gap-2">
                        <FileText className="mt-0.5 h-4 w-4 text-primary" />
                        <div>
                          <div className="text-sm font-medium">Strategy</div>
                          <p className="text-sm text-muted-foreground">{entry.strategy}</p>
                        </div>
                      </div>
                    )}
                    {entry.notes && (
                      <div className="rounded-lg bg-muted/50 p-3">
                        <p className="text-sm">{entry.notes}</p>
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
