import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  ArrowLeft,
  Loader2,
  TrendingUp,
  Plus,
  X,
  Shield,
  Target,
  Clock,
  User,
  Landmark,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { supabase, coreDb, meridianDb } from "@/lib/supabase";
import { toast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/error";
import { academyApi, TIER_IDS } from "@/services/academy-api";
import { AnalyticsEvents } from "@/services/analytics";
import { refreshIrisContextCache } from "@/services/iris-cache";

// ── Types ────────────────────────────────────────────────────────────────────

type AgeRange = "18-24" | "25-34" | "35-44" | "45-54" | "55-64" | "65+";
type IncomeRange = "<30k" | "30-50k" | "50-80k" | "80-120k" | "120k+";
type RiskProfile = "conservative" | "moderate" | "aggressive";
type InvestmentHorizon = "short" | "balanced" | "long";

interface Step1Data {
  age_range: AgeRange | "";
  income_range: IncomeRange | "";
  dependants: number;
  monthly_expenses: string;
  total_debt: string;
}

interface Step2Data {
  emergency_fund_months: string;
  monthly_investable: string;
}

interface RiskQuizAnswers {
  q1: number;
  q2: number;
  q3: number;
  q4: number;
  q5: number;
  q6: number;
  q7: number;
}

interface GoalEntry {
  id: string;
  goal_name: string;
  custom_name: string;
  target_amount: string;
  target_date: string;
  monthly_contribution: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const STEP_ICONS = [User, Landmark, Shield, Clock, Target];
const STEP_LABELS = [
  "About You",
  "Financial Foundation",
  "Risk Profile",
  "Investment Horizon",
  "Your Goals",
];

const AGE_OPTIONS: { value: AgeRange; label: string }[] = [
  { value: "18-24", label: "18–24" },
  { value: "25-34", label: "25–34" },
  { value: "35-44", label: "35–44" },
  { value: "45-54", label: "45–54" },
  { value: "55-64", label: "55–64" },
  { value: "65+", label: "65+" },
];

const INCOME_OPTIONS: { value: IncomeRange; label: string }[] = [
  { value: "<30k", label: "Less than $30,000" },
  { value: "30-50k", label: "$30,000 - $50,000" },
  { value: "50-80k", label: "$50,000 - $80,000" },
  { value: "80-120k", label: "$80,000 - $120,000" },
  { value: "120k+", label: "$120,000+" },
];

const EMERGENCY_FUND_OPTIONS: { value: string; label: string; numeric: number }[] = [
  { value: "0", label: "None", numeric: 0 },
  { value: "0.5", label: "About 2 weeks", numeric: 0.5 },
  { value: "1", label: "1 month", numeric: 1 },
  { value: "2", label: "2 months", numeric: 2 },
  { value: "3", label: "3 months", numeric: 3 },
  { value: "4", label: "4 months", numeric: 4 },
  { value: "5", label: "5 months", numeric: 5 },
  { value: "6+", label: "6+ months", numeric: 6 },
];

const RISK_QUESTIONS = [
  {
    question: "If your investment dropped 20% in a month, what would you do?",
    options: [
      { label: "Sell everything to stop further losses", score: 1 },
      { label: "Hold and wait for recovery", score: 2 },
      { label: "Buy more at the lower price", score: 3 },
    ],
  },
  {
    question: "What is your primary investment goal?",
    options: [
      { label: "Protect what I have \u2014 safety first", score: 1 },
      { label: "Grow steadily over time", score: 2 },
      { label: "Maximise returns, I can handle volatility", score: 3 },
    ],
  },
  {
    question:
      "How long do you plan to keep your investments before needing the money?",
    options: [
      { label: "Less than 3 years", score: 1 },
      { label: "3\u201310 years", score: 2 },
      { label: "More than 10 years", score: 3 },
    ],
  },
  {
    question: "How would you describe your investment experience?",
    options: [
      { label: "None \u2014 I'm just starting out", score: 1 },
      { label: "Some \u2014 I've bought stocks or funds before", score: 2 },
      { label: "Experienced \u2014 I actively manage a portfolio", score: 3 },
    ],
  },
  {
    question:
      "If you had $10,000 to invest, which option appeals most?",
    options: [
      { label: "A savings account with guaranteed 3% return", score: 1 },
      {
        label:
          "A diversified fund with expected 8% return, possible -10% in bad years",
        score: 2,
      },
      {
        label:
          "Individual stocks with potential 25% return, possible -40% in bad years",
        score: 3,
      },
    ],
  },
  {
    question: "How stable is your income?",
    options: [
      { label: "Variable or uncertain", score: 1 },
      { label: "Stable but could change", score: 2 },
      { label: "Very stable and growing", score: 3 },
    ],
  },
  {
    question: "How do you feel about investing in general?",
    options: [
      { label: "Nervous \u2014 I worry about losing money", score: 1 },
      { label: "Cautious but open to some risk", score: 2 },
      { label: "Comfortable \u2014 I understand risk is part of returns", score: 3 },
    ],
  },
];

const GOAL_PRESETS = [
  "Retirement",
  "House deposit",
  "Emergency fund",
  "Education",
  "Wealth building",
  "Other",
];

const HORIZON_OPTIONS: { value: InvestmentHorizon; label: string; description: string }[] = [
  {
    value: "short",
    label: "Short-term",
    description: "Days to weeks \u2014 I'm an active trader",
  },
  {
    value: "balanced",
    label: "Balanced",
    description: "Months to a few years \u2014 growth with flexibility",
  },
  {
    value: "long",
    label: "Long-term",
    description: "5+ years \u2014 building wealth over time",
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function computeRiskProfile(answers: RiskQuizAnswers): RiskProfile {
  const values = Object.values(answers);
  if (values.some((v) => v === 0)) return "moderate"; // fallback if incomplete
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  if (avg <= 1.6) return "conservative";
  if (avg <= 2.3) return "moderate";
  return "aggressive";
}

function riskProfileDescription(profile: RiskProfile): string {
  switch (profile) {
    case "conservative":
      return "You prioritise protecting your capital. Your plan will focus on stability and lower-risk instruments.";
    case "moderate":
      return "You want growth with reasonable protection. Your plan will balance opportunity with stability.";
    case "aggressive":
      return "You're comfortable with volatility in pursuit of higher returns. Your plan will prioritise growth signals.";
  }
}

function makeGoal(): GoalEntry {
  return {
    id: crypto.randomUUID(),
    goal_name: "",
    custom_name: "",
    target_amount: "",
    target_date: "",
    monthly_contribution: "",
  };
}

function getTodayStr(): string {
  return new Date().toISOString().split("T")[0];
}

// ── Component ────────────────────────────────────────────────────────────────

const Onboarding = () => {
  const { authUserId, appUserId, userProfile, refreshProfile } = useAuth();
  const navigate = useNavigate();

  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasExistingProfile, setHasExistingProfile] = useState<boolean | null>(null);

  // Step 1
  const [step1, setStep1] = useState<Step1Data>({
    age_range: "",
    income_range: "",
    dependants: 0,
    monthly_expenses: "",
    total_debt: "",
  });

  // Step 2
  const [step2, setStep2] = useState<Step2Data>({
    emergency_fund_months: "",
    monthly_investable: "",
  });

  // Step 3 — Risk Quiz
  const [quizAnswers, setQuizAnswers] = useState<RiskQuizAnswers>({
    q1: 0, q2: 0, q3: 0, q4: 0, q5: 0, q6: 0, q7: 0,
  });
  const [computedRisk, setComputedRisk] = useState<RiskProfile | null>(null);

  // Step 4
  const [horizon, setHorizon] = useState<InvestmentHorizon | "">("");

  // Step 5 — Goals
  const [goals, setGoals] = useState<GoalEntry[]>([makeGoal()]);

  const totalSteps = 5;

  // Check for existing Meridian profile
  useEffect(() => {
    if (!appUserId) return;
    coreDb
      .from("user_profiles")
      .select("id")
      .eq("user_id", appUserId)
      .maybeSingle()
      .then(({ data }) => {
        setHasExistingProfile(!!data);
      })
      .catch(() => setHasExistingProfile(false));
  }, [appUserId]);

  // ── Already completed ────────────────────────────────────────────────────

  if (hasExistingProfile === true) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 bg-gradient-to-br from-background to-muted/20">
        <Card className="w-full max-w-lg text-center">
          <CardHeader className="space-y-4">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <TrendingUp className="h-8 w-8 text-primary" />
            </div>
            <CardTitle className="text-2xl">Onboarding Complete</CardTitle>
            <CardDescription className="text-base">
              You've already completed onboarding. Visit your profile settings
              to update your information.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3 justify-center">
              <Button variant="outline" onClick={() => navigate("/profile")}>
                Profile Settings
              </Button>
              <Button onClick={() => navigate("/advisor")}>
                Go to IRIS
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Loading state ────────────────────────────────────────────────────────

  if (hasExistingProfile === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // ── Step validation ──────────────────────────────────────────────────────

  const canProceed = (): boolean => {
    switch (currentStep) {
      case 1:
        return (
          step1.age_range !== "" &&
          step1.income_range !== "" &&
          step1.monthly_expenses !== "" &&
          parseFloat(step1.monthly_expenses) >= 0 &&
          step1.total_debt !== "" &&
          parseFloat(step1.total_debt) >= 0
        );
      case 2:
        return (
          step2.emergency_fund_months !== "" &&
          step2.monthly_investable !== "" &&
          parseFloat(step2.monthly_investable) >= 0
        );
      case 3: {
        const allAnswered = Object.values(quizAnswers).every((v) => v > 0);
        return allAnswered;
      }
      case 4:
        return horizon !== "";
      case 5:
        return goals.length >= 1 && goals.every((g) => {
          const name = g.goal_name === "Other" ? g.custom_name.trim() : g.goal_name;
          return name !== "" && g.target_amount !== "" && parseFloat(g.target_amount) > 0;
        });
      default:
        return false;
    }
  };

  const handleNext = () => {
    if (currentStep === 3 && !computedRisk) {
      // Compute risk before moving to step 4
      const profile = computeRiskProfile(quizAnswers);
      setComputedRisk(profile);
    }
    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      if (currentStep === 4 && computedRisk) {
        // Going back to quiz, clear result to show quiz again
        setComputedRisk(null);
      }
      setCurrentStep(currentStep - 1);
    }
  };

  // ── Submit ───────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!authUserId || !userProfile?.id) {
      toast({
        title: "Error",
        description: "User not found. Please sign in again.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const riskProfile = computedRisk ?? computeRiskProfile(quizAnswers);
      const emergencyMonths =
        EMERGENCY_FUND_OPTIONS.find((o) => o.value === step2.emergency_fund_months)
          ?.numeric ?? 0;

      // WRITE 1 — core.user_profiles (upsert)
      const { error: profileError } = await coreDb
        .from("user_profiles")
        .upsert(
          {
            user_id: authUserId,
            age_range: step1.age_range,
            income_range: step1.income_range,
            monthly_expenses: parseFloat(step1.monthly_expenses),
            total_debt: parseFloat(step1.total_debt),
            dependants: step1.dependants,
            emergency_fund_months: emergencyMonths,
            monthly_investable: parseFloat(step2.monthly_investable),
            risk_profile: riskProfile,
            knowledge_tier: 1,
            investment_horizon: horizon,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );

      if (profileError) throw profileError;

      // WRITE 2 — meridian.user_goals (insert, one per goal)
      const goalRows = goals.map((g) => ({
        user_id: authUserId,
        goal_name: g.goal_name === "Other" ? g.custom_name.trim() : g.goal_name,
        target_amount: parseFloat(g.target_amount),
        current_amount: 0,
        target_date: g.target_date || null,
        monthly_contribution: g.monthly_contribution
          ? parseFloat(g.monthly_contribution)
          : null,
        required_return_pct: null,
        status: "active",
      }));

      const { error: goalsError } = await meridianDb
        .from("user_goals")
        .insert(goalRows);

      if (goalsError) throw goalsError;

      // WRITE 3 — mark onboarding complete in core.users (required for gate state)
      const { error: usersError } = await coreDb
        .from("users")
        .update({
          onboarding_complete: true,
          risk_level: riskProfile === "conservative" ? "low" : riskProfile === "moderate" ? "mid" : "high",
          investment_goal: goals[0]?.goal_name === "Other"
            ? "other"
            : goals[0]?.goal_name?.toLowerCase().replace(" ", "_") || "other",
          updated_at: new Date().toISOString(),
        })
        .eq("auth_id", authUserId);

      if (usersError) throw usersError;

      // WRITE 4 — trigger cache refresh (fire-and-forget)
      refreshIrisContextCache(authUserId);

      // Initialize Academy profile
      try {
        const displayName = [userProfile.first_name, userProfile.last_name]
          .filter(Boolean)
          .join(" ")
          .trim();
        await academyApi.upsertProfile(authUserId, displayName || undefined);
        await academyApi.enrollInTier(authUserId, TIER_IDS.BEGINNER, "default");
      } catch (academyErr) {
        console.warn("Academy init failed:", academyErr);
      }

      // Refresh auth context
      await refreshProfile();
      AnalyticsEvents.onboardingComplete({
        risk_profile: riskProfile,
        investment_horizon: horizon,
        goal_count: goalRows.length,
      });

      toast({
        title: "Your financial profile is ready",
        description:
          "IRIS now knows your goals and will personalise every response to your situation.",
      });

      navigate("/advisor", { replace: true });
    } catch (error: unknown) {
      toast({
        title: "Error",
        description:
          getErrorMessage(error) ||
          "Failed to save your profile. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Goal helpers ─────────────────────────────────────────────────────────

  const updateGoal = (id: string, field: keyof GoalEntry, value: string | number) => {
    setGoals((prev) =>
      prev.map((g) => (g.id === id ? { ...g, [field]: value } : g))
    );
  };

  const removeGoal = (id: string) => {
    if (goals.length <= 1) return;
    setGoals((prev) => prev.filter((g) => g.id !== id));
  };

  const addGoal = () => {
    if (goals.length >= 5) return;
    setGoals((prev) => [...prev, makeGoal()]);
  };

  // ── Render ───────────────────────────────────────────────────────────────

  const StepIcon = STEP_ICONS[currentStep - 1];

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-gradient-to-br from-background to-muted/20">
      <Card className="w-full max-w-2xl">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <StepIcon className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-3xl">
            {currentStep <= totalSteps ? STEP_LABELS[currentStep - 1] : "Complete"}
          </CardTitle>
          <CardDescription className="text-base">
            Let's build your financial profile so IRIS can personalise every response.
          </CardDescription>
          {/* Progress Bar */}
          <div className="w-full bg-muted rounded-full h-2 mt-4">
            <div
              className="bg-primary h-2 rounded-full transition-all duration-300"
              style={{ width: `${(currentStep / totalSteps) * 100}%` }}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            Step {currentStep} of {totalSteps}
          </p>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* ── STEP 1: About You ──────────────────────────────────────── */}
          {currentStep === 1 && (
            <div className="space-y-5">
              {/* Age Range */}
              <div className="space-y-2">
                <Label>Age range</Label>
                <Select
                  value={step1.age_range}
                  onValueChange={(v) =>
                    setStep1({ ...step1, age_range: v as AgeRange })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select your age range" />
                  </SelectTrigger>
                  <SelectContent>
                    {AGE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Income Range */}
              <div className="space-y-2">
                <Label>Annual income range</Label>
                <Select
                  value={step1.income_range}
                  onValueChange={(v) =>
                    setStep1({ ...step1, income_range: v as IncomeRange })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select your income range" />
                  </SelectTrigger>
                  <SelectContent>
                    {INCOME_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Dependants */}
              <div className="space-y-2">
                <Label htmlFor="dependants">Number of dependants</Label>
                <Input
                  id="dependants"
                  type="number"
                  min={0}
                  step={1}
                  value={step1.dependants}
                  onChange={(e) =>
                    setStep1({
                      ...step1,
                      dependants: Math.max(0, parseInt(e.target.value) || 0),
                    })
                  }
                />
              </div>

              {/* Monthly Expenses */}
              <div className="space-y-2">
                <Label htmlFor="expenses">Monthly outgoings</Label>
                <p className="text-sm text-muted-foreground">
                  Rent, bills, food, subscriptions — everything that goes out each month
                </p>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    $
                  </span>
                  <Input
                    id="expenses"
                    type="number"
                    min={0}
                    step={0.01}
                    className="pl-7"
                    placeholder="0.00"
                    value={step1.monthly_expenses}
                    onChange={(e) =>
                      setStep1({ ...step1, monthly_expenses: e.target.value })
                    }
                  />
                </div>
              </div>

              {/* Total Debt */}
              <div className="space-y-2">
                <Label htmlFor="debt">Total outstanding debt</Label>
                <p className="text-sm text-muted-foreground">
                  Credit cards, loans, car finance. Exclude mortgage. Enter 0 if none.
                </p>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    $
                  </span>
                  <Input
                    id="debt"
                    type="number"
                    min={0}
                    step={0.01}
                    className="pl-7"
                    placeholder="0.00"
                    value={step1.total_debt}
                    onChange={(e) =>
                      setStep1({ ...step1, total_debt: e.target.value })
                    }
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 2: Financial Foundation ────────────────────────────── */}
          {currentStep === 2 && (
            <div className="space-y-5">
              {/* Emergency Fund */}
              <div className="space-y-2">
                <Label>
                  How many months of expenses do you have saved as an emergency fund?
                </Label>
                <Select
                  value={step2.emergency_fund_months}
                  onValueChange={(v) =>
                    setStep2({ ...step2, emergency_fund_months: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select months saved" />
                  </SelectTrigger>
                  <SelectContent>
                    {EMERGENCY_FUND_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Monthly Investable */}
              <div className="space-y-2">
                <Label htmlFor="investable">
                  How much can you realistically invest each month?
                </Label>
                <p className="text-sm text-muted-foreground">
                  After all bills, expenses, and a buffer — what's left over?
                </p>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    $
                  </span>
                  <Input
                    id="investable"
                    type="number"
                    min={0}
                    step={0.01}
                    className="pl-7"
                    placeholder="0.00"
                    value={step2.monthly_investable}
                    onChange={(e) =>
                      setStep2({ ...step2, monthly_investable: e.target.value })
                    }
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 3: Risk Profile Quiz ──────────────────────────────── */}
          {currentStep === 3 && (
            <div className="space-y-6">
              {computedRisk ? (
                /* Show result */
                <div className="text-center space-y-4 py-4">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                    <Shield className="h-7 w-7 text-primary" />
                  </div>
                  <h3 className="text-xl font-semibold capitalize">
                    {computedRisk} Investor
                  </h3>
                  <p className="text-muted-foreground max-w-md mx-auto">
                    {riskProfileDescription(computedRisk)}
                  </p>
                </div>
              ) : (
                /* Show questions */
                RISK_QUESTIONS.map((q, qi) => {
                  const key = `q${qi + 1}` as keyof RiskQuizAnswers;
                  return (
                    <fieldset key={qi} className="space-y-3">
                      <legend className="text-base font-medium text-foreground">
                        {qi + 1}. {q.question}
                      </legend>
                      <RadioGroup
                        value={
                          quizAnswers[key] > 0
                            ? String(quizAnswers[key])
                            : undefined
                        }
                        onValueChange={(v) =>
                          setQuizAnswers({ ...quizAnswers, [key]: parseInt(v) })
                        }
                        className="space-y-2"
                      >
                        {q.options.map((opt, oi) => (
                          <div
                            key={oi}
                            className="flex items-center space-x-2 p-3 rounded-lg border border-input hover:bg-accent cursor-pointer"
                          >
                            <RadioGroupItem
                              value={String(opt.score)}
                              id={`q${qi}-o${oi}`}
                            />
                            <Label
                              htmlFor={`q${qi}-o${oi}`}
                              className="cursor-pointer flex-1"
                            >
                              {opt.label}
                            </Label>
                          </div>
                        ))}
                      </RadioGroup>
                    </fieldset>
                  );
                })
              )}
            </div>
          )}

          {/* ── STEP 4: Investment Horizon ─────────────────────────────── */}
          {currentStep === 4 && (
            <div className="space-y-4">
              <Label className="text-base font-medium">
                What is your primary investment time horizon?
              </Label>
              <RadioGroup
                value={horizon}
                onValueChange={(v) => setHorizon(v as InvestmentHorizon)}
                className="space-y-3"
              >
                {HORIZON_OPTIONS.map((o) => (
                  <div
                    key={o.value}
                    className="flex items-center space-x-2 p-4 rounded-lg border border-input hover:bg-accent cursor-pointer"
                  >
                    <RadioGroupItem value={o.value} id={`hz-${o.value}`} />
                    <Label
                      htmlFor={`hz-${o.value}`}
                      className="cursor-pointer flex-1"
                    >
                      <div className="font-medium">{o.label}</div>
                      <div className="text-sm text-muted-foreground">
                        {o.description}
                      </div>
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>
          )}

          {/* ── STEP 5: Goals ──────────────────────────────────────────── */}
          {currentStep === 5 && (
            <div className="space-y-6">
              {goals.map((goal, gi) => (
                <div
                  key={goal.id}
                  className="space-y-4 p-4 rounded-lg border border-input relative"
                >
                  {goals.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeGoal(goal.id)}
                      className="absolute top-3 right-3 text-muted-foreground hover:text-destructive"
                      aria-label="Remove goal"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}

                  <p className="text-sm font-medium text-muted-foreground">
                    Goal {gi + 1}
                  </p>

                  {/* Goal name quick-select */}
                  <div className="space-y-2">
                    <Label>Goal type</Label>
                    <div className="flex flex-wrap gap-2">
                      {GOAL_PRESETS.map((preset) => (
                        <Button
                          key={preset}
                          type="button"
                          size="sm"
                          variant={goal.goal_name === preset ? "default" : "outline"}
                          onClick={() => updateGoal(goal.id, "goal_name", preset)}
                        >
                          {preset}
                        </Button>
                      ))}
                    </div>
                  </div>

                  {/* Custom name if Other */}
                  {goal.goal_name === "Other" && (
                    <div className="space-y-2">
                      <Label htmlFor={`custom-${goal.id}`}>Goal name</Label>
                      <Input
                        id={`custom-${goal.id}`}
                        placeholder="e.g. Travel fund, Car, Wedding"
                        value={goal.custom_name}
                        onChange={(e) =>
                          updateGoal(goal.id, "custom_name", e.target.value)
                        }
                      />
                    </div>
                  )}

                  {/* Target Amount */}
                  <div className="space-y-2">
                    <Label htmlFor={`amount-${goal.id}`}>Target amount</Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                        $
                      </span>
                      <Input
                        id={`amount-${goal.id}`}
                        type="number"
                        min={0}
                        step={0.01}
                        className="pl-7"
                        placeholder="0.00"
                        value={goal.target_amount}
                        onChange={(e) =>
                          updateGoal(goal.id, "target_amount", e.target.value)
                        }
                      />
                    </div>
                  </div>

                  {/* Target Date */}
                  <div className="space-y-2">
                    <Label htmlFor={`date-${goal.id}`}>
                      Target date (optional)
                    </Label>
                    <Input
                      id={`date-${goal.id}`}
                      type="date"
                      min={getTodayStr()}
                      value={goal.target_date}
                      onChange={(e) =>
                        updateGoal(goal.id, "target_date", e.target.value)
                      }
                    />
                  </div>

                  {/* Monthly Contribution */}
                  <div className="space-y-2">
                    <Label htmlFor={`contrib-${goal.id}`}>
                      Monthly contribution toward this goal (optional)
                    </Label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                        $
                      </span>
                      <Input
                        id={`contrib-${goal.id}`}
                        type="number"
                        min={0}
                        step={0.01}
                        className="pl-7"
                        placeholder="0.00"
                        value={goal.monthly_contribution}
                        onChange={(e) =>
                          updateGoal(
                            goal.id,
                            "monthly_contribution",
                            e.target.value
                          )
                        }
                      />
                    </div>
                  </div>
                </div>
              ))}

              {goals.length < 5 && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={addGoal}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add another goal
                </Button>
              )}
            </div>
          )}

          {/* ── Navigation ────────────────────────────────────────────── */}
          <div className="flex justify-between pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={handleBack}
              disabled={currentStep === 1 || isSubmitting}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>

            {currentStep < totalSteps ? (
              <Button
                type="button"
                onClick={handleNext}
                disabled={!canProceed() || isSubmitting}
              >
                {currentStep === 3 && !computedRisk ? "See Result" : "Next"}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={!canProceed() || isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Setting up...
                  </>
                ) : (
                  <>
                    Complete Setup
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Onboarding;
