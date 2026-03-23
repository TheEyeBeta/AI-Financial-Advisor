import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock,
  PlayCircle,
  Sparkles,
  Target,
  type LucideIcon,
} from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  academyApi,
  TIER_IDS,
  type Lesson,
  type Tier,
  type UserLessonProgress,
} from "@/services/academy-api";
import { getJourneyMeta } from "./journey-theme";

type LessonStatus = "not_started" | "in_progress" | "completed";

const STATUS_CONFIG: Record<
  LessonStatus,
  {
    label: string;
    className: string;
    cardClass: string;
    icon: LucideIcon;
    helper: string;
  }
> = {
  not_started: {
    label: "Not started",
    className: "border-border/60 bg-background/70 text-muted-foreground",
    cardClass: "border-border/60 bg-card/95",
    icon: BookOpen,
    helper: "Ready when you are.",
  },
  in_progress: {
    label: "In progress",
    className: "border-primary/20 bg-primary/10 text-primary",
    cardClass: "border-primary/20 bg-primary/5",
    icon: PlayCircle,
    helper: "You already have momentum here.",
  },
  completed: {
    label: "Completed",
    className: "border-success/20 bg-success/10 text-success",
    cardClass: "border-success/20 bg-success/5",
    icon: CheckCircle2,
    helper: "Finished and ready to revisit.",
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
      const foundTier = tiers.find((entry) => entry.slug === tierSlug);

      if (!foundTier) {
        navigate("/academy");
        return;
      }

      if (foundTier.id !== TIER_IDS.BEGINNER) {
        const enrollments = await academyApi.getTierEnrollments(authUserId);
        const isEnrolled = enrollments.some((entry) => entry.tier_id === foundTier.id);

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
      setLessons(lessonsData.sort((a, b) => a.order_index - b.order_index));
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

  const progressMap = new Map(progress.map((entry) => [entry.lesson_id, entry]));

  function getLessonStatus(lessonId: string): LessonStatus {
    return (progressMap.get(lessonId)?.status as LessonStatus) || "not_started";
  }

  function getBestScore(lessonId: string): number | null {
    return progressMap.get(lessonId)?.best_quiz_score ?? null;
  }

  if (loading) {
    return (
      <AppLayout title="Academy">
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="h-72 animate-pulse rounded-[2rem] bg-muted/30" />
          <div className="grid gap-4 lg:grid-cols-2">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="h-56 animate-pulse rounded-[1.75rem] bg-muted/30" />
            ))}
          </div>
        </div>
      </AppLayout>
    );
  }

  if (error || !tier) {
    return (
      <AppLayout title="Academy">
        <div className="mx-auto max-w-4xl">
          <Card className="border-border/50 bg-card/50">
            <CardContent className="py-16 text-center">
              <BookOpen className="mx-auto mb-4 h-12 w-12 text-muted-foreground/20" />
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

  const chapterMeta = getJourneyMeta(tier.id);
  const ChapterIcon = chapterMeta.icon;
  const completedCount = lessons.filter((lesson) => getLessonStatus(lesson.id) === "completed").length;
  const inProgressCount = lessons.filter((lesson) => getLessonStatus(lesson.id) === "in_progress").length;
  const totalMinutes = lessons.reduce((total, lesson) => total + lesson.estimated_minutes, 0);
  const progressPct = lessons.length > 0 ? Math.round((completedCount / lessons.length) * 100) : 0;
  const nextLesson = lessons.find((lesson) => getLessonStatus(lesson.id) !== "completed") ?? null;

  return (
    <AppLayout title={tier.name}>
      <div className="mx-auto max-w-6xl space-y-6 pb-6">
        <section className="relative overflow-hidden rounded-[2rem] border border-border/60 bg-card px-6 py-7 sm:px-8 sm:py-8 animate-in fade-in duration-500">
          <div className="absolute -left-10 top-0 h-44 w-44 rounded-full bg-primary/10 blur-3xl" />
          <div className="absolute right-0 top-8 h-40 w-40 rounded-full bg-success/10 blur-3xl" />
          <div className="absolute inset-0 bg-[linear-gradient(135deg,transparent_0%,hsl(var(--background)/0.5)_100%)]" />

          <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_320px]">
            <div>
              <Button
                variant="ghost"
                size="sm"
                className="-ml-1 mb-4 gap-1.5 text-muted-foreground hover:text-foreground"
                onClick={() => navigate("/academy")}
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Academy
              </Button>

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={cn("text-xs", chapterMeta.badgeClass)}>
                  {chapterMeta.chapter}
                </Badge>
                <Badge variant="outline" className="border-border/70 bg-background/70 text-foreground">
                  {completedCount} of {lessons.length} lessons complete
                </Badge>
              </div>

              <div className="mt-5 flex items-start gap-4">
                <div
                  className={cn(
                    "flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border shadow-sm",
                    chapterMeta.iconClass,
                  )}
                >
                  <ChapterIcon className="h-5 w-5" />
                </div>

                <div className="space-y-2">
                  <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                    {tier.name}
                  </h1>
                  <p className="text-base font-medium text-foreground/85">{chapterMeta.hook}</p>
                  <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                    {tier.description || chapterMeta.summary}
                  </p>
                </div>
              </div>

              <div className="mt-6 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Chapter progress</span>
                  <span className="font-medium text-foreground">{progressPct}%</span>
                </div>
                <Progress value={progressPct} className="h-2.5" />
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <Button
                  className={cn("gap-2 rounded-full px-5", chapterMeta.buttonClass)}
                  onClick={() => {
                    if (nextLesson) {
                      navigate(`/academy/lesson/${nextLesson.slug}`);
                    }
                  }}
                  disabled={!nextLesson}
                >
                  {nextLesson ? "Continue this chapter" : "Chapter complete"}
                  <ArrowRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  className="rounded-full border-border/70 bg-background/70"
                  onClick={() => {
                    document.getElementById("academy-lesson-path")?.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    });
                  }}
                >
                  View lesson path
                </Button>
              </div>
            </div>

            <Card className="border-border/60 bg-background/80 shadow-none backdrop-blur">
              <div className="p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Chapter Pulse</p>
                <h2 className="mt-2 text-lg font-semibold text-foreground">
                  {nextLesson ? "Next recommended lesson" : "You cleared this chapter"}
                </h2>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-border/60 bg-card/90 p-4">
                    <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Lessons</p>
                    <p className="mt-2 text-2xl font-semibold text-foreground">{lessons.length}</p>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-card/90 p-4">
                    <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Minutes</p>
                    <p className="mt-2 text-2xl font-semibold text-foreground">{totalMinutes}</p>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-card/90 p-4">
                    <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Completed</p>
                    <p className="mt-2 text-2xl font-semibold text-foreground">{completedCount}</p>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-card/90 p-4">
                    <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Active</p>
                    <p className="mt-2 text-2xl font-semibold text-foreground">{inProgressCount}</p>
                  </div>
                </div>

                {nextLesson ? (
                  <div className="mt-5 rounded-2xl border border-border/60 bg-card/90 p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
                        <Target className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{nextLesson.title}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{nextLesson.short_summary}</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-5 rounded-2xl border border-success/20 bg-success/5 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <CheckCircle2 className="h-4 w-4 text-success" />
                      Every lesson here is completed
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Revisit lessons any time or return to the Academy map for the next chapter.
                    </p>
                  </div>
                )}
              </div>
            </Card>
          </div>
        </section>

        {lessons.length === 0 ? (
          <Card className="rounded-[1.75rem] border-border/60 bg-card/90 shadow-sm">
            <CardContent className="py-16 text-center">
              <BookOpen className="mx-auto mb-4 h-12 w-12 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground">No lessons available yet for this chapter.</p>
            </CardContent>
          </Card>
        ) : (
          <section
            id="academy-lesson-path"
            className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] animate-in fade-in duration-500"
            style={{ animationDelay: "75ms" }}
          >
            <div className="space-y-4">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Lesson Path</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
                  Move through this chapter lesson by lesson.
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  Each lesson builds on the last, so the path reads more like a guided run-through than a loose list.
                </p>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
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
                        "relative overflow-hidden rounded-[1.75rem] border shadow-sm transition-colors duration-200 hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                        statusCfg.cardClass,
                      )}
                      onClick={() => navigate(`/academy/lesson/${lesson.slug}`)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          navigate(`/academy/lesson/${lesson.slug}`);
                        }
                      }}
                    >
                      <div
                        className={cn(
                          "h-1 w-full bg-gradient-to-r",
                          status === "completed"
                            ? "from-success via-success/60 to-transparent"
                            : status === "in_progress"
                              ? "from-primary via-primary/60 to-transparent"
                              : chapterMeta.ribbonClass,
                        )}
                      />

                      <CardContent className="p-5">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex min-w-0 items-start gap-3">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-border/60 bg-background/80 text-sm font-semibold text-foreground">
                              {String(index + 1).padStart(2, "0")}
                            </div>

                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline" className={cn("gap-1 text-xs", statusCfg.className)}>
                                  <StatusIcon className="h-3 w-3" />
                                  {statusCfg.label}
                                </Badge>
                                <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                                  {lesson.estimated_minutes} min
                                </span>
                              </div>

                              <h3 className="mt-3 text-lg font-semibold text-foreground">{lesson.title}</h3>
                              <p className="mt-1 text-sm text-foreground/70">{statusCfg.helper}</p>
                            </div>
                          </div>

                          <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/50" />
                        </div>

                        <p className="mt-4 text-sm leading-6 text-muted-foreground">{lesson.short_summary}</p>

                        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border/50 pt-4">
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Clock className="h-4 w-4" />
                            <span>{lesson.estimated_minutes} minute lesson</span>
                          </div>

                          <div className="text-sm font-medium text-foreground">
                            {bestScore !== null ? `Best quiz: ${Math.round(bestScore)}%` : "Open lesson"}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>

            <div className="space-y-4">
              <Card className="rounded-[1.75rem] border-border/60 bg-card/90 shadow-sm">
                <div className="p-5">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Chapter Rhythm</p>
                  <h3 className="mt-2 text-lg font-semibold text-foreground">How to work through this stage</h3>

                  <div className="mt-5 space-y-4">
                    <div className="rounded-2xl border border-border/60 bg-background/75 p-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Sparkles className="h-4 w-4 text-primary" />
                        Start with the next incomplete lesson
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        The chapter is ordered intentionally, so the next unfinished lesson is the right default move.
                      </p>
                    </div>

                    <div className="rounded-2xl border border-border/60 bg-background/75 p-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <PlayCircle className="h-4 w-4 text-primary" />
                        Keep active lessons in motion
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        In-progress lessons are where your fastest momentum lives, so finish those before hopping around.
                      </p>
                    </div>

                    <div className="rounded-2xl border border-border/60 bg-background/75 p-4">
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <CheckCircle2 className="h-4 w-4 text-success" />
                        Use completed lessons as quick refreshers
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Completed lessons stay useful as revision checkpoints before you move into harder material.
                      </p>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          </section>
        )}
      </div>
    </AppLayout>
  );
}
