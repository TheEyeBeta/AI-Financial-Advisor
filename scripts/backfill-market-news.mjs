import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadDotEnv(path) {
  if (!fs.existsSync(path)) return;
  const text = fs.readFileSync(path, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function fetchAll(supabase, table, columns, pageSize = 1000) {
  const rows = [];
  let start = 0;
  while (true) {
    const end = start + pageSize - 1;
    const { data, error } = await supabase.schema("market").from(table).select(columns).range(start, end);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    start += pageSize;
  }
  return rows;
}

function decodeXml(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(text) {
  return decodeXml(text).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").trim();
}

function extractTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? stripTags(match[1]) : "";
}

async function fetchRssArticles(feedUrl, providerLabel, maxItems = 25) {
  const response = await fetch(feedUrl);
  if (!response.ok) {
    throw new Error(`Failed RSS fetch: ${feedUrl} (${response.status})`);
  }
  const xml = await response.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)]
    .slice(0, maxItems)
    .map((m) => m[1]);

  return items
    .map((item) => {
      const title = extractTag(item, "title");
      const link = extractTag(item, "link");
      const summary = extractTag(item, "description");
      const publishedAt = extractTag(item, "pubDate");
      if (!title || !link) return null;
      return {
        title: title || "Untitled",
        summary: summary || "",
        link,
        provider: providerLabel,
        published_at: publishedAt ? new Date(publishedAt).toISOString() : new Date().toISOString(),
      };
    })
    .filter(Boolean);
}

async function main() {
  loadDotEnv(".env");
  loadDotEnv("backend/websearch_service/.env");

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    console.error("Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const supabase = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const existingRows = await fetchAll(supabase, "news", "link", 1000);
  const existingLinks = new Set(existingRows.map((r) => r.link).filter(Boolean));
  let inserted = 0;
  let mode = "legacy";

  try {
    const legacyRows = await fetchAll(
      supabase,
      "news_articles",
      "title,summary,link,source,published_at,created_at,updated_at",
      500,
    );

    const missing = legacyRows.filter((r) => r.link && !existingLinks.has(r.link));
    for (let i = 0; i < missing.length; i += 200) {
      const chunk = missing.slice(i, i + 200);
      const now = new Date().toISOString();
      const payload = chunk.map((r) => ({
        title: (r.title || "").trim() || "Untitled",
        summary: r.summary || "",
        link: r.link,
        provider: r.source || null,
        published_at: r.published_at || now,
        created_at: r.created_at || now,
        updated_at: r.updated_at || now,
      }));
      if (payload.length) {
        const { error } = await supabase.schema("market").from("news").upsert(payload, { onConflict: "link" });
        if (error) throw error;
        inserted += payload.length;
      }
    }

    console.log(`mode=legacy legacy_total=${legacyRows.length} existing_news=${existingLinks.size} missing_loaded=${inserted}`);
    return;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "PGRST205") {
      mode = "rss";
    } else {
      throw error;
    }
  }

  const feeds = [
    { url: "https://feeds.reuters.com/reuters/businessNews", provider: "Reuters" },
    { url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EGSPC&region=US&lang=en-US", provider: "Yahoo Finance" },
  ];

  const rssArticles = [];
  for (const feed of feeds) {
    try {
      const items = await fetchRssArticles(feed.url, feed.provider, 30);
      rssArticles.push(...items);
    } catch {
      // Continue with any feed that still works.
    }
  }

  const deduped = [];
  const seen = new Set(existingLinks);
  for (const article of rssArticles) {
    if (!article?.link || seen.has(article.link)) continue;
    seen.add(article.link);
    deduped.push({
      ...article,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  for (let i = 0; i < deduped.length; i += 200) {
    const chunk = deduped.slice(i, i + 200);
    const { error } = await supabase.schema("market").from("news").upsert(chunk, { onConflict: "link" });
    if (error) throw error;
    inserted += chunk.length;
  }

  console.log(`mode=${mode} existing_news=${existingLinks.size} rss_candidates=${rssArticles.length} loaded=${inserted}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
