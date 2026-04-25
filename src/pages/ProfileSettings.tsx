import { useState, useEffect } from "react";
import {
  User,
  DollarSign,
  Target,
  Brain,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Loader2,
  Save,
  Settings2,
} from "lucide-react";

import { AppLayout } from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "@/hooks/use-toast";
import { coreDb, meridianDb, aiDb } from "@/lib/supabase";
import { getErrorMessage } from "@/lib/error";

// ── Types ─────────────────────────────────────────────────────────────────────

interface UserGoal {
  id: string;
  goal_name: string;
  target_amount: number;
  current_amount: number | null;
  monthly_contribution: number | null;
  target_date: string | null;
  status: string | null;
}

interface GoalDraft {
  goal_name: string;
  target_amount: string;
  current_amount: string;
  monthly_contribution: string;
  target_date: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function emergencyFundToMonths(value: string): number {
  switch (value) {
    case "building": return 1;
    case "3_months": return 3;
    case "6_plus": return 6;
    default: return 0;
  }
}

function monthsToEmergencyFund(months: number | null): string {
  if (!months || months === 0) return "none";
  if (months < 3) return "building";
  if (months <= 3) return "3_months";
  return "6_plus";
}

function experienceLevelToTier(level: string): number {
  switch (level) {
    case "intermediate": return 2;
    case "advanced": return 3;
    default: return 1;
  }
}

function tierToExperienceLevel(tier: number | null): string {
  if (tier === 2) return "intermediate";
  if (tier === 3) return "advanced";
  return "beginner";
}

function emptyDraft(): GoalDraft {
  return { goal_name: "", target_amount: "", current_amount: "", monthly_contribution: "", target_date: "" };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}

function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

function Field({ id, label, children }: { id?: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function SaveFooter({
  description,
  saving,
  onSave,
}: {
  description: string;
  saving: boolean;
  onSave: () => void;
}) {
  return (
    <CardFooter className="flex flex-col gap-3 border-t border-border/60 bg-background/40 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">{description}</p>
      <Button type="button" onClick={onSave} disabled={saving} className="rounded-full px-5">
        {saving ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Saving…
          </>
        ) : (
          <>
            <Save className="mr-2 h-4 w-4" />
            Save Changes
          </>
        )}
      </Button>
    </CardFooter>
  );
}

// ── Goal row ──────────────────────────────────────────────────────────────────

function GoalRow({
  goal,
  onDeactivate,
  onSave,
}: {
  goal: UserGoal;
  onDeactivate: (id: string) => void;
  onSave: (updated: UserGoal) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<UserGoal>(goal);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setDraft(goal);
    setEditing(false);
  };

  if (!editing) {
    return (
      <div className="rounded-[20px] border border-border/60 bg-background/60 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{goal.goal_name}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>Target: <span className="text-foreground">€{goal.target_amount.toLocaleString()}</span></span>
              {goal.current_amount != null && (
                <span>Saved: <span className="text-foreground">€{goal.current_amount.toLocaleString()}</span></span>
              )}
              {goal.monthly_contribution != null && (
                <span>Monthly: <span className="text-foreground">€{goal.monthly_contribution.toLocaleString()}</span></span>
              )}
              {goal.target_date && (
                <span>By: <span className="text-foreground">{goal.target_date}</span></span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setEditing(true)}
              className="h-8 w-8 rounded-full p-0"
            >
              <Edit2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onDeactivate(goal.id)}
              className="h-8 w-8 rounded-full p-0 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[20px] border border-primary/40 bg-background/80 p-4">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Goal name</Label>
          <Input
            value={draft.goal_name}
            onChange={(e) => setDraft({ ...draft, goal_name: e.target.value })}
            className="h-9 rounded-xl border-border/60 bg-card text-sm"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Target amount (€)</Label>
            <Input
              type="number"
              min="0"
              value={draft.target_amount}
              onChange={(e) => setDraft({ ...draft, target_amount: parseFloat(e.target.value) || 0 })}
              className="h-9 rounded-xl border-border/60 bg-card text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Currently saved (€)</Label>
            <Input
              type="number"
              min="0"
              value={draft.current_amount ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, current_amount: e.target.value ? parseFloat(e.target.value) : null })
              }
              className="h-9 rounded-xl border-border/60 bg-card text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Monthly contribution (€)</Label>
            <Input
              type="number"
              min="0"
              value={draft.monthly_contribution ?? ""}
              onChange={(e) =>
                setDraft({ ...draft, monthly_contribution: e.target.value ? parseFloat(e.target.value) : null })
              }
              className="h-9 rounded-xl border-border/60 bg-card text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Target date</Label>
            <Input
              type="date"
              value={draft.target_date ?? ""}
              onChange={(e) => setDraft({ ...draft, target_date: e.target.value || null })}
              className="h-9 rounded-xl border-border/60 bg-card text-sm"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCancel}
            className="h-8 rounded-full px-3 text-xs"
          >
            <X className="mr-1 h-3 w-3" />
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={saving || !draft.goal_name}
            className="h-8 rounded-full px-3 text-xs"
          >
            {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
            Save goal
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── New goal form ─────────────────────────────────────────────────────────────

function NewGoalForm({
  onSave,
  onCancel,
}: {
  onSave: (draft: GoalDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<GoalDraft>(emptyDraft());
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!draft.goal_name || !draft.target_amount) return;
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-[20px] border border-dashed border-primary/40 bg-primary/5 p-4">
      <p className="mb-3 text-sm font-medium text-foreground">New goal</p>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Goal name</Label>
          <Input
            value={draft.goal_name}
            onChange={(e) => setDraft({ ...draft, goal_name: e.target.value })}
            placeholder="e.g. House deposit, Retirement…"
            className="h-9 rounded-xl border-border/60 bg-card text-sm"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Target amount (€)</Label>
            <Input
              type="number"
              min="0"
              value={draft.target_amount}
              onChange={(e) => setDraft({ ...draft, target_amount: e.target.value })}
              placeholder="50000"
              className="h-9 rounded-xl border-border/60 bg-card text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Currently saved (€)</Label>
            <Input
              type="number"
              min="0"
              value={draft.current_amount}
              onChange={(e) => setDraft({ ...draft, current_amount: e.target.value })}
              placeholder="0"
              className="h-9 rounded-xl border-border/60 bg-card text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Monthly contribution (€)</Label>
            <Input
              type="number"
              min="0"
              value={draft.monthly_contribution}
              onChange={(e) => setDraft({ ...draft, monthly_contribution: e.target.value })}
              placeholder="500"
              className="h-9 rounded-xl border-border/60 bg-card text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Target date</Label>
            <Input
              type="date"
              value={draft.target_date}
              onChange={(e) => setDraft({ ...draft, target_date: e.target.value })}
              className="h-9 rounded-xl border-border/60 bg-card text-sm"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            className="h-8 rounded-full px-3 text-xs"
          >
            <X className="mr-1 h-3 w-3" />
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={saving || !draft.goal_name || !draft.target_amount}
            className="h-8 rounded-full px-3 text-xs"
          >
            {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Plus className="mr-1 h-3 w-3" />}
            Add goal
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Page skeleton ─────────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <AppLayout title="Profile Settings">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="animate-pulse rounded-[30px] border border-border/60 bg-card/90 p-6">
          <div className="h-4 w-32 rounded-full bg-muted/70" />
          <div className="mt-4 h-10 w-64 rounded-full bg-muted/70" />
          <div className="mt-3 h-4 w-full max-w-md rounded-full bg-muted/60" />
        </div>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-48 rounded-[28px] border border-border/60 bg-card/80 animate-pulse" />
        ))}
      </div>
    </AppLayout>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const ProfileSettings = () => {
  const { authUserId, userProfile, refreshProfile } = useAuth();

  const [loading, setLoading] = useState(true);

  // Section 1 — Personal Profile
  const [ageRange, setAgeRange] = useState("");
  const [incomeRange, setIncomeRange] = useState("");
  const [employmentStatus, setEmploymentStatus] = useState("");
  const [country, setCountry] = useState("");
  const [maritalStatus, setMaritalStatus] = useState("");
  const [savingS1, setSavingS1] = useState(false);

  // Section 2 — Financial Profile
  const [riskProfile, setRiskProfile] = useState("");
  const [investmentHorizon, setInvestmentHorizon] = useState("");
  const [monthlyInvestable, setMonthlyInvestable] = useState("");
  const [emergencyFund, setEmergencyFund] = useState("none");
  const [savingS2, setSavingS2] = useState(false);

  // Section 3 — Goals
  const [goals, setGoals] = useState<UserGoal[]>([]);
  const [showAddGoal, setShowAddGoal] = useState(false);
  const [savingGoals, setSavingGoals] = useState(false);

  // Section 4 — Knowledge Level
  const [experienceLevel, setExperienceLevel] = useState("beginner");
  const [savingS4, setSavingS4] = useState(false);

  // ── Load data ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!authUserId) return;

    const load = async () => {
      try {
        const [profileResult, goalsResult] = await Promise.all([
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (coreDb.from("user_profiles") as any)
            .select("*")
            .eq("user_id", authUserId)
            .maybeSingle(),
          meridianDb
            .from("user_goals")
            .select("*")
            .eq("user_id", authUserId)
            .eq("status", "active"),
        ]);

        const p = profileResult.data;
        if (p) {
          setAgeRange(p.age_range ?? "");
          setIncomeRange(p.income_range ?? "");
          setEmploymentStatus(p.employment_status ?? "");
          setCountry(p.country_of_residence ?? "");
          setMaritalStatus(p.marital_status ?? "");
          setRiskProfile(p.risk_profile ?? "");
          setInvestmentHorizon(p.investment_horizon ?? "");
          setMonthlyInvestable(p.monthly_investable?.toString() ?? "");
          setEmergencyFund(monthsToEmergencyFund(p.emergency_fund_months));
          setExperienceLevel(
            userProfile?.experience_level ?? tierToExperienceLevel(p.knowledge_tier),
          );
        }

        setGoals(goalsResult.data ?? []);
      } catch (err) {
        console.error("ProfileSettings load error:", err);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [authUserId, userProfile?.experience_level]);

  // ── IRIS cache invalidation ──────────────────────────────────────────────────

  const invalidateIrisCache = async () => {
    if (!authUserId) return;
    try {
      await aiDb.from("iris_context_cache").delete().eq("user_id", authUserId);
    } catch {
      // Non-critical — IRIS will rebuild on next chat
    }
  };

  // ── Section saves ────────────────────────────────────────────────────────────

  const saveSection1 = async () => {
    if (!authUserId) return;
    setSavingS1(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (coreDb.from("user_profiles") as any).upsert(
        {
          user_id: authUserId,
          age_range: ageRange || null,
          income_range: incomeRange || null,
          employment_status: employmentStatus || null,
          country_of_residence: country || null,
          marital_status: maritalStatus || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (error) throw error;
      await invalidateIrisCache();
      toast({ title: "Saved", description: "Personal profile updated." });
    } catch (e) {
      toast({
        title: "Error",
        description: getErrorMessage(e) || "Failed to save.",
        variant: "destructive",
      });
    } finally {
      setSavingS1(false);
    }
  };

  const saveSection2 = async () => {
    if (!authUserId) return;
    setSavingS2(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (coreDb.from("user_profiles") as any).upsert(
        {
          user_id: authUserId,
          risk_profile: riskProfile || null,
          investment_horizon: investmentHorizon || null,
          monthly_investable: monthlyInvestable ? parseFloat(monthlyInvestable) : null,
          emergency_fund_months: emergencyFundToMonths(emergencyFund),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (error) throw error;
      await invalidateIrisCache();
      toast({ title: "Saved", description: "Financial profile updated." });
    } catch (e) {
      toast({
        title: "Error",
        description: getErrorMessage(e) || "Failed to save.",
        variant: "destructive",
      });
    } finally {
      setSavingS2(false);
    }
  };

  const saveGoal = async (updated: UserGoal) => {
    const { error } = await meridianDb.from("user_goals").upsert(
      {
        id: updated.id,
        user_id: authUserId!,
        goal_name: updated.goal_name,
        target_amount: updated.target_amount,
        current_amount: updated.current_amount,
        monthly_contribution: updated.monthly_contribution,
        target_date: updated.target_date,
        status: "active",
      },
      { onConflict: "id" },
    );
    if (error) throw error;
    setGoals((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
    await invalidateIrisCache();
    toast({ title: "Saved", description: "Goal updated." });
  };

  const deactivateGoal = async (goalId: string) => {
    try {
      const { error } = await meridianDb
        .from("user_goals")
        .update({ status: "inactive" })
        .eq("id", goalId);
      if (error) throw error;
      setGoals((prev) => prev.filter((g) => g.id !== goalId));
      await invalidateIrisCache();
      toast({ title: "Goal removed", description: "Goal marked as inactive." });
    } catch (e) {
      toast({
        title: "Error",
        description: getErrorMessage(e) || "Failed to remove goal.",
        variant: "destructive",
      });
    }
  };

  const addGoal = async (draft: GoalDraft) => {
    setSavingGoals(true);
    try {
      const { data, error } = await meridianDb
        .from("user_goals")
        .insert({
          user_id: authUserId!,
          goal_name: draft.goal_name,
          target_amount: parseFloat(draft.target_amount),
          current_amount: draft.current_amount ? parseFloat(draft.current_amount) : null,
          monthly_contribution: draft.monthly_contribution ? parseFloat(draft.monthly_contribution) : null,
          target_date: draft.target_date || null,
          status: "active",
        })
        .select()
        .single();
      if (error) throw error;
      setGoals((prev) => [...prev, data]);
      setShowAddGoal(false);
      await invalidateIrisCache();
      toast({ title: "Goal added", description: "New goal created." });
    } catch (e) {
      toast({
        title: "Error",
        description: getErrorMessage(e) || "Failed to add goal.",
        variant: "destructive",
      });
    } finally {
      setSavingGoals(false);
    }
  };

  const saveSection4 = async () => {
    if (!authUserId) return;
    setSavingS4(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: profileError } = await (coreDb.from("user_profiles") as any).upsert(
        {
          user_id: authUserId,
          knowledge_tier: experienceLevelToTier(experienceLevel),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );

      if (profileError) throw profileError;

      const { error: userError } = await coreDb
        .from("users")
        .update({
          experience_level: experienceLevel,
          updated_at: new Date().toISOString(),
        })
        .eq("auth_id", authUserId);

      if (userError) throw userError;

      await invalidateIrisCache();
      await refreshProfile();
      toast({ title: "Saved", description: "Knowledge level updated." });
    } catch (e) {
      toast({
        title: "Error",
        description: getErrorMessage(e) || "Failed to save.",
        variant: "destructive",
      });
    } finally {
      setSavingS4(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loading) return <LoadingSkeleton />;

  return (
    <AppLayout title="Profile Settings">
      <div className="mx-auto max-w-3xl space-y-6">

        {/* Page header */}
        <section className="relative overflow-hidden rounded-[30px] border border-border/60 bg-card/95 p-6 shadow-[0_24px_70px_-52px_rgba(15,23,42,0.45)] animate-in fade-in duration-300">
          <div className="absolute inset-x-0 top-0 h-28 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.16),transparent_58%)]" />
          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-muted/50 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              <Settings2 className="h-3.5 w-3.5" />
              Profile Settings
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Your financial profile
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
              Review and update the answers you gave during onboarding. Changes take effect immediately and update the context IRIS uses to personalise your experience.
            </p>
          </div>
        </section>

        {/* Section 1 — Personal Profile */}
        <Card className="overflow-hidden rounded-[28px] border-border/60 bg-card/95 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.35)] animate-in fade-in duration-300">
          <CardHeader className="border-b border-border/60 pb-5">
            <CardTitle className="flex items-center gap-2 text-lg">
              <User className="h-4 w-4 text-primary" />
              Personal Profile
            </CardTitle>
            <CardDescription>
              Basic demographic information used to contextualise advice.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-5 pt-6">
            <SectionHeading
              title="Demographics"
              description="Help IRIS understand your life stage and circumstances."
            />

            <FieldRow>
              <Field id="ageRange" label="Age range">
                <Select value={ageRange} onValueChange={setAgeRange}>
                  <SelectTrigger id="ageRange" className="h-11 rounded-xl border-border/60 bg-background/70">
                    <SelectValue placeholder="Select age range" />
                  </SelectTrigger>
                  <SelectContent>
                    {["18-24", "25-34", "35-44", "45-54", "55-64", "65+"].map((v) => (
                      <SelectItem key={v} value={v}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field id="incomeRange" label="Annual income">
                <Select value={incomeRange} onValueChange={setIncomeRange}>
                  <SelectTrigger id="incomeRange" className="h-11 rounded-xl border-border/60 bg-background/70">
                    <SelectValue placeholder="Select income range" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="<30k">Under €30,000</SelectItem>
                    <SelectItem value="30-50k">€30,000 – €50,000</SelectItem>
                    <SelectItem value="50-80k">€50,000 – €80,000</SelectItem>
                    <SelectItem value="80-120k">€80,000 – €120,000</SelectItem>
                    <SelectItem value="120k+">€120,000+</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </FieldRow>

            <FieldRow>
              <Field id="employmentStatus" label="Employment status">
                <Select value={employmentStatus} onValueChange={setEmploymentStatus}>
                  <SelectTrigger id="employmentStatus" className="h-11 rounded-xl border-border/60 bg-background/70">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employed">Employed</SelectItem>
                    <SelectItem value="self-employed">Self-employed</SelectItem>
                    <SelectItem value="student">Student</SelectItem>
                    <SelectItem value="retired">Retired</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field id="maritalStatus" label="Marital status">
                <Select value={maritalStatus} onValueChange={setMaritalStatus}>
                  <SelectTrigger id="maritalStatus" className="h-11 rounded-xl border-border/60 bg-background/70">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single">Single</SelectItem>
                    <SelectItem value="married">Married</SelectItem>
                    <SelectItem value="partnered">Partnered</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </FieldRow>

            <Field id="country" label="Country of residence">
              <Input
                id="country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="e.g. Ireland, Germany, France…"
                className="h-11 rounded-xl border-border/60 bg-background/70"
              />
            </Field>
          </CardContent>

          <SaveFooter
            description="Updates demographic context for IRIS personalisation."
            saving={savingS1}
            onSave={saveSection1}
          />
        </Card>

        {/* Section 2 — Financial Profile */}
        <Card className="overflow-hidden rounded-[28px] border-border/60 bg-card/95 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.35)] animate-in fade-in duration-300">
          <CardHeader className="border-b border-border/60 pb-5">
            <CardTitle className="flex items-center gap-2 text-lg">
              <DollarSign className="h-4 w-4 text-primary" />
              Financial Profile
            </CardTitle>
            <CardDescription>
              Your risk tolerance, investment horizon, and monthly capacity.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-5 pt-6">
            <SectionHeading
              title="Risk &amp; capacity"
              description="These fields directly shape how IRIS frames recommendations."
            />

            <FieldRow>
              <Field id="riskProfile" label="Risk profile">
                <Select value={riskProfile} onValueChange={setRiskProfile}>
                  <SelectTrigger id="riskProfile" className="h-11 rounded-xl border-border/60 bg-background/70">
                    <SelectValue placeholder="Select risk profile" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="conservative">Conservative</SelectItem>
                    <SelectItem value="moderate">Moderate</SelectItem>
                    <SelectItem value="aggressive">Aggressive</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field id="investmentHorizon" label="Investment horizon">
                <Select value={investmentHorizon} onValueChange={setInvestmentHorizon}>
                  <SelectTrigger id="investmentHorizon" className="h-11 rounded-xl border-border/60 bg-background/70">
                    <SelectValue placeholder="Select horizon" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="short">Short-term (1–2 years)</SelectItem>
                    <SelectItem value="balanced">Balanced (3–5 years)</SelectItem>
                    <SelectItem value="long">Long-term (5+ years)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </FieldRow>

            <FieldRow>
              <Field id="monthlyInvestable" label="Monthly investable amount (€)">
                <Input
                  id="monthlyInvestable"
                  type="number"
                  min="0"
                  value={monthlyInvestable}
                  onChange={(e) => setMonthlyInvestable(e.target.value)}
                  placeholder="e.g. 500"
                  className="h-11 rounded-xl border-border/60 bg-background/70"
                />
              </Field>

              <Field id="emergencyFund" label="Emergency fund status">
                <Select value={emergencyFund} onValueChange={setEmergencyFund}>
                  <SelectTrigger id="emergencyFund" className="h-11 rounded-xl border-border/60 bg-background/70">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="building">Building</SelectItem>
                    <SelectItem value="3_months">3 months</SelectItem>
                    <SelectItem value="6_plus">6+ months</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </FieldRow>
          </CardContent>

          <SaveFooter
            description="Updates financial capacity data used by IRIS for planning."
            saving={savingS2}
            onSave={saveSection2}
          />
        </Card>

        {/* Section 3 — Goals */}
        <Card className="overflow-hidden rounded-[28px] border-border/60 bg-card/95 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.35)] animate-in fade-in duration-300">
          <CardHeader className="border-b border-border/60 pb-5">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Target className="h-4 w-4 text-primary" />
              Goals
            </CardTitle>
            <CardDescription>
              Your active financial goals. Edit or remove goals below, or add a new one.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-3 pt-6">
            {goals.length === 0 && !showAddGoal && (
              <p className="rounded-[20px] border border-dashed border-border/60 px-4 py-6 text-center text-sm text-muted-foreground">
                No active goals. Add one below.
              </p>
            )}

            {goals.map((goal) => (
              <GoalRow
                key={goal.id}
                goal={goal}
                onDeactivate={deactivateGoal}
                onSave={saveGoal}
              />
            ))}

            {showAddGoal ? (
              <NewGoalForm
                onSave={addGoal}
                onCancel={() => setShowAddGoal(false)}
              />
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowAddGoal(true)}
                disabled={savingGoals}
                className="mt-1 w-full rounded-[20px] border-dashed border-border/60 py-5 text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground"
              >
                <Plus className="mr-2 h-4 w-4" />
                Add a new goal
              </Button>
            )}
          </CardContent>

          <div className="border-t border-border/60 bg-background/40 px-6 py-4">
            <p className="text-sm text-muted-foreground">
              Goals are saved individually using the inline controls above. Removing a goal sets its status to inactive — it is not deleted.
            </p>
          </div>
        </Card>

        {/* Section 4 — Knowledge Level */}
        <Card className="overflow-hidden rounded-[28px] border-border/60 bg-card/95 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.35)] animate-in fade-in duration-300">
          <CardHeader className="border-b border-border/60 pb-5">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Brain className="h-4 w-4 text-primary" />
              Knowledge Level
            </CardTitle>
            <CardDescription>
              Controls the depth and tone of IRIS responses across the product.
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-6">
            <div className="rounded-[24px] border border-border/60 bg-background/60 p-5">
              <Field id="experienceLevel" label="Experience level">
                <Select value={experienceLevel} onValueChange={setExperienceLevel}>
                  <SelectTrigger id="experienceLevel" className="h-11 rounded-xl border-border/60 bg-card">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="beginner">Beginner</SelectItem>
                    <SelectItem value="intermediate">Intermediate</SelectItem>
                    <SelectItem value="advanced">Advanced</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <div className="mt-3 flex flex-wrap gap-2">
                {experienceLevel === "beginner" && (
                  <Badge variant="secondary" className="rounded-full text-xs">
                    Simpler explanations and foundational guidance
                  </Badge>
                )}
                {experienceLevel === "intermediate" && (
                  <Badge variant="secondary" className="rounded-full text-xs">
                    Balanced portfolio and market context discussions
                  </Badge>
                )}
                {experienceLevel === "advanced" && (
                  <Badge variant="secondary" className="rounded-full text-xs">
                    High-signal analysis and sharper portfolio reasoning
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>

          <SaveFooter
            description="Sets the knowledge_tier used by IRIS to calibrate response depth."
            saving={savingS4}
            onSave={saveSection4}
          />
        </Card>

      </div>
    </AppLayout>
  );
};

export default ProfileSettings;
