import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, BookOpen, ChevronRight, GraduationCap, Trophy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/use-auth";
import { academyApi, TIER_IDS } from "@/services/academy-api";

export function AcademyProgress() {
  const { authUserId } = useAuth();
  const navigate = useNavigate();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["academy-dashboard-progress", authUserId],
    enabled: !!authUserId,
    queryFn: async () => {
      const [tiers, lessons, progress, enrollments] = await Promise.all([
        academyApi.getTiers(),
        academyApi.getAllLessons(),
        academyApi.getUserLessonProgress(authUserId!),
        academyApi.getTierEnrollments(authUserId!),
      ]);

      return { tiers, lessons, progress, enrollments };
    },
  });

  useEffect(() => {
    if (isError) {
      console.error("Failed to load academy dashboard progress.", {
        authUserId,
        queryKey: ["academy-dashboard-progress", authUserId],
        error,
      });
    }
  }, [authUserId, error, isError]);

  const summary = useMemo(() => {
    const tiers = data?.tiers ?? [];
    const lessons = data?.lessons ?? [];
    const progress = data?.progress ?? [];
    const enrollments = data?.enrollments ?? [];

    const completedLessonIds = new Set(
      progress.filter((entry) => entry.status === "completed").map((entry) => entry.lesson_id),
    );
    const unlockedTierIds = new Set([
      TIER_IDS.BEGINNER,
      ...enrollments.map((entry) => entry.tier_id),
    ]);

    const totalLessons = lessons.length;
    const completedLessons = completedLessonIds.size;
    const inProgressLessons = progress.filter((entry) => entry.status === "in_progress").length;
    const overallPercent = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;

    const tierCards = tiers.map((tier) => {
      const tierLessons = lessons.filter((lesson) => lesson.tier_id === tier.id);
      const completedInTier = tierLessons.filter((lesson) => completedLessonIds.has(lesson.id)).length;
      const totalInTier = tierLessons.length;
      const tierPercent = totalInTier > 0 ? Math.round((completedInTier / totalInTier) * 100) : 0;
      const unlocked = unlockedTierIds.has(tier.id);

      return {
        id: tier.id,
        name: tier.name,
        slug: tier.slug,
        unlocked,
        completedInTier,
        totalInTier,
        tierPercent,
      };
    });

    const nextLesson = lessons.find((lesson) => {
      if (!unlockedTierIds.has(lesson.tier_id)) {
        return false;
      }

      const lessonProgress = progress.find((entry) => entry.lesson_id === lesson.id);
      return lessonProgress?.status !== "completed";
    });

    return {
      overallPercent,
      completedLessons,
      totalLessons,
      inProgressLessons,
      unlockedTiers: tierCards.filter((tier) => tier.unlocked).length,
      tierCards,
      nextLesson,
    };
  }, [data]);

  if (isLoading) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardContent className="pt-5 pb-4">
          <div className="h-4 w-36 bg-muted/50 rounded animate-pulse mb-4" />
          <div className="h-2 bg-muted/30 rounded animate-pulse mb-6" />
          <div className="grid gap-3 sm:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-muted/30 rounded-xl animate-pulse" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardContent className="flex flex-col items-center px-4 py-8 text-center">
          <AlertCircle className="mb-3 h-8 w-8 text-destructive/70" />
          <p className="text-sm font-medium text-foreground">We couldn’t load your Academy progress.</p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            Please try again from the Academy page while we refresh your learning summary.
          </p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => navigate("/academy")}>
            Open Academy
          </Button>
        </CardContent>
      </Card>
    );
  }

  const hasAcademyData = (data?.tiers?.length ?? 0) > 0;

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardContent className="pt-5 pb-4 space-y-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <GraduationCap className="h-4 w-4 text-primary" />
              <p className="text-xs text-muted-foreground/70 uppercase tracking-wide">Academy progress</p>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Track your course progress from the dashboard</h2>
              <p className="text-sm text-muted-foreground/70">
                See lessons completed, unlocked tiers, and jump back into the next lesson faster.
              </p>
            </div>
          </div>

          <Button variant="outline" size="sm" className="gap-2 self-start" onClick={() => navigate("/academy")}>
            Open Academy
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {!hasAcademyData ? (
          <div className="rounded-xl border border-dashed border-border/50 bg-muted/20 px-4 py-8 text-center">
            <BookOpen className="mx-auto mb-3 h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm font-medium">Your Academy progress will appear here.</p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              Start the Academy to unlock lessons, tiers, and personalized progress tracking.
            </p>
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-border/40 bg-background/40 p-4">
              <div className="mb-3 flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Overall completion</p>
                  <p className="text-xs text-muted-foreground/60">
                    {summary.completedLessons} of {summary.totalLessons} lessons completed
                  </p>
                </div>
                <span className="text-2xl font-bold text-primary">{summary.overallPercent}%</span>
              </div>
              <Progress value={summary.overallPercent} className="h-2" />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-border/40 bg-background/30 p-4">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground/60">Completed lessons</p>
                <p className="mt-2 text-2xl font-semibold">{summary.completedLessons}</p>
              </div>
              <div className="rounded-xl border border-border/40 bg-background/30 p-4">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground/60">In progress</p>
                <p className="mt-2 text-2xl font-semibold">{summary.inProgressLessons}</p>
              </div>
              <div className="rounded-xl border border-border/40 bg-background/30 p-4">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground/60">Unlocked tiers</p>
                <p className="mt-2 text-2xl font-semibold">{summary.unlockedTiers}</p>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-[1.3fr_0.9fr]">
              <div className="rounded-xl border border-border/40 bg-background/30 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-primary" />
                  <p className="text-sm font-medium">Tier progress</p>
                </div>
                <div className="space-y-3">
                  {summary.tierCards.map((tier) => (
                    <button
                      key={tier.id}
                      type="button"
                      disabled={!tier.unlocked}
                      onClick={() => navigate(`/academy/${tier.slug}`)}
                      className="w-full rounded-xl border border-border/30 bg-card/40 px-3 py-3 text-left transition hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">{tier.name}</p>
                          <p className="text-xs text-muted-foreground/60">
                            {tier.unlocked ? `${tier.completedInTier}/${tier.totalInTier} lessons completed` : "Locked"}
                          </p>
                        </div>
                        <span className="text-sm font-semibold text-primary">{tier.tierPercent}%</span>
                      </div>
                      <Progress value={tier.tierPercent} className="h-1.5" />
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-border/40 bg-background/30 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-primary" />
                  <p className="text-sm font-medium">Continue learning</p>
                </div>
                {summary.nextLesson ? (
                  <>
                    <p className="text-sm font-semibold">{summary.nextLesson.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground/60">Next recommended lesson in your Academy path.</p>
                    <Button className="mt-4 w-full gap-2" onClick={() => navigate(`/academy/lesson/${summary.nextLesson.slug}`)}>
                      Resume lesson
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold">You’re all caught up</p>
                    <p className="mt-1 text-xs text-muted-foreground/60">
                      Nice work — open the Academy to review lessons or keep building your streak.
                    </p>
                    <Button variant="outline" className="mt-4 w-full" onClick={() => navigate("/academy")}>
                      Review Academy
                    </Button>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
