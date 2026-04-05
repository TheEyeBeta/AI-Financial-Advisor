import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
  AlertTriangle,
  Calendar,
  Database,
  Globe,
  Loader2,
  Mail,
  RefreshCw,
  Save,
  Settings2,
  Shield,
  Sparkles,
  User,
  Zap,
} from "lucide-react";

import { AppLayout } from "@/components/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "@/hooks/use-toast";
import { useDataSource, type DataSource } from "@/hooks/use-data-source";
import { getErrorMessage } from "@/lib/error";
import { supabase } from "@/lib/supabase";
import { refreshIrisContextCache } from "@/services/iris-cache";
import { cn } from "@/lib/utils";

const EXPERIENCE_OPTIONS = [
  {
    value: "beginner",
    label: "Beginner",
    description: "Simpler explanations, stronger guidance, and foundational investing support.",
  },
  {
    value: "intermediate",
    label: "Intermediate",
    description: "Balanced discussion around portfolio construction, market context, and tradeoffs.",
  },
  {
    value: "advanced",
    label: "Advanced",
    description: "Higher-signal analysis, more nuanced market discussion, and sharper portfolio reasoning.",
  },
] as const;

const RISK_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "mid", label: "Moderate" },
  { value: "high", label: "High" },
  { value: "very_high", label: "Very High" },
] as const;

const formatRiskLevel = (riskLevel: string | null | undefined): string => {
  if (!riskLevel) return "Not set";
  if (riskLevel === "very_high") return "Very High";
  if (riskLevel === "mid") return "Moderate";
  return riskLevel.charAt(0).toUpperCase() + riskLevel.slice(1);
};

const validateAge = (value: string): string | null => {
  if (!value.trim()) return null;

  const parsedAge = Number(value);
  if (!Number.isInteger(parsedAge) || parsedAge < 18 || parsedAge > 150) {
    return "Age must be between 18 and 150.";
  }

  return null;
};

const Profile = () => {
  const { user, userProfile, profileLoading, refreshProfile } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  const [firstName, setFirstName] = useState(userProfile?.first_name || "");
  const [lastName, setLastName] = useState(userProfile?.last_name || "");
  const [age, setAge] = useState(userProfile?.age?.toString() || "");
  const [ageError, setAgeError] = useState<string | null>(null);
  const [experienceLevel, setExperienceLevel] = useState(userProfile?.experience_level || "beginner");
  const [riskLevel, setRiskLevel] = useState(userProfile?.risk_level || "mid");
  const [_riskOverride, _setRiskOverride] = useState(false);
  const [showRiskOverride, setShowRiskOverride] = useState(false);

  useEffect(() => {
    if (userProfile) {
      setFirstName(userProfile.first_name || "");
      setLastName(userProfile.last_name || "");
      setAge(userProfile.age?.toString() || "");
      setAgeError(null);
      setExperienceLevel(userProfile.experience_level || "beginner");
      setRiskLevel(userProfile.risk_level || "mid");
    }
  }, [userProfile]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile?.id) return;

    setIsSaving(true);
    try {
      const nextAgeError = validateAge(age);
      if (nextAgeError) {
        setAgeError(nextAgeError);
        return;
      }

      const updates: {
        first_name?: string;
        last_name?: string;
        age?: number;
        experience_level?: string;
        risk_level?: string;
      } = {};

      if (firstName.trim()) updates.first_name = firstName.trim();
      if (lastName.trim()) updates.last_name = lastName.trim();
      if (age) {
        const ageNum = parseInt(age, 10);
        if (ageNum >= 13 && ageNum <= 150) {
          updates.age = ageNum;
        }
      }
      if (experienceLevel) updates.experience_level = experienceLevel;
      if (riskLevel) {
        updates.risk_level = riskLevel as "low" | "mid" | "high" | "very_high";
      }

      const { error } = await supabase
        .schema("core")
        .from("users")
        .update(updates)
        .eq("id", userProfile.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Profile updated successfully",
      });

      await refreshProfile();
      // Keep IRIS AI context in sync with profile changes
      if (user?.id) refreshIrisContextCache(user.id);
    } catch (error: unknown) {
      toast({
        title: "Error",
        description: getErrorMessage(error) || "Failed to update profile",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (profileLoading) {
    return (
      <AppLayout title="Profile">
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="animate-pulse rounded-[30px] border border-border/60 bg-card/90 p-6">
            <div className="h-4 w-24 rounded-full bg-muted/70" />
            <div className="mt-4 h-10 w-72 rounded-full bg-muted/70" />
            <div className="mt-3 h-4 w-full max-w-xl rounded-full bg-muted/60" />
          </div>
          <div className="grid gap-6 xl:grid-cols-[340px,minmax(0,1fr)]">
            <div className="space-y-6">
              <div className="h-64 rounded-[28px] border border-border/60 bg-card/80" />
              <div className="h-72 rounded-[28px] border border-border/60 bg-card/80" />
            </div>
            <div className="h-[560px] rounded-[28px] border border-border/60 bg-card/80" />
          </div>
        </div>
      </AppLayout>
    );
  }

  const displayName = [firstName || userProfile?.first_name, lastName || userProfile?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  const heading = displayName || user?.email?.split("@")[0] || "Your profile";
  const memberSince = userProfile?.created_at ? format(new Date(userProfile.created_at), "MMMM d, yyyy") : "N/A";
  const selectedExperience = EXPERIENCE_OPTIONS.find((option) => option.value === experienceLevel);

  return (
    <AppLayout title="Profile">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="relative overflow-hidden rounded-[30px] border border-border/60 bg-card/95 p-6 shadow-[0_24px_70px_-52px_rgba(15,23,42,0.45)] animate-in fade-in duration-300">
          <div className="absolute inset-x-0 top-0 h-28 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.16),transparent_58%)]" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-muted/50 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                <Settings2 className="h-3.5 w-3.5" />
                Profile & Settings
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                {heading}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                Manage the identity, preferences, and data context that shape how IRIS responds to you across the product.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {userProfile?.is_verified ? (
                <Badge className="rounded-full bg-emerald-500 px-3 py-1 text-[11px] text-white hover:bg-emerald-500">
                  Verified account
                </Badge>
              ) : (
                <Badge variant="secondary" className="rounded-full px-3 py-1 text-[11px]">
                  Unverified account
                </Badge>
              )}
              {userProfile?.userType === "Admin" && (
                <Badge variant="outline" className="rounded-full px-3 py-1 text-[11px]">
                  <Shield className="mr-1 h-3 w-3" />
                  Admin access
                </Badge>
              )}
              <Badge variant="outline" className="rounded-full px-3 py-1 text-[11px]">
                Member since {memberSince}
              </Badge>
            </div>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[340px,minmax(0,1fr)]">
          <div className="space-y-6">
            <Card className="overflow-hidden rounded-[28px] border-border/60 bg-card/95 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.35)] animate-in fade-in duration-300">
              <CardHeader className="pb-5">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <User className="h-4 w-4 text-primary" />
                  Account Snapshot
                </CardTitle>
                <CardDescription>
                  Immutable account details and core status information.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <StaticDetail
                  icon={Mail}
                  label="Email"
                  value={user?.email || "N/A"}
                  note="Email cannot be changed here."
                />
                <StaticDetail
                  icon={Calendar}
                  label="Member Since"
                  value={memberSince}
                />
                <StaticDetail
                  icon={Sparkles}
                  label="Current Experience Level"
                  value={selectedExperience?.label || "Beginner"}
                  note={selectedExperience?.description}
                />
                <StaticDetail
                  icon={Shield}
                  label="Calculated Risk Tolerance"
                  value={formatRiskLevel(userProfile?.risk_level)}
                  note="Based on your profile data unless you manually override it below."
                />
              </CardContent>
            </Card>

            <DataSourceCard />
          </div>

          <Card className="overflow-hidden rounded-[28px] border-border/60 bg-card/95 shadow-[0_24px_70px_-52px_rgba(15,23,42,0.4)] animate-in fade-in duration-300">
            <CardHeader className="border-b border-border/60 pb-5">
              <CardTitle className="text-lg">Personalization</CardTitle>
              <CardDescription>
                These settings tune the tone, depth, and risk framing of your advisor experience.
              </CardDescription>
            </CardHeader>

            <form onSubmit={handleSave}>
              <CardContent className="space-y-8 pt-6">
                <section className="space-y-5">
                  <SectionHeading
                    title="Personal details"
                    description="Keep your name and age current so guidance stays relevant to your stage."
                  />

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="firstName">First Name</Label>
                      <Input
                        id="firstName"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        placeholder="Enter your first name"
                        className="h-11 rounded-xl border-border/60 bg-background/70"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lastName">Last Name</Label>
                      <Input
                        id="lastName"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        placeholder="Enter your last name"
                        className="h-11 rounded-xl border-border/60 bg-background/70"
                      />
                    </div>
                  </div>

                  <div className="max-w-xs space-y-2">
                    <Label htmlFor="age">Age</Label>
                    <Input
                      id="age"
                      type="number"
                      min="18"
                      max="150"
                      value={age}
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        setAge(nextValue);
                        setAgeError(validateAge(nextValue));
                      }}
                      placeholder="Enter your age"
                      className={cn(
                        "h-11 rounded-xl border-border/60 bg-background/70",
                        ageError && "border-destructive/60 focus-visible:ring-destructive/40",
                      )}
                    />
                    <p className={cn("text-xs", ageError ? "text-destructive" : "text-muted-foreground")}>
                      {ageError || "Must be between 18 and 150."}
                    </p>
                  </div>
                </section>

                <section className="space-y-5">
                  <SectionHeading
                    title="Advisor defaults"
                    description="Choose how advanced the product should feel before you even type your first prompt."
                  />

                  <div className="grid gap-6 lg:grid-cols-2">
                    <div className="rounded-[24px] border border-border/60 bg-background/60 p-5">
                      <div className="space-y-2">
                        <Label htmlFor="experienceLevel">Experience Level</Label>
                        <Select value={experienceLevel} onValueChange={setExperienceLevel}>
                          <SelectTrigger id="experienceLevel" className="h-11 rounded-xl border-border/60 bg-card">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {EXPERIENCE_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs leading-5 text-muted-foreground">
                          {selectedExperience?.description || "Used to personalize advisor responses."}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-[24px] border border-border/60 bg-background/60 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <Label htmlFor="riskLevel">Risk Tolerance</Label>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            Override only if you want to manually steer the system away from your calculated profile.
                          </p>
                        </div>
                        {!showRiskOverride && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowRiskOverride(true)}
                            className="h-auto rounded-full px-3 py-1.5 text-xs"
                          >
                            <RefreshCw className="mr-1 h-3 w-3" />
                            Override
                          </Button>
                        )}
                      </div>

                      {showRiskOverride ? (
                        <div className="mt-4 space-y-3">
                          <Select value={riskLevel} onValueChange={setRiskLevel}>
                            <SelectTrigger id="riskLevel" className="h-11 rounded-xl border-border/60 bg-card">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {RISK_OPTIONS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          <div className="rounded-[18px] border border-yellow-300/70 bg-yellow-50 px-4 py-3 dark:border-yellow-900 dark:bg-yellow-950/30">
                            <div className="flex items-start gap-2">
                              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-700 dark:text-yellow-300" />
                              <p className="text-xs leading-5 text-yellow-800 dark:text-yellow-100">
                                You are manually overriding the calculated risk level. This can make recommendations feel less aligned with your underlying profile.
                              </p>
                            </div>
                          </div>

                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              setShowRiskOverride(false);
                              setRiskLevel(userProfile?.risk_level || "mid");
                            }}
                            className="w-full rounded-xl"
                          >
                            Use Calculated Risk Level
                          </Button>
                        </div>
                      ) : (
                        <div className="mt-4 rounded-[18px] border border-border/60 bg-card p-4">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-medium text-foreground">
                              {formatRiskLevel(userProfile?.risk_level)}
                            </span>
                            <Badge variant="outline" className="rounded-full text-[11px]">
                              Algorithm calculated
                            </Badge>
                          </div>
                          <p className="mt-2 text-xs leading-5 text-muted-foreground">
                            Based on your age, marital status, and investment goals.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              </CardContent>

              <CardFooter className="flex flex-col gap-3 border-t border-border/60 bg-background/40 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  Saving updates the preferences IRIS uses for personalization.
                </p>
                <Button type="submit" disabled={isSaving} className="rounded-full px-5">
                  {isSaving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Save Changes
                    </>
                  )}
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
};

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}

function StaticDetail({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="rounded-[20px] border border-border/60 bg-background/60 p-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="mt-3 break-words text-sm font-medium text-foreground">{value}</p>
      {note && <p className="mt-2 text-xs leading-5 text-muted-foreground">{note}</p>}
    </div>
  );
}

function DataSourceCard() {
  const { dataSource, setDataSource } = useDataSource();

  const handleChange = (value: string) => {
    setDataSource(value as DataSource);
    toast({
      title: "Data source updated",
      description:
        value === "supabase"
          ? "Using Supabase (cloud) as your data source."
          : value === "dataapi"
            ? "Using The Eye DataAPI (live engine) as your data source."
            : "Auto mode: tries DataAPI first, falls back to Supabase.",
    });
  };

  const sourceMeta = getDataSourceMeta(dataSource);

  return (
    <Card className="overflow-hidden rounded-[28px] border-border/60 bg-card/95 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.35)] animate-in fade-in duration-300">
      <CardHeader className="pb-5">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Database className="h-4 w-4 text-primary" />
          Data Source
        </CardTitle>
        <CardDescription>
          Choose where market data, signals, and analytics come from.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Current Source</Label>
          <Select value={dataSource} onValueChange={handleChange}>
            <SelectTrigger className="h-11 rounded-xl border-border/60 bg-background/70">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="supabase">
                <span className="flex items-center gap-2">
                  <Globe className="h-3.5 w-3.5" />
                  Supabase (Cloud)
                </span>
              </SelectItem>
              <SelectItem value="dataapi">
                <span className="flex items-center gap-2">
                  <Zap className="h-3.5 w-3.5" />
                  The Eye DataAPI (Live)
                </span>
              </SelectItem>
              <SelectItem value="auto">
                <span className="flex items-center gap-2">
                  <RefreshCw className="h-3.5 w-3.5" />
                  Auto (DataAPI with fallback)
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className={cn("rounded-[20px] border px-4 py-4", sourceMeta.panelClassName)}>
          <div className="flex items-center gap-2">
            <sourceMeta.icon className="h-4 w-4" />
            <p className="text-sm font-medium">{sourceMeta.title}</p>
          </div>
          <p className="mt-2 text-xs leading-5 opacity-90">{sourceMeta.description}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function getDataSourceMeta(dataSource: DataSource) {
  switch (dataSource) {
    case "dataapi":
      return {
        icon: Zap,
        title: "Live engine mode",
        description:
          "The Eye DataAPI provides live data directly from the trade engine. Best when the DataAPI service is healthy and reachable.",
        panelClassName: "border-emerald-300/60 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100",
      };
    case "auto":
      return {
        icon: RefreshCw,
        title: "Automatic fallback mode",
        description:
          "Auto mode tries The Eye DataAPI first for freshness, then falls back to Supabase if the live service is unavailable.",
        panelClassName: "border-blue-300/60 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100",
      };
    case "supabase":
    default:
      return {
        icon: Globe,
        title: "Cloud snapshot mode",
        description:
          "Supabase serves synced market snapshots from the cloud database. This is the default and most stable option.",
        panelClassName: "border-border/60 bg-background/70 text-foreground",
      };
  }
}

export default Profile;
