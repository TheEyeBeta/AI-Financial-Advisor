import { supabase } from "@/lib/supabase";
import type { NewsArticle } from "@/types/database";

/**
 * Test whether `keyword` appears in `text` as a whole word (word-boundary match).
 * Multi-word phrases are matched literally; special regex chars in the keyword are escaped.
 */
function matchesWord(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

/**
 * Score a news article by financial importance.
 * Higher score = more market-moving / significant.
 * Works with NewsArticle or any object with title/summary/provider/published_at.
 */
export function scoreNewsImportance(article: {
  title: string;
  summary?: string | null;
  provider?: string | null;
  published_at?: string | null;
}): number {
  let score = 0;
  const text = `${article.title} ${article.summary ?? ""}`.toLowerCase();

  const macroKeywords = [
    "fed",
    "federal reserve",
    "fomc",
    "interest rate",
    "rate hike",
    "rate cut",
    "inflation",
    "recession",
    "gdp",
    "jobs report",
    "nonfarm",
    "cpi",
    "pce",
    "tariff",
    "sanctions",
    "debt ceiling",
  ];

  const crisisKeywords = [
    "crash",
    "collapse",
    "bankruptcy",
    "default",
    "crisis",
    "war",
    "conflict",
    "earnings beat",
    "earnings miss",
    "earnings surprise",
    "profit warning",
  ];

  const eventKeywords = [
    "earnings",
    "revenue",
    "merger",
    "acquisition",
    "ipo",
    "sec",
    "doj",
    "investigation",
    "lawsuit",
    "layoffs",
    "guidance",
    "upgrade",
    "downgrade",
    "s&p 500",
    "nasdaq",
    "dow jones",
    "wall street",
  ];

  const generalKeywords = [
    "stock",
    "shares",
    "market",
    "analyst",
    "rally",
    "surge",
    "plunge",
    "drop",
    "rise",
    "fall",
    "dividend",
    "buyback",
  ];

  macroKeywords.forEach((keyword) => {
    if (matchesWord(text, keyword)) score += 4;
  });
  crisisKeywords.forEach((keyword) => {
    if (matchesWord(text, keyword)) score += 3;
  });
  eventKeywords.forEach((keyword) => {
    if (matchesWord(text, keyword)) score += 2;
  });
  generalKeywords.forEach((keyword) => {
    if (matchesWord(text, keyword)) score += 1;
  });

  const provider = (article.provider ?? "").toLowerCase();
  if (
    ["reuters", "bloomberg", "wall street journal", "wsj", "financial times", "ft.com"].some((source) =>
      provider.includes(source),
    )
  ) {
    score += 3;
  } else if (
    ["cnbc", "marketwatch", "barron's", "barrons", "seeking alpha"].some((source) => provider.includes(source))
  ) {
    score += 2;
  } else {
    score += 1;
  }

  if (article.published_at) {
    const ageHours = (Date.now() - new Date(article.published_at).getTime()) / 3_600_000;
    if (ageHours <= 6) score += 2;
    else if (ageHours <= 24) score += 1;
  }

  return score;
}

export const newsApi = {
  async getLatest(limit: number = 5): Promise<NewsArticle[]> {
    const { data, error } = await supabase
      .schema("market")
      .from("news")
      .select("*")
      .order("published_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  },

  async getAll(): Promise<NewsArticle[]> {
    const { data, error } = await supabase
      .schema("market")
      .from("news")
      .select("*")
      .order("published_at", { ascending: false });

    if (error) throw error;
    return data || [];
  },

  async getRecent(hours: number = 12, limit: number = 150): Promise<NewsArticle[]> {
    const since = new Date(Date.now() - hours * 3_600_000).toISOString();

    const { data, error } = await supabase
      .schema("market")
      .from("news")
      .select("*")
      .gte("published_at", since)
      .order("published_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  },
};
