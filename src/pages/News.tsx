import { useState, useMemo } from "react";
import { Newspaper, ExternalLink, Zap, Database, RefreshCw, TrendingUp, Clock, ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRecentNews, useTradeEngineNews, useTradeEngineHealth } from "@/hooks/use-data";
import { format, parseISO } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toSafeExternalUrl } from "@/lib/url";
import { scoreNewsImportance } from "@/services/api";

type NewsSource = 'supabase' | 'trade-engine';
type SortOrder = 'latest' | 'important';

const PAGE_SIZE = 30;

function formatPublishedDate(date: string): string {
  const parsedDate = parseISO(date);
  if (Number.isNaN(parsedDate.getTime())) {
    return 'Unknown date';
  }
  return format(parsedDate, "MMM d, yyyy · h:mm a");
}

const News = () => {
  const [source, setSource] = useState<NewsSource>('supabase');
  const [sortOrder, setSortOrder] = useState<SortOrder>('latest');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Supabase: last 12 hours, up to 150 articles
  const { data: supabaseArticles = [], isLoading: supabaseLoading, error: supabaseError } = useRecentNews(12, 150);

  // Trade Engine news (live from backend)
  const { data: engineNewsData, isLoading: engineLoading, error: engineError, refetch: refetchEngine } = useTradeEngineNews(30);

  // Trade Engine health
  const { data: engineHealth } = useTradeEngineHealth();

  const isLoading = source === 'supabase' ? supabaseLoading : engineLoading;
  const error = source === 'supabase' ? supabaseError : engineError;

  // Normalize articles, apply sort order
  const allArticles = useMemo(() => {
    const normalized = source === 'supabase'
      ? supabaseArticles.map(a => ({
          id: a.id,
          title: a.title,
          summary: a.summary,
          provider: a.provider,
          safeLink: toSafeExternalUrl(a.link),
          published_at: a.published_at,
        }))
      : (engineNewsData?.items || []).map(a => ({
          id: String(a.id),
          title: a.headline,
          summary: a.summary || '',
          provider: a.source,
          safeLink: toSafeExternalUrl(a.url),
          published_at: a.published_at,
          ticker: a.ticker,
          sentiment: a.sentiment_score,
        }));

    if (sortOrder === 'important') {
      return [...normalized].sort(
        (a, b) => scoreNewsImportance(b) - scoreNewsImportance(a)
      );
    }
    return normalized; // already ordered by published_at desc from source
  }, [source, supabaseArticles, engineNewsData, sortOrder]);

  // Reset visible count whenever source or sort changes
  const articles = allArticles.slice(0, visibleCount);
  const hasMore = visibleCount < allArticles.length;

  const handleSourceChange = (next: NewsSource) => {
    setSource(next);
    setVisibleCount(PAGE_SIZE);
  };

  const handleSortChange = (next: SortOrder) => {
    setSortOrder(next);
    setVisibleCount(PAGE_SIZE);
  };

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

          {/* Sort + Source Toggles */}
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {/* Sort order toggle */}
            <div className="flex rounded-lg border border-border/50 p-1 bg-muted/30">
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 px-3 text-xs gap-1.5 rounded-md transition-all",
                  sortOrder === 'latest' && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                )}
                onClick={() => handleSortChange('latest')}
              >
                <Clock className="h-3 w-3" />
                Latest
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 px-3 text-xs gap-1.5 rounded-md transition-all",
                  sortOrder === 'important' && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                )}
                onClick={() => handleSortChange('important')}
              >
                <TrendingUp className="h-3 w-3" />
                Important
              </Button>
            </div>

            {/* Source Toggle */}
            <div className="flex rounded-lg border border-border/50 p-1 bg-muted/30">
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 px-3 text-xs gap-1.5 rounded-md transition-all",
                  source === 'supabase' && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                )}
                onClick={() => handleSourceChange('supabase')}
              >
                <Database className="h-3 w-3" />
                Supabase
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 px-3 text-xs gap-1.5 rounded-md transition-all",
                  source === 'trade-engine' && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                )}
                onClick={() => handleSourceChange('trade-engine')}
              >
                <Zap className="h-3 w-3" />
                Trade Engine
                {engineHealth?.healthy && (
                  <span className="h-1.5 w-1.5 rounded-full bg-profit animate-pulse" />
                )}
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
          {source === 'supabase' ? (
            <>
              <Database className="h-3 w-3" />
              <span>
                Showing news from the last 12 hours
                {!isLoading && allArticles.length > 0 && (
                  <span className="ml-1 text-muted-foreground/60">
                    · {allArticles.length} article{allArticles.length !== 1 ? 's' : ''}
                  </span>
                )}
              </span>
            </>
          ) : (
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
                  <Button variant="outline" size="sm" onClick={() => handleSourceChange('supabase')}>
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
              <p className="text-muted-foreground font-medium">No news in the last 12 hours</p>
              <p className="text-xs text-muted-foreground mt-2">
                {source === 'trade-engine'
                  ? "The Trade Engine hasn't collected any news yet. Make sure it's running."
                  : "No articles have been published in the last 12 hours."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {articles.map((article, index) => (
                <a
                  key={article.id}
                  href={article.safeLink ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open article: ${article.title}`}
                  aria-disabled={!article.safeLink}
                  className={cn("block", !article.safeLink && "pointer-events-none opacity-70")}
                  style={{ animationDelay: `${index * 30}ms` }}
                >
                  <Card className="group border-border/50 bg-card/50 backdrop-blur-sm hover:bg-card/80 hover:border-border transition-all cursor-pointer animate-in fade-in duration-300 h-full">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-sm font-semibold line-clamp-2 group-hover:text-primary transition-colors">
                          {article.title}
                        </CardTitle>
                        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 group-hover:text-primary transition-colors" />
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-xs text-muted-foreground line-clamp-3">
                        {article.summary}
                      </p>
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground/70 pt-2 border-t border-border/50">
                        <div className="flex items-center gap-2">
                          {article.provider && (
                            <span className="font-medium">{article.provider}</span>
                          )}
                          {'ticker' in article && article.ticker && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5">
                              {article.ticker}
                            </Badge>
                          )}
                        </div>
                        <span>{formatPublishedDate(article.published_at)}</span>
                      </div>
                    </CardContent>
                  </Card>
                </a>
              ))}
            </div>

            {/* Load more */}
            {hasMore && (
              <div className="flex justify-center pt-2 animate-in fade-in duration-300">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 text-xs"
                  onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                  Load more
                  <span className="text-muted-foreground">
                    ({allArticles.length - visibleCount} remaining)
                  </span>
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
};

export default News;
