import { useMemo, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  ChevronDown,
  Clock,
  Database,
  Newspaper,
  TrendingUp,
} from "lucide-react";
import { format, formatDistanceToNowStrict, parseISO } from "date-fns";

import { AppLayout } from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecentNews } from "@/hooks/use-data";
import { toSafeExternalUrl } from "@/lib/url";
import { cn } from "@/lib/utils";
import { scoreNewsImportance } from "@/services/news-api";

type SortOrder = "latest" | "important";

type DisplayArticle = {
  id: string;
  title: string;
  summary: string;
  provider?: string | null;
  safeLink: string | null;
  published_at: string;
  ticker?: string;
  sentiment?: number;
  impactScore: number;
};

const PAGE_SIZE = 30;
const HIGH_IMPACT_THRESHOLD = 8;
const FRESH_WINDOW_HOURS = 6;

function formatMarketDate(date: string): string {
  const parsedDate = parseISO(date);
  if (Number.isNaN(parsedDate.getTime())) {
    return "Unknown date";
  }
  return format(parsedDate, "MMM d, yyyy 'at' h:mm a");
}

function formatRelativeAge(date: string): string {
  const parsedDate = parseISO(date);
  if (Number.isNaN(parsedDate.getTime())) {
    return "Unknown";
  }
  return formatDistanceToNowStrict(parsedDate, { addSuffix: true });
}

function getArticleAgeHours(date: string): number | null {
  const parsedDate = parseISO(date);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }
  return (Date.now() - parsedDate.getTime()) / 3_600_000;
}

function getImpactTone(score: number) {
  if (score >= 12) {
    return {
      label: "High impact",
      className: "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    };
  }

  if (score >= HIGH_IMPACT_THRESHOLD) {
    return {
      label: "Market moving",
      className: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    };
  }

  return {
    label: "On watch",
    className: "border-border/70 bg-muted/70 text-muted-foreground",
  };
}

function getSentimentTone(sentiment?: number) {
  if (typeof sentiment !== "number" || Number.isNaN(sentiment)) {
    return null;
  }

  if (sentiment >= 0.25) {
    return {
      label: "Bullish",
      className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    };
  }

  if (sentiment <= -0.25) {
    return {
      label: "Bearish",
      className: "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300",
    };
  }

  return {
    label: "Mixed",
    className: "border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  };
}

function toPlainText(value?: string | null): string {
  const input = value?.trim();
  if (!input) {
    return "";
  }

  const withoutTags = input
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|blockquote)>/gi, " ")
    .replace(/<[^>]*>/g, " ");

  if (typeof DOMParser === "undefined") {
    return withoutTags.replace(/\s+/g, " ").trim();
  }

  const doc = new DOMParser().parseFromString(withoutTags, "text/html");
  return (doc.documentElement.textContent || "").replace(/\s+/g, " ").trim();
}

const News = () => {
  const source = "supabase" as const;
  const [sortOrder, setSortOrder] = useState<SortOrder>("latest");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const { data: supabaseArticles = [], isLoading, error } = useRecentNews(24, 150);
  const engineHealth = null;

  const allArticles = useMemo<DisplayArticle[]>(() => {
    const normalized: DisplayArticle[] = supabaseArticles.map((article) => {
      const title = toPlainText(article.title) || "Untitled headline";
      const summary = toPlainText(article.summary);
      const provider = toPlainText(article.provider);
      const impactScore = scoreNewsImportance({
        title,
        summary,
        provider,
        published_at: article.published_at,
      });

      return {
        id: article.id,
        title,
        summary: summary || "No summary available for this headline yet.",
        provider,
        safeLink: toSafeExternalUrl(article.link),
        published_at: article.published_at || "",
        impactScore,
      };
    });

    if (sortOrder === "important") {
      return [...normalized].sort((a, b) => b.impactScore - a.impactScore);
    }

    return normalized;
  }, [sortOrder, supabaseArticles]);

  const visibleArticles = allArticles.slice(0, visibleCount);
  const leadArticle = visibleArticles[0];
  const spotlightArticles = visibleArticles.slice(1, 4);
  const streamArticles = visibleArticles.slice(4);
  const hasMore = visibleCount < allArticles.length;

  const highImpactCount = useMemo(
    () => allArticles.filter((article) => article.impactScore >= HIGH_IMPACT_THRESHOLD).length,
    [allArticles],
  );

  const freshCount = useMemo(
    () =>
      allArticles.filter((article) => {
        const ageHours = getArticleAgeHours(article.published_at);
        return ageHours !== null && ageHours <= FRESH_WINDOW_HOURS;
      }).length,
    [allArticles],
  );

  const providerLeader = useMemo(() => {
    const counts = new Map<string, number>();

    allArticles.forEach((article) => {
      const provider = article.provider?.trim() || "Mixed feed";
      counts.set(provider, (counts.get(provider) ?? 0) + 1);
    });

    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["Mixed feed", 0];
  }, [allArticles]);

  const handleSortChange = (next: SortOrder) => {
    setSortOrder(next);
    setVisibleCount(PAGE_SIZE);
  };

  const sourceTheme = {
    eyebrow: "Market News Desk",
    description: "Track the latest headlines and rank them by recency or market impact.",
    statusLabel: "Live",
    statusNote: "Live headlines update as new stories land in the feed.",
  };

  return (
    <AppLayout title="Latest News">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="relative overflow-hidden rounded-[30px] border border-slate-200/80 dark:border-slate-700/60 bg-[linear-gradient(135deg,#f8fbff_0%,#eef4ff_55%,#e8f1ff_100%)] dark:bg-[linear-gradient(135deg,#0f172a_0%,#1e293b_55%,#1e3a5f_100%)] text-slate-950 dark:text-slate-50 shadow-[0_30px_80px_-60px_rgba(37,99,235,0.28)] animate-in fade-in duration-300">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(191,219,254,0.5),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(147,197,253,0.35),transparent_28%)]" />
          <div className="absolute -left-12 top-6 h-52 w-52 rounded-full bg-white/60 dark:bg-slate-300/5 blur-3xl" />
          <div className="absolute -right-8 bottom-0 h-64 w-64 rounded-full bg-sky-200/50 dark:bg-sky-900/30 blur-3xl" />
          <div className="relative grid gap-7 p-6 sm:p-8 xl:grid-cols-[minmax(0,1.42fr)_22rem]">
            <div className="space-y-7">
              <div className="space-y-4">
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 dark:border-slate-700/60 bg-white/75 dark:bg-slate-800/75 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-slate-500 dark:text-slate-400 shadow-sm backdrop-blur-sm">
                  <Database className="h-3.5 w-3.5" />
                  {sourceTheme.eyebrow}
                </div>
                <div>
                  <h1 className="max-w-3xl text-[clamp(2.35rem,4.8vw,4.5rem)] font-semibold tracking-[-0.05em] text-slate-950 dark:text-slate-50">
                    Market-moving news, ranked by signal.
                  </h1>
                  <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 dark:text-slate-400 sm:text-base">
                    Scan the latest headlines, sort by freshness or impact, and focus on the stories most likely to
                    move markets.
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-[22px] border border-slate-200/80 dark:border-slate-700/60 bg-white/76 dark:bg-slate-800/60 p-5 shadow-[0_20px_36px_-34px_rgba(15,23,42,0.28)] backdrop-blur-sm">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">Stories loaded</p>
                  <p className="mt-3 text-3xl font-semibold text-slate-950 dark:text-slate-50">{allArticles.length}</p>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Latest stories in the feed</p>
                </div>
                <div className="rounded-[22px] border border-slate-200/80 dark:border-slate-700/60 bg-white/76 dark:bg-slate-800/60 p-5 shadow-[0_20px_36px_-34px_rgba(15,23,42,0.28)] backdrop-blur-sm">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">High impact</p>
                  <p className="mt-3 text-3xl font-semibold text-slate-950 dark:text-slate-50">{highImpactCount}</p>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Stories flagged by the scoring model</p>
                </div>
                <div className="rounded-[22px] border border-slate-200/80 dark:border-slate-700/60 bg-white/76 dark:bg-slate-800/60 p-5 shadow-[0_20px_36px_-34px_rgba(15,23,42,0.28)] backdrop-blur-sm">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">Fresh in 6h</p>
                  <p className="mt-3 text-3xl font-semibold text-slate-950 dark:text-slate-50">{freshCount}</p>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{providerLeader[0]} is leading the feed</p>
                </div>
              </div>
            </div>

            <div className="rounded-[26px] border border-slate-200/80 dark:border-slate-700/60 bg-white/76 dark:bg-slate-800/60 p-5 shadow-[0_22px_50px_-38px_rgba(37,99,235,0.22)] backdrop-blur-xl">
              <div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">Control deck</p>
                <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-300">{sourceTheme.description}</p>
              </div>

              <div className="mt-5 space-y-4">

                <div>
                  <p className="mb-2 text-[11px] uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">Sort mode</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleSortChange("latest")}
                      className={cn(
                        "flex items-center gap-2 rounded-[18px] border px-4 py-3 text-sm font-medium transition-colors",
                        sortOrder === "latest"
                          ? "border-primary/20 bg-primary/10 text-primary shadow-sm"
                          : "border-slate-200/80 dark:border-slate-700/60 bg-white/72 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/60 hover:text-slate-900 dark:hover:text-slate-100",
                      )}
                    >
                      <Clock className="h-4 w-4" />
                      Latest
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSortChange("important")}
                      className={cn(
                        "flex items-center gap-2 rounded-[18px] border px-4 py-3 text-sm font-medium transition-colors",
                        sortOrder === "important"
                          ? "border-primary/20 bg-primary/10 text-primary shadow-sm"
                          : "border-slate-200/80 dark:border-slate-700/60 bg-white/72 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/60 hover:text-slate-900 dark:hover:text-slate-100",
                      )}
                    >
                      <TrendingUp className="h-4 w-4" />
                      Important
                    </button>
                  </div>
                </div>

                <div className="rounded-[20px] border border-slate-200/80 dark:border-slate-700/60 bg-slate-50/85 dark:bg-slate-800/85 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                      <Activity className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                      Feed status
                    </span>
                    <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">{sourceTheme.statusLabel}</span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-400">{sourceTheme.statusNote}</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {error ? (
          <Card className="overflow-hidden rounded-[28px] border-border/60 bg-card/95 shadow-[0_24px_60px_-48px_rgba(15,23,42,0.7)] animate-in fade-in duration-300">
            <CardContent className="py-14 text-center">
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
                <Newspaper className="h-7 w-7 text-destructive" />
              </div>
              <h2 className="text-xl font-semibold text-foreground">Feed unavailable</h2>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                {error instanceof Error ? error.message : "Failed to fetch news articles."}
              </p>
            </CardContent>
          </Card>
        ) : isLoading ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,0.95fr)]">
            <Card className="rounded-[28px] border-border/60 bg-card/90">
              <CardContent className="space-y-5 p-6">
                <Skeleton className="h-6 w-36" />
                <Skeleton className="h-12 w-11/12" />
                <Skeleton className="h-12 w-9/12" />
                <Skeleton className="h-20 w-full" />
                <div className="grid gap-3 sm:grid-cols-3">
                  {[1, 2, 3].map((item) => (
                    <Skeleton key={item} className="h-20 rounded-2xl" />
                  ))}
                </div>
              </CardContent>
            </Card>
            <div className="grid gap-4">
              {[1, 2, 3].map((item) => (
                <Card key={item} className="rounded-[24px] border-border/60 bg-card/90">
                  <CardContent className="space-y-4 p-5">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-4 w-32" />
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ) : visibleArticles.length === 0 ? (
          <Card className="overflow-hidden rounded-[28px] border-border/60 bg-card/95 shadow-[0_24px_60px_-48px_rgba(15,23,42,0.7)] animate-in fade-in duration-300">
            <CardContent className="py-14 text-center">
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <Newspaper className="h-7 w-7 text-muted-foreground" />
              </div>
              <h2 className="text-xl font-semibold text-foreground">No headlines in scope</h2>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                No articles were published in the last 24 hours for the mirrored Supabase feed.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <section className={cn("grid items-start gap-4", spotlightArticles.length > 0 && "xl:grid-cols-[minmax(0,1.55fr)_minmax(0,0.95fr)]")}>
              {leadArticle && (
                <a
                  href={leadArticle.safeLink ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open article: ${leadArticle.title}`}
                  aria-disabled={!leadArticle.safeLink}
                  className={cn("group block self-start", !leadArticle.safeLink && "pointer-events-none opacity-75")}
                >
                  <article className="relative overflow-hidden rounded-[28px] border border-border/60 bg-card/95 p-6 shadow-[0_28px_80px_-52px_rgba(15,23,42,0.75)] transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-[0_32px_90px_-54px_rgba(30,64,175,0.28)] sm:p-7">
                    <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
                    <div className="absolute right-5 top-3 text-6xl font-semibold tracking-[-0.08em] text-foreground/[0.05] sm:text-7xl">
                      01
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pr-16">
                      <Badge variant="outline" className="border-primary/20 bg-primary/5 text-primary">
                        Lead story
                      </Badge>
                      <Badge variant="outline" className={getImpactTone(leadArticle.impactScore).className}>
                        {getImpactTone(leadArticle.impactScore).label}
                      </Badge>
                      <span className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                        {formatRelativeAge(leadArticle.published_at)}
                      </span>
                    </div>

                    <div className="mt-8 max-w-3xl">
                      <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
                        {leadArticle.provider || "Market wire"}
                      </p>
                      <h2 className="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl lg:text-[2.5rem] lg:leading-[1.05]">
                        {leadArticle.title}
                      </h2>
                      <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
                        {leadArticle.summary}
                      </p>
                    </div>

                    <div className="mt-8 flex flex-col gap-4 border-t border-border/60 pt-4 sm:flex-row sm:items-end sm:justify-between">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {leadArticle.ticker && (
                          <Badge variant="outline" className="border-border/70 bg-muted/70 text-foreground">
                            {leadArticle.ticker}
                          </Badge>
                        )}
                        {(() => {
                          const sentimentTone = getSentimentTone(leadArticle.sentiment);
                          if (!sentimentTone) {
                            return null;
                          }

                          return (
                            <Badge variant="outline" className={sentimentTone.className}>
                              {sentimentTone.label}
                            </Badge>
                          );
                        })()}
                        <span>{formatMarketDate(leadArticle.published_at)}</span>
                      </div>
                      <span className="inline-flex items-center gap-2 text-sm font-medium text-foreground transition-colors group-hover:text-primary">
                        Open coverage
                        <ArrowUpRight className="h-4 w-4" />
                      </span>
                    </div>
                  </article>
                </a>
              )}

              {spotlightArticles.length > 0 && (
                <div className="grid content-start gap-4">
                  {spotlightArticles.map((article, index) => {
                    const impactTone = getImpactTone(article.impactScore);

                    return (
                      <a
                        key={article.id}
                        href={article.safeLink ?? undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open article: ${article.title}`}
                        aria-disabled={!article.safeLink}
                        className={cn("group block", !article.safeLink && "pointer-events-none opacity-75")}
                      >
                        <article className="h-full rounded-[24px] border border-border/60 bg-card/92 p-5 shadow-[0_24px_60px_-52px_rgba(15,23,42,0.7)] transition-all duration-300 hover:-translate-y-1 hover:border-primary/35 hover:bg-card">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
                              Desk {String(index + 2).padStart(2, "0")}
                            </span>
                            <Badge variant="outline" className={impactTone.className}>
                              {impactTone.label}
                            </Badge>
                          </div>

                          <h3 className="mt-4 text-lg font-semibold tracking-tight text-foreground transition-colors group-hover:text-primary">
                            {article.title}
                          </h3>
                          <p className="mt-3 line-clamp-3 text-sm leading-6 text-muted-foreground">
                            {article.summary}
                          </p>

                          <div className="mt-5 flex items-center justify-between gap-3 border-t border-border/60 pt-4 text-xs text-muted-foreground">
                            <span className="truncate">{article.provider || "Market wire"}</span>
                            <span className="shrink-0">{formatRelativeAge(article.published_at)}</span>
                          </div>
                        </article>
                      </a>
                    );
                  })}
                </div>
              )}
            </section>

            {streamArticles.length > 0 && (
              <section className="space-y-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.32em] text-primary">Wire stream</p>
                    <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
                      More headlines with signal attached
                    </h2>
                  </div>
                  <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                    Provider, recency, impact, and ticker context are surfaced immediately so the rest of the feed stays readable.
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {streamArticles.map((article, index) => {
                    const impactTone = getImpactTone(article.impactScore);
                    const sentimentTone = getSentimentTone(article.sentiment);
                    const wideCard = index % 5 === 0;

                    return (
                      <a
                        key={article.id}
                        href={article.safeLink ?? undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Open article: ${article.title}`}
                        aria-disabled={!article.safeLink}
                        className={cn("group block", wideCard && "xl:col-span-2", !article.safeLink && "pointer-events-none opacity-75")}
                        style={{ animationDelay: `${index * 35}ms` }}
                      >
                        <article className="relative h-full overflow-hidden rounded-[24px] border border-border/60 bg-card/92 p-5 shadow-[0_22px_60px_-54px_rgba(15,23,42,0.6)] transition-all duration-300 hover:-translate-y-1 hover:border-primary/35 hover:bg-card animate-in fade-in slide-in-from-bottom-2">
                          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/35 to-transparent" />
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[11px] uppercase tracking-[0.26em] text-muted-foreground">
                              #{String(index + 5).padStart(2, "0")}
                            </span>
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              <Badge variant="outline" className={impactTone.className}>
                                {impactTone.label}
                              </Badge>
                              {sentimentTone && (
                                <Badge variant="outline" className={sentimentTone.className}>
                                  {sentimentTone.label}
                                </Badge>
                              )}
                            </div>
                          </div>

                          <h3 className={cn("mt-4 font-semibold tracking-tight text-foreground transition-colors group-hover:text-primary", wideCard ? "text-xl sm:text-2xl" : "text-lg")}>
                            {article.title}
                          </h3>
                          <p className={cn("mt-3 text-sm leading-6 text-muted-foreground", wideCard ? "line-clamp-4" : "line-clamp-3")}>
                            {article.summary}
                          </p>

                          <div className="mt-5 flex flex-wrap items-center gap-2">
                            {article.provider && (
                              <Badge variant="outline" className="border-border/70 bg-muted/60 text-foreground">
                                {article.provider}
                              </Badge>
                            )}
                            {article.ticker && (
                              <Badge variant="outline" className="border-border/70 bg-muted/60 text-foreground">
                                {article.ticker}
                              </Badge>
                            )}
                          </div>

                          <div className="mt-5 flex items-center justify-between gap-3 border-t border-border/60 pt-4 text-xs text-muted-foreground">
                            <span className="truncate">{formatMarketDate(article.published_at)}</span>
                            <span className="inline-flex shrink-0 items-center gap-1.5 font-medium text-foreground transition-colors group-hover:text-primary">
                              Read
                              <ArrowUpRight className="h-3.5 w-3.5" />
                            </span>
                          </div>
                        </article>
                      </a>
                    );
                  })}
                </div>
              </section>
            )}

            {hasMore && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  size="lg"
                  className="h-11 rounded-full border-border/70 px-5 text-sm shadow-sm"
                  onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
                >
                  <ChevronDown className="h-4 w-4" />
                  Load more
                  <span className="text-muted-foreground">({allArticles.length - visibleCount} remaining)</span>
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
