"""
Example Python script to insert financial news articles into Supabase
This can be run as a scheduled job (cron, task scheduler, etc.) to keep news updated

Requirements:
- supabase-py: pip install supabase
- Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables
"""

from supabase import create_client, Client
import os
from datetime import datetime
from typing import List, Dict

# Initialize Supabase client with service role key (for inserts)
# Use service role key, not anon key, to bypass RLS for inserts
supabase_url = os.getenv("SUPABASE_URL")
supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")  # Service role key, not anon key

if not supabase_url or not supabase_key:
    raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")

supabase: Client = create_client(supabase_url, supabase_key)


def insert_news_article(title: str, summary: str, link: str, source: str = None, published_at: str = None):
    """
    Insert a single news article into the database
    
    Args:
        title: Article title
        summary: Article summary
        link: Full URL to the article
        source: News source (optional)
        published_at: ISO format timestamp (optional, defaults to now)
    """
    article = {
        "title": title,
        "summary": summary,
        "link": link,
        "source": source,
        "published_at": published_at or datetime.utcnow().isoformat(),
    }
    
    try:
        result = supabase.table("news_articles").insert(article).execute()
        print(f"✓ Inserted: {title[:50]}...")
        return result.data[0] if result.data else None
    except Exception as e:
        print(f"✗ Error inserting article: {e}")
        return None


def insert_multiple_articles(articles: List[Dict]):
    """
    Insert multiple news articles at once
    
    Args:
        articles: List of article dictionaries with keys: title, summary, link, source (optional), published_at (optional)
    """
    try:
        result = supabase.table("news_articles").insert(articles).execute()
        print(f"✓ Inserted {len(articles)} articles")
        return result.data if result.data else []
    except Exception as e:
        print(f"✗ Error inserting articles: {e}")
        return []


def fetch_news_from_api():
    """
    Example: Fetch news from a financial news API
    Replace this with your actual news source (e.g., NewsAPI, Alpha Vantage, etc.)
    """
    # Example structure - replace with actual API call
    articles = [
        {
            "title": "Market Opens Higher on Strong Earnings Reports",
            "summary": "Major indices rise as tech companies report better-than-expected quarterly earnings, boosting investor confidence.",
            "link": "https://example.com/news/market-opens-higher",
            "source": "Financial Times",
            "published_at": datetime.utcnow().isoformat(),
        },
        {
            "title": "Fed Signals Potential Rate Cuts in Coming Months",
            "summary": "Federal Reserve officials hint at possible interest rate reductions as inflation shows signs of cooling.",
            "link": "https://example.com/news/fed-rate-cuts",
            "source": "Bloomberg",
            "published_at": datetime.utcnow().isoformat(),
        },
    ]
    return articles


# Example usage
if __name__ == "__main__":
    # Example 1: Insert a single article
    insert_news_article(
        title="Stock Market Reaches New High",
        summary="The S&P 500 closed at a record high today, driven by strong economic data and positive corporate earnings.",
        link="https://example.com/news/stock-market-high",
        source="Wall Street Journal"
    )
    
    # Example 2: Insert multiple articles from an API
    articles = fetch_news_from_api()
    if articles:
        insert_multiple_articles(articles)
    
    # Example 3: Clean up old articles (optional - keep only last 100)
    # Uncomment to enable automatic cleanup
    # supabase.table("news_articles").delete().lt("created_at", datetime.utcnow().isoformat()).limit(100).execute()
