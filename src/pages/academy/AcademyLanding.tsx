import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { GraduationCap, Lock, ChevronRight, BookOpen } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  academyApi,
  TIER_IDS,
  UNLOCK_THRESHOLDS,
  type Tier,
  type UserLessonProgress,
  type UserTierEnrollment,
  type Lesson,
} from "@/services/academy-api";

const TIER_UNLOCK_CONDITIONS: Record<string, string> = {
  [TIER_IDS.INTERMEDIATE]: `Complete ${UNLOCK_THRESHOLDS.INTERMEDIATE} or more Beginner lessons`,
  [TIER_IDS.ADVANCED]: `Complete ${UNLOCK_THRESHOLDS.ADVANCED} or more Intermediate lessons`,
};

const TIER_COLORS: Record<string, string> = {
  [TIER_IDS.BEGINNER]: "text-success border-success/30 bg-success/5",
  [TIER_IDS.INTERMEDIATE]: "text-primary border-primary/30 bg-primary/5",
  [TIER_IDS.ADVANCED]: "text-warning border-warning/30 bg-warning/5",
};

const TIER_BADGE_COLORS: Record<string, string> = {
  [TIER_IDS.BEGINNER]: "bg-success/10 text-success border-success/20",
  [TIER_IDS.INTERMEDIATE]: "bg-primary/10 text-primary border-primary/20",
  [TIER_IDS.ADVANCED]: "bg-warning/10 text-warning border-warning/20",
};

export default function AcademyLanding() {
  const { authUserId, userProfile } = useAuth();
  const navigate = useNavigate();

  const [tiers, setTiers] = useState<Tier[]>([]);
  const [allLessons, setAllLessons] = useState<Lesson[]>([]);
  const [progress, setProgress] = useState<UserLessonProgress[]>([]);
  const [enrollments, setEnrollments] = useState<UserTierEnrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Keep name fields in refs so loadData can read them without depending on them.
  const firstNameRef = useRef(userProfile?.first_name);
  const lastNameRef = useRef(userProfile?.last_name);
  firstNameRef.current = userProfile?.first_name;
  lastNameRef.current = userProfile?.last_name;

  // Sync academy profile display name when name changes, without triggering
  // a full data reload.
  useEffect(() => {
    if (!authUserId) return;
    const displayName = firstNameRef.current && lastNameRef.current
      ? `${firstNameRef.current} ${lastNameRef.current}`
      : firstNameRef.current || null;
    if (displayName) {
      academyApi.upsertProfile(authUserId, displayName).catch((err) =>
        console.error('Failed to upsert academy profile:', err),
      );
    }
  }, [authUserId, userProfile?.first_name, userProfile?.last_name]);

  const loadData = useCallback(async () => {
    if (!authUserId) return;
    try {
      setLoading(true);
      setError(null);

      // Ensure profile row exists before any enrollment operations.
      // Reads name from refs to avoid adding name fields to deps.
      const displayName = firstNameRef.current && lastNameRef.current
        ? `${firstNameRef.current} ${lastNameRef.current}`
        : firstNameRef.current || null;
      await (displayName
        ? academyApi.upsertProfile(authUserId, displayName)
        : academyApi.upsertProfile(authUserId)
      ).catch((err) => console.error('Failed to upsert academy profile:', err));

      const [tiersData, lessonsData, progressData, enrollmentsData] = await Promise.all([
        academyApi.getTiers(),
        academyApi.getAllLessons(),
        academyApi.getUserLessonProgress(authUserId),
        academyApi.getTierEnrollments(authUserId),
      ]);

      setTiers(tiersData);
      setAllLessons(lessonsData);
      setProgress(progressData);

      // Auto-enroll in tiers where unlock conditions are met
      const enrolledTierIds = new Set(enrollmentsData.map((e) => e.tier_id));

      // Beginner is always enrolled
      if (!enrolledTierIds.has(TIER_IDS.BEGINNER)) {
        await academyApi
          .enrollInTier(authUserId, TIER_IDS.BEGINNER, 'default')
          .then(() => enrolledTierIds.add(TIER_IDS.BEGINNER))
          .catch((err) =>
            console.error(`Failed to enroll user ${authUserId} in Beginner tier:`, err),
          );
      }

      const completedLessonIds = new Set(
        progressData.filter((p) => p.status === 'completed').map((p) => p.lesson_id),
      );

      const beginnerLessons = lessonsData.filter((l) => l.tier_id === TIER_IDS.BEGINNER);
      const completedBeginner = beginnerLessons.filter((l) => completedLessonIds.has(l.id)).length;

      const intermediateLessons = lessonsData.filter((l) => l.tier_id === TIER_IDS.INTERMEDIATE);
      const completedIntermediate = intermediateLessons.filter((l) =>
        completedLessonIds.has(l.id),
      ).length;

      if (
        completedBeginner >= UNLOCK_THRESHOLDS.INTERMEDIATE &&
        !enrolledTierIds.has(TIER_IDS.INTERMEDIATE)
      ) {
        await academyApi
          .enrollInTier(authUserId, TIER_IDS.INTERMEDIATE, 'beginner_completion')
          .then(() => enrolledTierIds.add(TIER_IDS.INTERMEDIATE))
          .catch((err) =>
            console.error(`Failed to enroll user ${authUserId} in Intermediate tier:`, err),
          );
      }

      if (
        completedIntermediate >= UNLOCK_THRESHOLDS.ADVANCED &&
        !enrolledTierIds.has(TIER_IDS.ADVANCED)
      ) {
        await academyApi
          .enrollInTier(authUserId, TIER_IDS.ADVANCED, 'intermediate_completion')
          .then(() => enrolledTierIds.add(TIER_IDS.ADVANCED))
          .catch((err) =>
            console.error(`Failed to enroll user ${authUserId} in Advanced tier:`, err),
          );
      }

      // Reload enrollments after potential auto-enrolls
      const freshEnrollments = await academyApi.getTierEnrollments(authUserId);
      setEnrollments(freshEnrollments);
    } catch (err) {
      console.error("Error loading academy data:", err);
      setError("Failed to load academy. Please try again.");
      toast({ title: "Error", description: "Failed to load academy.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [authUserId]);

  useEffect(() => {
    if (!authUserId) return;
    loadData();
  }, [authUserId, loadData]);

  const enrolledTierIds = new Set(enrollments.map((e) => e.tier_id));
  const completedLessonIds = new Set(
    progress.filter((p) => p.status === 'completed').map((p) => p.lesson_id),
  );

  function getCompletedCount(tierId: string): number {
    const tierLessons = allLessons.filter((l) => l.tier_id === tierId);
    return tierLessons.filter((l) => completedLessonIds.has(l.id)).length;
  }

  function getLessonCount(tierId: string): number {
    return allLessons.filter((l) => l.tier_id === tierId).length;
  }

  function isTierUnlocked(tier: Tier): boolean {
    if (tier.id === TIER_IDS.BEGINNER) return true;
    return enrolledTierIds.has(tier.id);
  }

  if (loading) {
    return (
      <AppLayout title="Academy">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="h-8 w-48 bg-muted/50 rounded animate-pulse" />
          <div className="h-4 w-64 bg-muted/30 rounded animate-pulse" />
          <div className="grid gap-4 sm:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-48 bg-muted/30 rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout title="Academy">
        <div className="max-w-4xl mx-auto">
          <Card className="border-border/50 bg-card/50">
            <CardContent className="py-16 text-center">
              <BookOpen className="h-12 w-12 mx-auto mb-4 text-muted-foreground/20" />
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
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="animate-in fade-in duration-300">
          <div className="flex items-center gap-3 mb-1">
            <GraduationCap className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold text-foreground">Academy</h1>
          </div>
          <p className="text-sm text-muted-foreground/70">
            Master financial concepts through structured, interactive lessons.
          </p>
        </div>

        {/* Tier Cards */}
        <div className="grid gap-4 sm:grid-cols-3 animate-in fade-in duration-300" style={{ animationDelay: '50ms' }}>
          {tiers.map((tier) => {
            const unlocked = isTierUnlocked(tier);
            const completedCount = getCompletedCount(tier.id);
            const lessonCount = getLessonCount(tier.id);
            const progressPct = lessonCount > 0 ? Math.round((completedCount / lessonCount) * 100) : 0;
            const unlockCondition = TIER_UNLOCK_CONDITIONS[tier.id];

            const tierTextColor = TIER_COLORS[tier.id]?.split(' ')[0] ?? 'text-foreground';

            return (
              <Card
                key={tier.id}
                role={unlocked ? "button" : undefined}
                tabIndex={unlocked ? 0 : undefined}
                aria-disabled={!unlocked}
                className={cn(
                  "border transition-all duration-200",
                  unlocked
                    ? "bg-card/50 border-border/50 hover:border-border cursor-pointer hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    : "bg-muted/20 border-border/30 opacity-70",
                )}
                onClick={() => unlocked && navigate(`/academy/${tier.slug}`)}
                onKeyDown={(e) => {
                  if (unlocked && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    navigate(`/academy/${tier.slug}`);
                  }
                }}
              >
                <CardContent className="p-5 space-y-4">
                  {/* Tier header */}
                  <div className="flex items-start justify-between">
                    <div>
                      <Badge
                        variant="outline"
                        className={cn("text-xs mb-2", TIER_BADGE_COLORS[tier.id])}
                      >
                        {tier.name}
                      </Badge>
                      <h2 className="text-base font-semibold text-foreground">{tier.name}</h2>
                    </div>
                    {unlocked ? (
                      <ChevronRight className={cn("h-5 w-5 mt-0.5", tierTextColor)} />
                    ) : (
                      <Lock className="h-5 w-5 mt-0.5 text-muted-foreground/40" />
                    )}
                  </div>

                  {/* Description */}
                  <p className="text-xs text-muted-foreground/70 line-clamp-3">{tier.description}</p>

                  {/* Progress / lock info */}
                  {unlocked ? (
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs text-muted-foreground/70">
                        <span>{completedCount} / {lessonCount} completed</span>
                        <span>{progressPct}%</span>
                      </div>
                      <Progress value={progressPct} className="h-1.5" />
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
                      <Lock className="h-3 w-3 flex-shrink-0" />
                      <span>{unlockCondition}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </AppLayout>
  );
}
