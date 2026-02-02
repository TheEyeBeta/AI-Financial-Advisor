import { useState } from "react";
import { Newspaper, ExternalLink, Zap, Database, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAllNews, useTradeEngineNews, useTradeEngineHealth } from "@/hooks/use-data";
import { format, parseISO } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type NewsSource = 'supabase' | 'trade-engine';

const News = () => {
  const [source, setSource] = useState<NewsSource>('trade-engine');
  
  // Supabase news
  const { data: supabaseArticles = [], isLoading: supabaseLoading, error: supabaseError } = useAllNews();
  
  // Trade Engine news (live from backend)
  const { data: engineNewsData, isLoading: engineLoading, error: engineError, refetch: refetchEngine } = useTradeEngineNews(30);
  
  // Trade Engine health
  const { data: engineHealth } = useTradeEngineHealth();
  
  const isLoading = source === 'supabase' ? supabaseLoading : engineLoading;
  const error = source === 'supabase' ? supabaseError : engineError;
  
  // Normalize articles to common format
  const articles = source === 'supabase' 
    ? supabaseArticles.map(a => ({
        id: a.id,
        title: a.title,
        summary: a.summary,
        source: a.source,
        link: a.link,
        published_at: a.published_at,
      }))
    : (engineNewsData?.items || []).map(a => ({
        id: String(a.id),
        title: a.headline,
        summary: a.summary || '',
        source: a.source,
        link: a.url,
        published_at: a.published_at,
        ticker: a.ticker,
        sentiment: a.sentiment_score,
      }));

  return (
    <AppLayout title="Latest News">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-in fade-in duration-300">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Newspaper className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">Latest News</h1>
              <p className="text-sm text-muted-foreground">Stay updated with financial markets</p>
            </div>
          </div>
          
          {/* Source Toggle */}
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-border/50 p-1 bg-muted/30">
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 px-3 text-xs gap-1.5 rounded-md transition-all",
                  source === 'trade-engine' && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                )}
                onClick={() => setSource('trade-engine')}
              >
                <Zap className="h-3 w-3" />
                Trade Engine
                {engineHealth?.healthy && (
                  <span className="h-1.5 w-1.5 rounded-full bg-profit animate-pulse" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 px-3 text-xs gap-1.5 rounded-md transition-all",
                  source === 'supabase' && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                )}
                onClick={() => setSource('supabase')}
              >
                <Database className="h-3 w-3" />
                Supabase
              </Button>
            </div>
            {source === 'trade-engine' && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2"
                onClick={() => refetchEngine()}
                disabled={engineLoading}
              >
                <RefreshCw className={cn("h-3 w-3", engineLoading && "animate-spin")} />
              </Button>
            )}
          </div>
        </div>

        {/* Source indicator */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground animate-in fade-in duration-300">
          {source === 'trade-engine' ? (
            <>
              <Zap className="h-3 w-3 text-primary" />
              <span>
                Showing live news from The Eye Trade Engine
                {engineHealth?.healthy ? (
                  <Badge variant="outline" className="ml-2 text-[9px] px-1.5 py-0 h-4 border-profit/30 text-profit">
                    CONNECTED
                  </Badge>
                ) : (
                  <Badge variant="outline" className="ml-2 text-[9px] px-1.5 py-0 h-4 border-destructive/30 text-destructive">
                    OFFLINE
                  </Badge>
                )}
              </span>
            </>
          ) : (
            <>
              <Database className="h-3 w-3" />
              <span>Showing cached news from Supabase database</span>
            </>
          )}
        </div>

        {error ? (
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm animate-in fade-in duration-300">
            <CardContent className="py-12 text-center">
              <div className="p-3 rounded-full bg-destructive/10 mx-auto mb-4 w-fit">
                <Newspaper className="h-8 w-8 text-destructive" />
              </div>
              <p className="text-destructive font-medium">Error loading news</p>
              <p className="text-xs text-muted-foreground mt-2 max-w-sm mx-auto">
                {error instanceof Error ? error.message : 'Failed to fetch news articles.'}
              </p>
              {source === 'trade-engine' && (
                <div className="mt-4 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Make sure the Trade Engine is running at {import.meta.env.VITE_PYTHON_API_URL || 'http://localhost:8000'}
                  </p>
                  <Button variant="outline" size="sm" onClick={() => setSource('supabase')}>
                    Try Supabase instead
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ) : isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Card key={i} className="border-border/50 bg-card/50">
                <CardHeader className="pb-3">
                  <Skeleton className="h-4 w-3/4" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-3 w-full mb-2" />
                  <Skeleton className="h-3 w-full mb-2" />
                  <Skeleton className="h-3 w-2/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : articles.length === 0 ? (
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm animate-in fade-in duration-300">
            <CardContent className="py-12 text-center">
              <div className="p-3 rounded-full bg-muted mx-auto mb-4 w-fit">
                <Newspaper className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground font-medium">No news available</p>
              <p className="text-xs text-muted-foreground mt-2">
                {source === 'trade-engine' 
                  ? "The Trade Engine hasn't collected any news yet. Make sure it's running."
                  : "News articles will appear here once available."
                }
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {articles.map((article, index) => (
              <Card
                key={article.id}
                className="group border-border/50 bg-card/50 backdrop-blur-sm hover:bg-card/80 hover:border-border transition-all cursor-pointer animate-in fade-in duration-300"
                style={{ animationDelay: `${index * 30}ms` }}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm font-semibold line-clamp-2 group-hover:text-primary transition-colors">
                      {article.title}
                    </CardTitle>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 group-hover:text-primary transition-colors" />
                  </div>
                </CardHeader>
                <CardContent>
                  <a
                    href={article.link || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block space-y-3"
                  >
                    <p className="text-xs text-muted-foreground line-clamp-3">
                      {article.summary}
                    </p>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground/70 pt-2 border-t border-border/50">
                      <div className="flex items-center gap-2">
                        {article.source && (
                          <span className="font-medium">{article.source}</span>
                        )}
                        {'ticker' in article && article.ticker && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5">
                            {article.ticker}
                          </Badge>
                        )}
                      </div>
                      <span>
                        {format(parseISO(article.published_at), "MMM d, yyyy")}
                      </span>
                    </div>
                  </a>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default News;
