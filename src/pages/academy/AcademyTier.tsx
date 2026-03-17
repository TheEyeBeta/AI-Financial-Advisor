import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Clock,
  CheckCircle,
  BookOpen,
  PlayCircle,
  ChevronRight,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  academyApi,
  TIER_IDS,
  type Tier,
  type Lesson,
  type UserLessonProgress,
} from "@/services/academy-api";

type LessonStatus = 'not_started' | 'in_progress' | 'completed';

const STATUS_CONFIG: Record<
  LessonStatus,
  { label: string; className: string; icon: React.FC<{ className?: string }> }
> = {
  not_started: {
    label: "Not Started",
    className: "bg-muted/50 text-muted-foreground border-border/50",
    icon: BookOpen,
  },
  in_progress: {
    label: "In Progress",
    className: "bg-primary/10 text-primary border-primary/20",
    icon: PlayCircle,
  },
  completed: {
    label: "Completed",
    className: "bg-success/10 text-success border-success/20",
    icon: CheckCircle,
  },
};

export default function AcademyTier() {
  const { tier: tierSlug } = useParams<{ tier: string }>();
  const { authUserId } = useAuth();
  const navigate = useNavigate();

  const [tier, setTier] = useState<Tier | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [progress, setProgress] = useState<UserLessonProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!authUserId || !tierSlug) return;
    try {
      setLoading(true);
      setError(null);

      const tiers = await academyApi.getTiers();
      const foundTier = tiers.find((t) => t.slug === tierSlug);

      if (!foundTier) {
        navigate("/academy");
        return;
      }

      // Check enrollment (Beginner is always accessible)
      if (foundTier.id !== TIER_IDS.BEGINNER) {
        const enrollments = await academyApi.getTierEnrollments(authUserId);
        const isEnrolled = enrollments.some((e) => e.tier_id === foundTier.id);
        if (!isEnrolled) {
          navigate("/academy");
          return;
        }
      }

      const [lessonsData, progressData] = await Promise.all([
        academyApi.getLessonsByTier(foundTier.id),
        academyApi.getUserLessonProgress(authUserId),
      ]);

      setTier(foundTier);
      setLessons(lessonsData);
      setProgress(progressData);
    } catch (err) {
      console.error("Error loading tier:", err);
      setError("Failed to load lessons. Please try again.");
      toast({ title: "Error", description: "Failed to load lessons.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [authUserId, tierSlug, navigate]);

  useEffect(() => {
    if (!authUserId || !tierSlug) return;
    loadData();
  }, [authUserId, tierSlug, loadData]);

  const progressMap = new Map(progress.map((p) => [p.lesson_id, p]));

  function getLessonStatus(lessonId: string): LessonStatus {
    return (progressMap.get(lessonId)?.status as LessonStatus) || 'not_started';
  }

  function getBestScore(lessonId: string): number | null {
    return progressMap.get(lessonId)?.best_quiz_score ?? null;
  }

  if (loading) {
    return (
      <AppLayout title="Academy">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="h-8 w-48 bg-muted/50 rounded animate-pulse" />
          <div className="grid gap-4 sm:grid-cols-2">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-36 bg-muted/30 rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      </AppLayout>
    );
  }

  if (error || !tier) {
    return (
      <AppLayout title="Academy">
        <div className="max-w-4xl mx-auto">
          <Card className="border-border/50 bg-card/50">
            <CardContent className="py-16 text-center">
              <BookOpen className="h-12 w-12 mx-auto mb-4 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground">{error || "Tier not found."}</p>
              <Button className="mt-4" onClick={() => navigate("/academy")}>
                Back to Academy
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  const completedCount = lessons.filter((l) => getLessonStatus(l.id) === 'completed').length;

  return (
    <AppLayout title={tier.name}>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="animate-in fade-in duration-300">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 -ml-1 mb-3 text-muted-foreground hover:text-foreground"
            onClick={() => navigate("/academy")}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Academy
          </Button>
          <h1 className="text-2xl font-semibold text-foreground">{tier.name}</h1>
          <p className="text-sm text-muted-foreground/70 mt-1">{tier.description}</p>
          <p className="text-xs text-muted-foreground/50 mt-2">
            {completedCount} / {lessons.length} lessons completed
          </p>
        </div>

        {/* Empty state */}
        {lessons.length === 0 && (
          <Card className="border-border/50 bg-card/50">
            <CardContent className="py-16 text-center">
              <BookOpen className="h-12 w-12 mx-auto mb-4 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground">
                No lessons available yet for this tier.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Lesson Grid */}
        {lessons.length > 0 && (
          <div
            className="grid gap-4 sm:grid-cols-2 animate-in fade-in duration-300"
            style={{ animationDelay: '50ms' }}
          >
            {lessons.map((lesson, index) => {
              const status = getLessonStatus(lesson.id);
              const bestScore = getBestScore(lesson.id);
              const statusCfg = STATUS_CONFIG[status];
              const StatusIcon = statusCfg.icon;

              return (
                <Card
                  key={lesson.id}
                  role="button"
                  tabIndex={0}
                  className={cn(
                    "border border-border/50 bg-card/50 backdrop-blur-sm cursor-pointer transition-all duration-200 hover:border-border hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    status === 'completed' && "border-success/20 bg-success/5",
                  )}
                  onClick={() => navigate(`/academy/lesson/${lesson.slug}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(`/academy/lesson/${lesson.slug}`);
                    }
                  }}
                >
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-muted-foreground/40 min-w-[24px]">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <Badge
                          variant="outline"
                          className={cn("text-xs gap-1", statusCfg.className)}
                        >
                          <StatusIcon className="h-3 w-3" />
                          {statusCfg.label}
                        </Badge>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground/40 flex-shrink-0" />
                    </div>

                    <h3
                      className={cn(
                        "text-sm font-semibold mb-2",
                        status === 'completed' && "text-success",
                      )}
                    >
                      {lesson.title}
                    </h3>

                    <p className="text-xs text-muted-foreground/60 line-clamp-2 mb-3">
                      {lesson.short_summary}
                    </p>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground/50">
                        <Clock className="h-3 w-3" />
                        <span>{lesson.estimated_minutes} min</span>
                      </div>
                      {status === 'completed' && bestScore !== null && (
                        <span className="text-xs font-medium text-success">
                          Best: {Math.round(bestScore)}%
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
