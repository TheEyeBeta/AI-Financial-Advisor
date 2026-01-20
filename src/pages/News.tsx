import { Newspaper, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAllNews } from "@/hooks/use-data";
import { format, parseISO } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { AppLayout } from "@/components/layout/AppLayout";

const News = () => {
  const { data: articles = [], isLoading, error } = useAllNews();

  return (
    <AppLayout title="Latest News">
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Newspaper className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold">Latest News</h1>
            <p className="text-muted-foreground">Stay updated with the latest financial news</p>
          </div>
        </div>

        {error ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Newspaper className="h-12 w-12 mx-auto mb-4 text-destructive" />
              <p className="text-destructive font-medium">Error loading news articles</p>
              <p className="text-sm text-muted-foreground mt-2">
                {error instanceof Error ? error.message : 'Failed to fetch news articles. Please check if the news_articles table exists in your database.'}
              </p>
            </CardContent>
          </Card>
        ) : isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-5 w-3/4" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-4 w-full mb-2" />
                  <Skeleton className="h-4 w-full mb-2" />
                  <Skeleton className="h-4 w-2/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : articles.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Newspaper className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">No news articles available at the moment.</p>
              <p className="text-sm text-muted-foreground mt-2">
                News articles will appear here once they are added to the database.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {articles.map((article) => (
              <Card
                key={article.id}
                className="group hover:shadow-lg transition-shadow cursor-pointer"
              >
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-lg font-semibold line-clamp-2 group-hover:text-primary transition-colors">
                      {article.title}
                    </CardTitle>
                    <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground mt-1" />
                  </div>
                </CardHeader>
                <CardContent>
                  <a
                    href={article.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block space-y-3"
                  >
                    <p className="text-sm text-muted-foreground line-clamp-3">
                      {article.summary}
                    </p>
                    <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
                      {article.source && (
                        <span className="font-medium">{article.source}</span>
                      )}
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
