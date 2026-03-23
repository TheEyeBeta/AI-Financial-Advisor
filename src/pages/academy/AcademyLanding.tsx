import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  GraduationCap,
  Lock,
  Sparkles,
  Target,
  Trophy,
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
  UNLOCK_THRESHOLDS,
  type Lesson,
  type Tier,
  type UserLessonProgress,
  type UserTierEnrollment,
} from "@/services/academy-api";
import { DEFAULT_JOURNEY_META, getJourneyMeta } from "./journey-theme";

const TIER_UNLOCK_CONDITIONS: Record<string, string> = {
  [TIER_IDS.INTERMEDIATE]: `Complete ${UNLOCK_THRESHOLDS.INTERMEDIATE} or more Beginner lessons`,
  [TIER_IDS.ADVANCED]: `Complete ${UNLOCK_THRESHOLDS.ADVANCED} or more Intermediate lessons`,
};

function logTierEnrollmentError(tierName: string, operation: string, error: unknown) {
  console.error(`Failed to ${operation} for Academy tier "${tierName}" for user [REDACTED].`, error);
}

export default function AcademyLanding() {
  const { authUserId, userProfile } = useAuth();
  const navigate = useNavigate();

  const [tiers, setTiers] = useState<Tier[]>([]);
  const [allLessons, setAllLessons] = useState<Lesson[]>([]);
  const [progress, setProgress] = useState<UserLessonProgress[]>([]);
  const [enrollments, setEnrollments] = useState<UserTierEnrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const displayName = userProfile?.first_name && userProfile?.last_name
    ? `${userProfile.first_name} ${userProfile.last_name}`
    : userProfile?.first_name || null;

  const loadData = useCallback(async () => {
    if (!authUserId) return;
    try {
      setLoading(true);
      setError(null);

      await (displayName
        ? academyApi.upsertProfile(authUserId, displayName)
        : academyApi.upsertProfile(authUserId)
      ).catch((err) => console.error("Failed to upsert academy profile:", err));

      const [tiersData, lessonsData, progressData, enrollmentsData] = await Promise.all([
        academyApi.getTiers(),
        academyApi.getAllLessons(),
        academyApi.getUserLessonProgress(authUserId),
        academyApi.getTierEnrollments(authUserId),
      ]);

      setTiers(tiersData);
      setAllLessons(lessonsData);
      setProgress(progressData);

      const enrolledTierIds = new Set(enrollmentsData.map((enrollment) => enrollment.tier_id));

      if (!enrolledTierIds.has(TIER_IDS.BEGINNER)) {
        await academyApi
          .enrollInTier(authUserId, TIER_IDS.BEGINNER, "default")
          .then(() => enrolledTierIds.add(TIER_IDS.BEGINNER))
          .catch((err) => logTierEnrollmentError("Beginner", "enroll user", err));
      }

      const completedLessonIds = new Set(
        progressData.filter((entry) => entry.status === "completed").map((entry) => entry.lesson_id),
      );

      const beginnerLessons = lessonsData.filter((lesson) => lesson.tier_id === TIER_IDS.BEGINNER);
      const completedBeginner = beginnerLessons.filter((lesson) => completedLessonIds.has(lesson.id)).length;

      const intermediateLessons = lessonsData.filter((lesson) => lesson.tier_id === TIER_IDS.INTERMEDIATE);
      const completedIntermediate = intermediateLessons.filter((lesson) => completedLessonIds.has(lesson.id)).length;

      if (
        completedBeginner >= UNLOCK_THRESHOLDS.INTERMEDIATE &&
        !enrolledTierIds.has(TIER_IDS.INTERMEDIATE)
      ) {
        await academyApi
          .enrollInTier(authUserId, TIER_IDS.INTERMEDIATE, "beginner_completion")
          .then(() => enrolledTierIds.add(TIER_IDS.INTERMEDIATE))
          .catch((err) => logTierEnrollmentError("Intermediate", "unlock and enroll user", err));
      }

      if (
        completedIntermediate >= UNLOCK_THRESHOLDS.ADVANCED &&
        !enrolledTierIds.has(TIER_IDS.ADVANCED)
      ) {
        await academyApi
          .enrollInTier(authUserId, TIER_IDS.ADVANCED, "intermediate_completion")
          .then(() => enrolledTierIds.add(TIER_IDS.ADVANCED))
          .catch((err) => logTierEnrollmentError("Advanced", "unlock and enroll user", err));
      }

      const freshEnrollments = await academyApi.getTierEnrollments(authUserId);
      setEnrollments(freshEnrollments);
    } catch (err) {
      console.error("Error loading academy data:", err);
      setError("Failed to load academy. Please try again.");
      toast({ title: "Error", description: "Failed to load academy.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [authUserId, displayName]);

  useEffect(() => {
    if (!authUserId) return;
    loadData();
  }, [authUserId, loadData]);

  const enrolledTierIds = new Set(enrollments.map((enrollment) => enrollment.tier_id));
  const completedLessonIds = new Set(
    progress.filter((entry) => entry.status === "completed").map((entry) => entry.lesson_id),
  );

  function getTierLessons(tierId: string): Lesson[] {
    return allLessons
      .filter((lesson) => lesson.tier_id === tierId)
      .sort((a, b) => a.order_index - b.order_index);
  }

  function getCompletedCount(tierId: string): number {
    return getTierLessons(tierId).filter((lesson) => completedLessonIds.has(lesson.id)).length;
  }

  function getLessonCount(tierId: string): number {
    return getTierLessons(tierId).length;
  }

  function getTierMinutes(tierId: string): number {
    return getTierLessons(tierId).reduce((total, lesson) => total + lesson.estimated_minutes, 0);
  }

  function isTierUnlocked(tier: Tier): boolean {
    if (tier.id === TIER_IDS.BEGINNER) return true;
    return enrolledTierIds.has(tier.id);
  }

  function getTierStatusLabel(tier: Tier, unlocked: boolean): string {
    if (!unlocked) return "Locked";

    const lessonCount = getLessonCount(tier.id);
    const completedCount = getCompletedCount(tier.id);

    if (lessonCount > 0 && completedCount === lessonCount) return "Chapter complete";
    if (completedCount > 0) return "In progress";
    return "Ready to begin";
  }

  function getUnlockSnapshot(tier: Tier): { current: number; target: number; label: string } | null {
    if (tier.id === TIER_IDS.INTERMEDIATE) {
      return {
        current: getCompletedCount(TIER_IDS.BEGINNER),
        target: UNLOCK_THRESHOLDS.INTERMEDIATE,
        label: "Beginner lessons completed",
      };
    }

    if (tier.id === TIER_IDS.ADVANCED) {
      return {
        current: getCompletedCount(TIER_IDS.INTERMEDIATE),
        target: UNLOCK_THRESHOLDS.ADVANCED,
        label: "Intermediate lessons completed",
      };
    }

    return null;
  }

  const tierOrder = new Map(tiers.map((tier) => [tier.id, tier.order_index]));
  const totalLessons = allLessons.length;
  const totalCompleted = completedLessonIds.size;
  const overallProgress = totalLessons > 0 ? Math.round((totalCompleted / totalLessons) * 100) : 0;
  const unlockedTiers = tiers.filter((tier) => isTierUnlocked(tier));
  const completedTiers = tiers.filter((tier) => {
    const lessonCount = getLessonCount(tier.id);
    return lessonCount > 0 && getCompletedCount(tier.id) === lessonCount;
  }).length;
  const activeTier = tiers.find((tier) => {
    if (!isTierUnlocked(tier)) return false;
    return getCompletedCount(tier.id) < getLessonCount(tier.id);
  }) ?? unlockedTiers[unlockedTiers.length - 1] ?? tiers[0] ?? null;
  const nextLockedTier = tiers.find((tier) => !isTierUnlocked(tier)) ?? null;
  const sortedLessons = [...allLessons].sort((a, b) => {
    const tierDelta = (tierOrder.get(a.tier_id) ?? 999) - (tierOrder.get(b.tier_id) ?? 999);
    return tierDelta !== 0 ? tierDelta : a.order_index - b.order_index;
  });
  const nextRecommendedLesson = sortedLessons.find((lesson) => {
    const tier = tiers.find((entry) => entry.id === lesson.tier_id);
    return tier ? isTierUnlocked(tier) && !completedLessonIds.has(lesson.id) : false;
  }) ?? null;
  const activeTierProgress = activeTier
    ? Math.round((getCompletedCount(activeTier.id) / Math.max(getLessonCount(activeTier.id), 1)) * 100)
    : 0;
  const nextUnlockSnapshot = nextLockedTier ? getUnlockSnapshot(nextLockedTier) : null;
  const welcomeName = displayName?.split(" ")[0] ?? "Investor";
  const ActiveTierIcon = activeTier ? getJourneyMeta(activeTier.id).icon : GraduationCap;

  if (loading) {
    return (
      <AppLayout title="Academy">
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="h-72 animate-pulse rounded-[2rem] bg-muted/30" />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              {[1, 2, 3].map((item) => (
                <div key={item} className="h-56 animate-pulse rounded-[1.75rem] bg-muted/30" />
              ))}
            </div>
            <div className="space-y-4">
              <div className="h-52 animate-pulse rounded-[1.75rem] bg-muted/30" />
              <div className="h-44 animate-pulse rounded-[1.75rem] bg-muted/30" />
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout title="Academy">
        <div className="mx-auto max-w-4xl">
          <Card className="border-border/50 bg-card/50">
            <CardContent className="py-16 text-center">
              <BookOpen className="mx-auto mb-4 h-12 w-12 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button className="mt-4" onClick={loadData}>
                Retry
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Academy">
      <div className="mx-auto max-w-6xl space-y-6 pb-6">
        <section className="relative overflow-hidden rounded-[2rem] border border-border/60 bg-card px-6 py-7 sm:px-8 sm:py-8 animate-in fade-in duration-500">
          <div className="absolute -left-12 top-0 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />
          <div className="absolute right-4 top-6 h-40 w-40 rounded-full bg-success/10 blur-3xl" />
          <div className="absolute bottom-0 left-1/3 h-36 w-36 rounded-full bg-warning/10 blur-3xl" />
          <div className="absolute inset-0 bg-[linear-gradient(135deg,transparent_0%,hsl(var(--background)/0.55)_100%)]" />

          <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_320px] lg:items-end">
            <div>
              <Badge variant="outline" className="border-primary/20 bg-primary/5 text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                Learning Journey
              </Badge>

              <div className="mt-4 space-y-3">
                <p className="text-sm font-medium text-primary/80">{welcomeName}, your next chapter is ready.</p>
                <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                  Make the Academy feel like a climb, not a checklist.
                </h1>
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                  The path unfolds in chapters. Finish each stage, unlock the next, and keep moving from
                  foundations into higher-conviction investing decisions.
                </p>
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <Button
                  className="gap-2 rounded-full px-5"
                  onClick={() => {
                    if (nextRecommendedLesson) {
                      navigate(`/academy/lesson/${nextRecommendedLesson.slug}`);
                      return;
                    }

                    if (activeTier) {
                      navigate(`/academy/${activeTier.slug}`);
                    }
                  }}
                >
                  {nextRecommendedLesson ? "Continue next lesson" : "Open current chapter"}
                  <ArrowRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  className="rounded-full border-border/70 bg-background/70"
                  onClick={() => {
                    document.getElementById("academy-journey-map")?.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    });
                  }}
                >
                  Explore the path
                </Button>
              </div>

              <div className="mt-7 grid gap-3 sm:grid-cols-3">
                <Card className="border-border/50 bg-background/75 shadow-none">
                  <div className="p-4">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      <BookOpen className="h-3.5 w-3.5" />
                      Lessons
                    </div>
                    <p className="mt-3 text-2xl font-semibold text-foreground">
                      {totalCompleted}
                      <span className="text-sm font-medium text-muted-foreground"> / {totalLessons}</span>
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">Lessons completed across the full path.</p>
                  </div>
                </Card>

                <Card className="border-border/50 bg-background/75 shadow-none">
                  <div className="p-4">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      <Target className="h-3.5 w-3.5" />
                      Progress
                    </div>
                    <p className="mt-3 text-2xl font-semibold text-foreground">{overallProgress}%</p>
                    <p className="mt-1 text-sm text-muted-foreground">Overall academy journey completed.</p>
                  </div>
                </Card>

                <Card className="border-border/50 bg-background/75 shadow-none">
                  <div className="p-4">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      <Trophy className="h-3.5 w-3.5" />
                      Chapters
                    </div>
                    <p className="mt-3 text-2xl font-semibold text-foreground">
                      {completedTiers}
                      <span className="text-sm font-medium text-muted-foreground"> / {tiers.length}</span>
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">Chapters fully completed so far.</p>
                  </div>
                </Card>
              </div>
            </div>

            <Card className="border-border/60 bg-background/80 shadow-none backdrop-blur">
              <div className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Current Trail</p>
                    <h2 className="mt-1 text-lg font-semibold text-foreground">
                      {activeTier?.name ?? "Start your journey"}
                    </h2>
                  </div>
                  {activeTier && (
                    <Badge variant="outline" className={cn("text-xs", getJourneyMeta(activeTier.id).badgeClass)}>
                      {getJourneyMeta(activeTier.id).chapter}
                    </Badge>
                  )}
                </div>

                <div className="mt-5 flex items-start gap-4">
                  <div
                    className={cn(
                      "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border",
                      activeTier ? getJourneyMeta(activeTier.id).iconClass : DEFAULT_JOURNEY_META.iconClass,
                    )}
                  >
                    <ActiveTierIcon className="h-5 w-5" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">
                      {activeTier ? getJourneyMeta(activeTier.id).hook : "Pick your first chapter."}
                    </p>
                    <p className="text-sm leading-6 text-muted-foreground">
                      {activeTier ? getJourneyMeta(activeTier.id).summary : DEFAULT_JOURNEY_META.summary}
                    </p>
                  </div>
                </div>

                <div className="mt-6 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {activeTier ? `${getCompletedCount(activeTier.id)} of ${getLessonCount(activeTier.id)} lessons` : "No lessons loaded"}
                    </span>
                    <span className="font-medium text-foreground">{activeTierProgress}%</span>
                  </div>
                  <Progress value={activeTierProgress} className="h-2" />
                </div>

                {nextLockedTier && nextUnlockSnapshot ? (
                  <div className="mt-5 rounded-2xl border border-border/60 bg-card/80 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Lock className="h-4 w-4 text-muted-foreground" />
                      Next unlock: {nextLockedTier.name}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {TIER_UNLOCK_CONDITIONS[nextLockedTier.id]}
                    </p>
                    <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                      <span>{nextUnlockSnapshot.label}</span>
                      <span>
                        {Math.min(nextUnlockSnapshot.current, nextUnlockSnapshot.target)} / {nextUnlockSnapshot.target}
                      </span>
                    </div>
                    <Progress
                      value={Math.min((nextUnlockSnapshot.current / nextUnlockSnapshot.target) * 100, 100)}
                      className="mt-2 h-1.5"
                    />
                  </div>
                ) : (
                  <div className="mt-5 rounded-2xl border border-success/20 bg-success/5 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <CheckCircle2 className="h-4 w-4 text-success" />
                      Every chapter is unlocked
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      You can move freely through the full academy journey now.
                    </p>
                  </div>
                )}
              </div>
            </Card>
          </div>
        </section>

        <section
          id="academy-journey-map"
          className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] animate-in fade-in duration-500"
          style={{ animationDelay: "100ms" }}
        >
          <div className="space-y-4">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Journey Map</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
                  Progress through the academy in deliberate stages.
                </h2>
              </div>
              <Badge variant="outline" className="hidden border-border/70 bg-card/60 text-muted-foreground sm:flex">
                {unlockedTiers.length} of {tiers.length} chapters unlocked
              </Badge>
            </div>

            <div className="space-y-4">
              {tiers.map((tier) => {
                const unlocked = isTierUnlocked(tier);
                const lessonCount = getLessonCount(tier.id);
                const completedCount = getCompletedCount(tier.id);
                const progressPct = lessonCount > 0 ? Math.round((completedCount / lessonCount) * 100) : 0;
                const unlockSnapshot = getUnlockSnapshot(tier);
                const tierLessons = getTierLessons(tier.id);
                const previewLessons = tierLessons.slice(0, 3);
                const remainingPreviewCount = Math.max(tierLessons.length - previewLessons.length, 0);
                const meta = getJourneyMeta(tier.id);
                const Icon = meta.icon;
                const stageLabel = getTierStatusLabel(tier, unlocked);

                return (
                  <div key={tier.id} className="relative">
                    <Card
                      className={cn(
                        "relative overflow-hidden rounded-[1.75rem] border shadow-sm",
                        meta.panelClass,
                      )}
                    >
                      <div className={cn("h-1 w-full bg-gradient-to-r", meta.ribbonClass)} />
                      <div className="p-5 sm:p-6">
                        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                          <div className="space-y-3">
                            <div className="flex flex-wrap items-center gap-3">
                              <div
                                className={cn(
                                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border shadow-sm",
                                  meta.iconClass,
                                )}
                              >
                                <Icon className="h-4 w-4" />
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline" className={cn("text-xs", meta.badgeClass)}>
                                  {meta.chapter}
                                </Badge>
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "text-xs",
                                    unlocked
                                      ? "border-border/70 bg-background/70 text-foreground"
                                      : "border-border/60 bg-muted/30 text-muted-foreground",
                                  )}
                                >
                                  {stageLabel}
                                </Badge>
                              </div>
                            </div>

                            <div>
                              <h3 className="text-xl font-semibold text-foreground">{tier.name}</h3>
                              <p className="mt-1 text-sm font-medium text-foreground/85">{meta.hook}</p>
                            </div>

                            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                              {tier.description || meta.summary}
                            </p>
                          </div>

                          <div className="rounded-2xl border border-border/60 bg-background/75 p-4 lg:min-w-[230px]">
                            <div className="grid grid-cols-2 gap-3 text-sm">
                              <div>
                                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Lessons</p>
                                <p className="mt-1 font-semibold text-foreground">{lessonCount}</p>
                              </div>
                              <div>
                                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Minutes</p>
                                <p className="mt-1 font-semibold text-foreground">{getTierMinutes(tier.id)}</p>
                              </div>
                            </div>

                            {unlocked ? (
                              <div className="mt-4 space-y-2">
                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                  <span>{completedCount} completed</span>
                                  <span>{progressPct}%</span>
                                </div>
                                <Progress value={progressPct} className="h-2" />
                              </div>
                            ) : (
                              <div className="mt-4 rounded-xl border border-border/60 bg-muted/25 p-3 text-xs text-muted-foreground">
                                {TIER_UNLOCK_CONDITIONS[tier.id]}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="mt-6 grid gap-4 md:grid-cols-[minmax(0,1fr)_220px] md:items-end">
                          <div>
                            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">What you will cover</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {previewLessons.map((lesson) => (
                                <span
                                  key={lesson.id}
                                  className="rounded-full border border-border/60 bg-background/80 px-3 py-1 text-xs text-foreground/80"
                                >
                                  {lesson.title}
                                </span>
                              ))}
                              {remainingPreviewCount > 0 && (
                                <span className="rounded-full border border-dashed border-border/60 px-3 py-1 text-xs text-muted-foreground">
                                  +{remainingPreviewCount} more lessons
                                </span>
                              )}
                              {tierLessons.length === 0 && (
                                <span className="rounded-full border border-dashed border-border/60 px-3 py-1 text-xs text-muted-foreground">
                                  Lessons coming soon
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-col gap-2 md:items-end">
                            {unlockSnapshot && !unlocked && (
                              <p className="text-right text-xs text-muted-foreground">
                                {Math.max(unlockSnapshot.target - unlockSnapshot.current, 0)} more lessons to open this chapter.
                              </p>
                            )}
                            <Button
                              className={cn("gap-2 rounded-full px-5", unlocked ? meta.buttonClass : "")}
                              disabled={!unlocked}
                              variant={unlocked ? "default" : "outline"}
                              onClick={() => navigate(`/academy/${tier.slug}`)}
                            >
                              {unlocked ? (completedCount > 0 ? "Enter chapter" : "Start chapter") : "Chapter locked"}
                              <ArrowRight className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </Card>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-4">
            <Card className="rounded-[1.75rem] border-border/60 bg-card/90 shadow-sm">
              <div className="p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Journey Compass</p>
                <h3 className="mt-2 text-lg font-semibold text-foreground">What to focus on next</h3>

                {nextRecommendedLesson ? (
                  <div className="mt-5 space-y-4">
                    <div className="rounded-2xl border border-border/60 bg-background/75 p-4">
                      <p className="text-sm font-medium text-foreground">{nextRecommendedLesson.title}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{nextRecommendedLesson.short_summary}</p>
                    </div>
                    <Button
                      className="w-full gap-2 rounded-full"
                      onClick={() => navigate(`/academy/lesson/${nextRecommendedLesson.slug}`)}
                    >
                      Resume next lesson
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="mt-5 rounded-2xl border border-success/20 bg-success/5 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <CheckCircle2 className="h-4 w-4 text-success" />
                      You are caught up
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Review completed chapters or head into advanced material whenever you want.
                    </p>
                  </div>
                )}
              </div>
            </Card>

            <Card className="rounded-[1.75rem] border-border/60 bg-card/90 shadow-sm">
              <div className="p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Path Rules</p>
                <h3 className="mt-2 text-lg font-semibold text-foreground">How chapters unlock</h3>
                <div className="mt-5 space-y-4">
                  <div className="rounded-2xl border border-border/60 bg-background/75 p-4">
                    <p className="text-sm font-medium text-foreground">Beginner is always open</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Start here to build the base vocabulary, habits, and intuition.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-background/75 p-4">
                    <p className="text-sm font-medium text-foreground">
                      Intermediate unlocks after {UNLOCK_THRESHOLDS.INTERMEDIATE} Beginner lessons
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      The second chapter opens when you have enough reps in the fundamentals.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border/60 bg-background/75 p-4">
                    <p className="text-sm font-medium text-foreground">
                      Advanced unlocks after {UNLOCK_THRESHOLDS.ADVANCED} Intermediate lessons
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      The final stage is reserved for users who have worked through the middle chapter.
                    </p>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </section>
      </div>
    </AppLayout>
  );
}
