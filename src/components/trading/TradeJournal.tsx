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

const journalEntries = [
  {
    id: 1,
    symbol: "NVDA",
    type: "BUY",
    date: "2024-01-20",
    quantity: 10,
    price: 875.00,
    strategy: "Momentum breakout on strong earnings",
    notes: "Breaking above key resistance at $870. AI demand continues to drive growth. Stop loss at $840.",
    tags: ["momentum", "earnings", "tech"],
  },
  {
    id: 2,
    symbol: "AAPL",
    type: "BUY",
    date: "2024-01-18",
    quantity: 25,
    price: 178.50,
    strategy: "Support bounce with positive divergence",
    notes: "Bouncing off 50-day MA. RSI showing bullish divergence. Target $190.",
    tags: ["technical", "support", "swing"],
  },
];

export function TradeJournal() {
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-6">
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
            <form className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="symbol">Symbol</Label>
                <Input id="symbol" placeholder="e.g., AAPL" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="type">Action</Label>
                <Select>
                  <SelectTrigger>
                    <SelectValue placeholder="Select action" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="buy">Buy</SelectItem>
                    <SelectItem value="sell">Sell</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="quantity">Quantity</Label>
                <Input id="quantity" type="number" placeholder="0" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="price">Price</Label>
                <Input id="price" type="number" step="0.01" placeholder="0.00" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="date">Date</Label>
                <Input id="date" type="date" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="tags">Tags (comma separated)</Label>
                <Input id="tags" placeholder="e.g., momentum, tech" />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="strategy">Strategy / Reasoning</Label>
                <Input id="strategy" placeholder="Why are you making this trade?" />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  placeholder="Additional notes, observations, risk management..."
                  rows={3}
                />
              </div>

              <div className="flex gap-2 md:col-span-2">
                <Button type="submit">Save Entry</Button>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

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
                      {entry.date}
                    </span>
                    <span className="flex items-center gap-1">
                      <DollarSign className="h-3.5 w-3.5" />
                      {entry.quantity} @ ${entry.price.toFixed(2)}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {entry.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="mt-4 space-y-2">
                <div className="flex items-start gap-2">
                  <FileText className="mt-0.5 h-4 w-4 text-primary" />
                  <div>
                    <div className="text-sm font-medium">Strategy</div>
                    <p className="text-sm text-muted-foreground">{entry.strategy}</p>
                  </div>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-sm">{entry.notes}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
