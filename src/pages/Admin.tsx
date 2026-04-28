import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Users, Shield, Database, MessageSquare, TrendingUp,
  Activity, Search, Download, Trash2, RefreshCw,
  BarChart3, UserCheck, UserX, Clock, Heart, Server,
  Wifi, WifiOff, Loader2, Play, Terminal, ArrowUpRight, Sparkles, ShieldCheck, AlertTriangle
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { getPythonApiUrl } from "@/lib/env";
import { supabase } from "@/lib/supabase";
import { useState, useEffect, useCallback } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/error";
import { SupabaseConnectionTest } from "@/utils/test-connection";
import { format } from "date-fns";
import { adminApi, type SchedulerJob } from "@/services/api";

interface User {
  id: string;
  auth_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  userType: 'User' | 'Admin';
  is_verified: boolean | null;
  experience_level: string | null;
  risk_level: string | null;
  created_at: string;
}

interface ChatStats {
  totalChats: number;
  totalMessages: number;
  activeToday: number;
}

interface TradingStats {
  totalPositions: number;
  totalTrades: number;
  totalJournalEntries: number;
}

interface ActivityLog {
  id: string;
  user_email: string;
  action: string;
  timestamp: string;
}

interface EngagementStats {
  avgMessagesPerChat: number;
  weeklyActiveChats: number;
  lessonsStarted: number;
  journalEntries: number;
  quizAttempts: number;
  retentionRate: number;
}

const EXPERIENCE_STYLES: Record<string, string> = {
  beginner: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
  intermediate: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20",
  advanced: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20",
  default: "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/20",
};

const getExperienceStyle = (experienceLevel: string | null) => {
  const normalizedExperienceLevel = experienceLevel?.trim().toLowerCase() || "default";
  return EXPERIENCE_STYLES[normalizedExperienceLevel] || EXPERIENCE_STYLES.default;
};

const safeFormatDate = (timestamp: unknown, dateFormat: string, fallback = "Waiting for data") => {
  if (timestamp === null || timestamp === undefined || timestamp === "") return fallback;

  const date = timestamp instanceof Date ? timestamp : new Date(timestamp as string | number);
  return Number.isNaN(date.getTime()) ? fallback : format(date, dateFormat);
};

const formatPercentage = (value: number, total: number) => {
  if (!total) return 0;
  return Math.round((value / total) * 100);
};

const getOverallTone = (overall?: string) => {
  switch (overall) {
    case "healthy":
      return {
        badgeClassName: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
        panelClassName: "border-emerald-500/30 bg-emerald-500/5",
        icon: Wifi,
        label: "All systems operational",
      };
    case "degraded":
      return {
        badgeClassName: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20",
        panelClassName: "border-amber-500/30 bg-amber-500/5",
        icon: AlertTriangle,
        label: "Degraded performance detected",
      };
    default:
      return {
        badgeClassName: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20",
        panelClassName: "border-rose-500/30 bg-rose-500/5",
        icon: WifiOff,
        label: "Action required",
      };
  }
};


interface ScheduledJobDef {
  id: string;
  name: string;
  schedule: string;
  overdueSeconds: number | null;
}

const SCHEDULED_JOB_DEFS: ScheduledJobDef[] = [
  { id: "ranking", name: "Ranking Engine", schedule: "Daily at 01:00 UTC", overdueSeconds: 90000 },
  { id: "memory_extraction", name: "Memory Extraction", schedule: "Every 15 minutes", overdueSeconds: 1200 },
  { id: "intelligence", name: "Intelligence Engine", schedule: "Every 6 hours", overdueSeconds: 25200 },
  { id: "meridian_refresh", name: "Meridian Context Refresh", schedule: "On demand / cache miss", overdueSeconds: null },
];

const formatRelativeTime = (timestamp: string | null): string => {
  if (!timestamp) return "Never";
  const ms = Date.now() - new Date(timestamp).getTime();
  if (Number.isNaN(ms)) return "Never";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const getJobHealth = (lastRun: string | null, overdueSeconds: number | null): "healthy" | "warning" | "unknown" => {
  if (!lastRun) return "unknown";
  if (overdueSeconds === null) return "healthy";
  const secondsAgo = (Date.now() - new Date(lastRun).getTime()) / 1000;
  return secondsAgo <= overdueSeconds ? "healthy" : "warning";
};

export default function Admin() {
  const { userProfile } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<User[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [chatStats, setChatStats] = useState<ChatStats>({ totalChats: 0, totalMessages: 0, activeToday: 0 });
  const [tradingStats, setTradingStats] = useState<TradingStats>({ totalPositions: 0, totalTrades: 0, totalJournalEntries: 0 });
  const [recentActivity, setRecentActivity] = useState<ActivityLog[]>([]);
  const [engagementStats, setEngagementStats] = useState<EngagementStats>({
    avgMessagesPerChat: 0,
    weeklyActiveChats: 0,
    lessonsStarted: 0,
    journalEntries: 0,
    quizAttempts: 0,
    retentionRate: 0,
  });

  // System Health state
  const [systemHealth, setSystemHealth] = useState<Record<string, unknown> | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [queryInput, setQueryInput] = useState("");
  const [queryResults, setQueryResults] = useState<Record<string, unknown> | null>(null);
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);

  const [schedulerJobs, setSchedulerJobs] = useState<SchedulerJob[]>([]);
  const [schedulerLoading, setSchedulerLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("users");
  const [jobStatuses, setJobStatuses] = useState<Record<string, "idle" | "running" | "success" | "error">>({});
  const [jobMessages, setJobMessages] = useState<Record<string, string>>({});

  const [purgeLoading, setPurgeLoading] = useState(false);
  const [purgeResult, setPurgeResult] = useState<{ deleted: number; failed: number } | null>(null);

  const BACKEND_URL = getPythonApiUrl();
  /** Get the current Supabase access token for authenticated admin requests. */
  const getAuthHeaders = async (): Promise<HeadersInit> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      throw new Error("Not authenticated — please sign in again");
    }
    return {
      "Authorization": `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    };
  };

  const fetchSystemHealth = async () => {
    setHealthLoading(true);
    try {
      const headers = await getAuthHeaders();
      const resp = await fetch(`${BACKEND_URL}/api/admin/system-health`, { headers });
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(body || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      setSystemHealth(data);
    } catch (err) {
      console.error("System health check failed:", err);
      // Backend unreachable — check Supabase directly so the status reflects
      // reality rather than defaulting to a generic "error" with no timestamp.
      const { error: sbError } = await supabase
        .schema("core")
        .from("users")
        .select("id", { count: "exact", head: true });
      setSystemHealth({
        overall: sbError ? "down" : "degraded",
        timestamp: new Date().toISOString(),
        services: {
          supabase: { status: sbError ? "error" : "connected" },
          backend: { status: "error", message: "Health check endpoint unreachable" },
        },
      });
    } finally {
      setHealthLoading(false);
    }
  };

  const runQuery = async (sql?: string) => {
    const q = sql || queryInput.trim();
    if (!q) return;
    if (sql) setQueryInput(sql);
    setQueryLoading(true);
    setQueryError(null);
    setQueryResults(null);
    try {
      const headers = await getAuthHeaders();
      const resp = await fetch(
        `${BACKEND_URL}/api/admin/dataapi-query?q=${encodeURIComponent(q)}&limit=100`,
        { headers }
      );
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(body || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      setQueryResults(data);
    } catch (err) {
      setQueryError(String(err));
    } finally {
      setQueryLoading(false);
    }
  };

  useEffect(() => {
    if (searchQuery) {
      const filtered = users.filter(
        (u) =>
          u.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          u.first_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          u.last_name?.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setFilteredUsers(filtered);
    } else {
      setFilteredUsers(users);
    }
  }, [searchQuery, users]);

  const loadAllData = useCallback(async () => {
    setLoading(true);
    await Promise.all([
      fetchUsers(),
      fetchChatStats(),
      fetchTradingStats(),
      fetchEngagementStats(),
      fetchSystemHealth(),
    ]);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadAllData();
    setRefreshing(false);
    toast({ title: "Refreshed", description: "All data has been refreshed" });
  };

  const fetchUsers = async () => {
    try {
      const { data, error } = await supabase
        .schema("core")
        .from("users")
        .select("id, auth_id, email, first_name, last_name, userType, is_verified, experience_level, risk_level, created_at")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setUsers(data || []);
      setFilteredUsers(data || []);
    } catch (error: unknown) {
      console.error("Error fetching users:", error);
    }
  };

  const fetchChatStats = async () => {
    try {
      const today = new Date().toISOString().split("T")[0];
      const [chatsResult, messagesResult, activeTodayResult, recentResult] = await Promise.all([
        supabase.schema("ai").from("chats").select("id", { count: "exact", head: true }),
        supabase.schema("ai").from("chat_messages").select("id", { count: "exact", head: true }),
        supabase.schema("ai").from("chats").select("id", { count: "exact", head: true }).gte("updated_at", today),
        supabase.schema("ai").from("chat_messages").select("id, user_id, role, created_at").order("created_at", { ascending: false }).limit(10),
      ]);

      setChatStats({
        totalChats: chatsResult.count ?? 0,
        totalMessages: messagesResult.count ?? 0,
        activeToday: activeTodayResult.count ?? 0,
      });

      setRecentActivity(
        (recentResult.data ?? []).map((msg) => ({
          id: msg.id as string,
          user_email: "User",
          action: msg.role === "user" ? "Sent message" : "Received AI response",
          timestamp: msg.created_at as string,
        }))
      );
    } catch (error) {
      console.error("Error fetching chat stats:", error);
    }
  };

  const fetchTradingStats = async () => {
    try {
      const [positionsResult, tradesResult, journalResult] = await Promise.all([
        supabase.schema("trading").from("open_positions").select("id", { count: "exact", head: true }),
        supabase.schema("trading").from("trades").select("id", { count: "exact", head: true }),
        supabase.schema("trading").from("trade_journal").select("id", { count: "exact", head: true }),
      ]);

      setTradingStats({
        totalPositions: positionsResult.count || 0,
        totalTrades: tradesResult.count || 0,
        totalJournalEntries: journalResult.count || 0,
      });
    } catch (error) {
      console.error("Error fetching trading stats:", error);
    }
  };

  const fetchEngagementStats = async () => {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const [chatsRes, msgsRes, weeklyActiveRes, lessonProgressRes, journalRes, quizRes] = await Promise.all([
        supabase.schema("ai").from("chats").select("id", { count: "exact", head: true }),
        supabase.schema("ai").from("chat_messages").select("id", { count: "exact", head: true }),
        supabase.schema("ai").from("chats").select("id", { count: "exact", head: true }).gte("updated_at", sevenDaysAgo),
        supabase.schema("academy").from("user_lesson_progress").select("id", { count: "exact", head: true }),
        supabase.schema("trading").from("trade_journal").select("id", { count: "exact", head: true }),
        supabase.schema("academy").from("quiz_attempts").select("id", { count: "exact", head: true }),
      ]);

      setEngagementStats({
        avgMessagesPerChat: chatsRes.count && msgsRes.count ? Math.round(msgsRes.count / chatsRes.count) : 0,
        weeklyActiveChats: weeklyActiveRes.count ?? 0,
        lessonsStarted: lessonProgressRes.count ?? 0,
        journalEntries: journalRes.count ?? 0,
        quizAttempts: quizRes.count ?? 0,
        retentionRate: chatsRes.count ? Math.round(((weeklyActiveRes.count ?? 0) / chatsRes.count) * 100) : 0,
      });
    } catch (error) {
      console.error("Error fetching engagement stats:", error);
    }
  };

  const toggleAdminStatus = async (userId: string, currentType: 'User' | 'Admin') => {
    const newType = currentType === 'Admin' ? 'User' : 'Admin';
    try {
      const { error } = await supabase
        .schema("core")
        .from("users")
        .update({ userType: newType })
        .eq("id", userId);

      if (error) throw error;

      toast({
        title: "Success",
        description: `User ${newType === 'Admin' ? "promoted to" : "demoted from"} admin`,
      });

      fetchUsers();
    } catch (error: unknown) {
      console.error("Error updating admin status:", error);
      toast({
        title: "Error",
        description: getErrorMessage(error) || "Failed to update admin status",
        variant: "destructive",
      });
    }
  };

  const deleteUser = async (userId: string, authId: string) => {
    try {
      if (BACKEND_URL && authId) {
        // Delete via the Auth Admin API so the email is fully released.
        // ON DELETE CASCADE propagates the deletion to core.users and all
        // child tables (ai.chats, trading.*, etc.).
        const headers = await getAuthHeaders();
        const resp = await fetch(`${BACKEND_URL}/api/admin/users/${authId}`, {
          method: "DELETE",
          headers,
        });
        if (!resp.ok) {
          const body = await resp.text();
          throw new Error(body || `HTTP ${resp.status}`);
        }
      } else {
        // Fallback when backend is not configured: direct Supabase deletion.
        // This removes app data but does NOT release the email in Supabase Auth.
        const { error: chatsError } = await supabase
          .schema("ai")
          .from("chats")
          .delete()
          .eq("user_id", userId);

        if (chatsError) throw chatsError;

        const { error } = await supabase
          .schema("core")
          .from("users")
          .delete()
          .eq("id", userId);

        if (error) throw error;
      }

      toast({
        title: "User Deleted",
        description: "User and all their data have been removed",
      });

      fetchUsers();
    } catch (error: unknown) {
      console.error("Error deleting user:", error);
      toast({
        title: "Error",
        description: getErrorMessage(error) || "Failed to delete user",
        variant: "destructive",
      });
    }
  };

  const purgeOrphanedAuthUsers = async () => {
    setPurgeLoading(true);
    setPurgeResult(null);
    try {
      const headers = await getAuthHeaders();
      const resp = await fetch(`${BACKEND_URL}/api/admin/purge-orphaned-auth-users`, {
        method: "POST",
        headers,
      });
      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(body || `HTTP ${resp.status}`);
      }
      const result = await resp.json() as { deleted: number; failed: number };
      setPurgeResult(result);
      toast({
        title: "Purge complete",
        description: `${result.deleted} orphaned auth record${result.deleted !== 1 ? "s" : ""} removed. Those emails are now available for re-registration.`,
      });
    } catch (error: unknown) {
      toast({
        title: "Purge failed",
        description: getErrorMessage(error) || "Failed to purge orphaned auth users",
        variant: "destructive",
      });
    } finally {
      setPurgeLoading(false);
    }
  };

  const exportUsers = () => {
    const csv = [
      ["ID", "Email", "First Name", "Last Name", "Verified", "Admin", "Experience", "Risk Level", "Created"],
      ...users.map((u) => [
        u.id,
        u.email || "",
        u.first_name || "",
        u.last_name || "",
        u.is_verified ? "Yes" : "No",
        u.userType === 'Admin' ? "Yes" : "No",
        u.experience_level || "",
        u.risk_level || "",
        new Date(u.created_at).toISOString(),
      ]),
    ]
      .map((row) => row.join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `users-export-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    toast({ title: "Exported", description: "User data exported to CSV" });
  };

  const fetchSchedulerStatus = useCallback(async () => {
    setSchedulerLoading(true);
    try {
      const data = await adminApi.getSchedulerStatus();
      setSchedulerJobs(data.jobs ?? []);
    } catch (err) {
      console.error("Scheduler status fetch failed:", err);
    } finally {
      setSchedulerLoading(false);
    }
  }, []);

  const triggerJob = async (jobId: string) => {
    setJobStatuses((prev) => ({ ...prev, [jobId]: "running" }));
    setJobMessages((prev) => ({ ...prev, [jobId]: "" }));
    try {
      if (jobId === "ranking") await adminApi.triggerRanking();
      else if (jobId === "memory_extraction") await adminApi.triggerMemoryExtraction();
      else if (jobId === "intelligence") await adminApi.triggerIntelligence();
      else if (jobId === "meridian_refresh") await adminApi.triggerMeridianRefresh();
      else throw new Error(`Unknown job: ${jobId}`);
      const time = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      setJobStatuses((prev) => ({ ...prev, [jobId]: "success" }));
      setJobMessages((prev) => ({ ...prev, [jobId]: `Completed at ${time}` }));
    } catch (err) {
      console.error(`Failed to trigger job ${jobId}:`, err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      setJobStatuses((prev) => ({ ...prev, [jobId]: "error" }));
      setJobMessages((prev) => ({ ...prev, [jobId]: `Failed: ${msg}` }));
    }
  };

  useEffect(() => {
    if (activeTab !== "scheduled-jobs") return;
    void fetchSchedulerStatus();
    const interval = setInterval(() => { void fetchSchedulerStatus(); }, 30000);
    return () => clearInterval(interval);
  }, [activeTab, fetchSchedulerStatus]);

  const stats = {
    totalUsers: users.length,
    adminUsers: users.filter((u) => u.userType === 'Admin').length,
    verifiedUsers: users.filter((u) => u.is_verified).length,
    beginners: users.filter((u) => u.experience_level === "beginner").length,
    intermediate: users.filter((u) => u.experience_level === "intermediate").length,
    advanced: users.filter((u) => u.experience_level === "advanced").length,
  };

  const verificationRate = formatPercentage(stats.verifiedUsers, stats.totalUsers);
  const adminCoverage = formatPercentage(stats.adminUsers, stats.totalUsers);
  const overallTone = getOverallTone(systemHealth?.overall);
  const OverallStatusIcon = overallTone.icon;
  const latestActivity = recentActivity[0];
  const userMix = [
    { label: "Beginner", value: stats.beginners, color: "bg-emerald-500" },
    { label: "Intermediate", value: stats.intermediate, color: "bg-amber-500" },
    { label: "Advanced", value: stats.advanced, color: "bg-rose-500" },
  ];

  return (
    <AppLayout title="Admin Panel">
      <div className="min-w-0 space-y-6">
        <section className="relative overflow-hidden rounded-3xl border bg-gradient-to-br from-background via-background to-muted/40 p-6 shadow-sm sm:p-8">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.14),transparent_38%)]" />
          <div className="relative flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="gap-1.5 rounded-full px-3 py-1 text-xs font-medium">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Admin workspace
                </Badge>
                {systemHealth && (
                  <Badge variant="outline" className={`gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${overallTone.badgeClassName}`}>
                    <OverallStatusIcon className="h-3.5 w-3.5" />
                    {overallTone.label}
                  </Badge>
                )}
              </div>

              <div className="space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Admin command center</h1>
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                  A cleaner operations view for managing members, monitoring product health, and checking platform activity without hopping between tools.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border bg-background/80 p-4 backdrop-blur-sm">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Verification rate</p>
                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div>
                      <p className="text-2xl font-semibold">{verificationRate}%</p>
                      <p className="text-xs text-muted-foreground">{stats.verifiedUsers} of {stats.totalUsers || 0} users verified</p>
                    </div>
                    <UserCheck className="h-8 w-8 text-primary/70" />
                  </div>
                </div>
                <div className="rounded-2xl border bg-background/80 p-4 backdrop-blur-sm">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Admin coverage</p>
                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div>
                      <p className="text-2xl font-semibold">{adminCoverage}%</p>
                      <p className="text-xs text-muted-foreground">{stats.adminUsers} admins available</p>
                    </div>
                    <Shield className="h-8 w-8 text-primary/70" />
                  </div>
                </div>
                <div className="rounded-2xl border bg-background/80 p-4 backdrop-blur-sm">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Latest activity</p>
                  <div className="mt-3 flex items-end justify-between gap-3">
                    <div>
                      <p className="line-clamp-1 text-sm font-semibold">{latestActivity?.action || "No recent events"}</p>
                      <p className="text-xs text-muted-foreground">
                        {safeFormatDate(latestActivity?.timestamp, "MMM d, h:mm a", "—")}
                      </p>
                    </div>
                    <Sparkles className="h-8 w-8 text-primary/70" />
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:w-[320px] xl:grid-cols-1">
              <Button onClick={handleRefresh} disabled={refreshing} className="w-full gap-2 rounded-xl px-4 shadow-sm sm:w-auto">
                <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                Refresh dashboard
              </Button>
              <Button onClick={exportUsers} variant="outline" className="w-full gap-2 rounded-xl px-4 sm:w-auto">
                <Download className="h-4 w-4" />
                Export users
              </Button>
              <div className="rounded-2xl border bg-background/80 p-4 text-sm backdrop-blur-sm sm:col-span-2 xl:col-span-1">
                <div className="flex items-center gap-2 font-medium">
                  <ArrowUpRight className="h-4 w-4 text-primary" />
                  Recommended focus
                </div>
                <p className="mt-2 text-muted-foreground">
                  Review verification gaps, spot activity drops, and check system health before making account-level changes.
                </p>
              </div>
            </div>
          </div>
        </section>

        <SupabaseConnectionTest />

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            {
              title: "Total users",
              value: stats.totalUsers,
              description: `${verificationRate}% verified accounts`,
              icon: Users,
            },
            {
              title: "Chats",
              value: chatStats.totalChats,
              description: `${chatStats.totalMessages} messages · ${chatStats.activeToday} active today`,
              icon: MessageSquare,
            },
            {
              title: "Trading activity",
              value: tradingStats.totalTrades + tradingStats.totalJournalEntries,
              description: `${tradingStats.totalTrades} trades · ${tradingStats.totalJournalEntries} journal logs`,
              icon: TrendingUp,
            },
            {
              title: "Admins",
              value: stats.adminUsers,
              description: "Permissioned operators",
              icon: Shield,
            },
          ].map((item) => (
            <Card key={item.title} className="rounded-2xl border-border/60 shadow-sm">
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
                <div className="space-y-1">
                  <CardDescription>{item.title}</CardDescription>
                  <CardTitle className="text-3xl">{item.value}</CardTitle>
                </div>
                <div className="rounded-xl bg-primary/10 p-2 text-primary">
                  <item.icon className="h-5 w-5" />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{item.description}</p>
              </CardContent>
            </Card>
          ))}
        </section>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-2 rounded-2xl bg-muted/60 p-1 md:grid-cols-5">
            <TabsTrigger value="users" className="min-h-[3.25rem] gap-2 rounded-xl px-2 py-2.5 text-center text-xs leading-tight whitespace-normal sm:min-h-0 sm:px-3 sm:text-sm sm:whitespace-nowrap">
              <Users className="h-4 w-4" />
              Users
            </TabsTrigger>
            <TabsTrigger value="analytics" className="min-h-[3.25rem] gap-2 rounded-xl px-2 py-2.5 text-center text-xs leading-tight whitespace-normal sm:min-h-0 sm:px-3 sm:text-sm sm:whitespace-nowrap">
              <BarChart3 className="h-4 w-4" />
              Analytics
            </TabsTrigger>
            <TabsTrigger value="activity" className="min-h-[3.25rem] gap-2 rounded-xl px-2 py-2.5 text-center text-xs leading-tight whitespace-normal sm:min-h-0 sm:px-3 sm:text-sm sm:whitespace-nowrap">
              <Activity className="h-4 w-4" />
              Activity
            </TabsTrigger>
            <TabsTrigger value="scheduled-jobs" className="min-h-[3.25rem] gap-2 rounded-xl px-2 py-2.5 text-center text-xs leading-tight whitespace-normal sm:min-h-0 sm:px-3 sm:text-sm sm:whitespace-nowrap">
              <Clock className="h-4 w-4" />
              Scheduled Jobs
            </TabsTrigger>
            <TabsTrigger value="system-health" className="min-h-[3.25rem] gap-2 rounded-xl px-2 py-2.5 text-center text-xs leading-tight whitespace-normal sm:min-h-0 sm:px-3 sm:text-sm sm:whitespace-nowrap">
              <Heart className="h-4 w-4" />
              System Health
            </TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="space-y-4">
            <Card className="rounded-3xl border-border/60 shadow-sm">
              <CardHeader className="space-y-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-1">
                    <CardTitle>User management</CardTitle>
                    <CardDescription>
                      Search, review, and update account roles from a denser but more readable table.
                    </CardDescription>
                  </div>
                  <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                    <div className="relative w-full sm:w-[280px]">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="Search by name or email"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="h-10 rounded-xl border-border/70 bg-background pl-9"
                      />
                    </div>
                    <Button onClick={exportUsers} variant="outline" className="w-full flex-shrink-0 gap-2 rounded-xl sm:w-auto">
                      <Download className="h-4 w-4" />
                      Export CSV
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border bg-muted/20 p-4">
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Verified</p>
                    <p className="mt-2 text-2xl font-semibold">{stats.verifiedUsers}</p>
                    <p className="text-xs text-muted-foreground">Accounts ready for feature access</p>
                  </div>
                  <div className="rounded-2xl border bg-muted/20 p-4">
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Unverified</p>
                    <p className="mt-2 text-2xl font-semibold">{stats.totalUsers - stats.verifiedUsers}</p>
                    <p className="text-xs text-muted-foreground">Candidates for onboarding outreach</p>
                  </div>
                  <div className="rounded-2xl border bg-muted/20 p-4">
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Search results</p>
                    <p className="mt-2 text-2xl font-semibold">{filteredUsers.length}</p>
                    <p className="text-xs text-muted-foreground">Visible records in the current view</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {loading ? (
                  <div className="rounded-2xl border border-dashed p-8 text-sm text-muted-foreground">Loading users…</div>
                ) : (
                  <>
                    <div className="overflow-hidden rounded-2xl border">
                      <div className="overflow-x-auto">
                        <Table className="min-w-[900px]">
                          <TableHeader>
                            <TableRow className="bg-muted/30">
                              <TableHead className="w-[16rem]">User</TableHead>
                              <TableHead className="hidden w-[18rem] md:table-cell">Email</TableHead>
                              <TableHead className="hidden w-[9rem] lg:table-cell">Experience</TableHead>
                              <TableHead className="w-[8rem]">Status</TableHead>
                              <TableHead className="w-[7rem]">Role</TableHead>
                              <TableHead className="hidden w-[8rem] xl:table-cell">Joined</TableHead>
                              <TableHead className="w-[10rem] text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filteredUsers.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                                  {searchQuery ? "No users match your search." : "No users found yet."}
                                </TableCell>
                              </TableRow>
                            ) : (
                              filteredUsers.map((user) => {
                                const fullName = user.first_name || user.last_name
                                  ? `${user.first_name || ""} ${user.last_name || ""}`.trim()
                                  : "No name";

                                return (
                                  <TableRow key={user.id} className="hover:bg-muted/20">
                                    <TableCell className="align-top">
                                      <div className="min-w-0 space-y-1">
                                        <div className="truncate font-medium">{fullName}</div>
                                        <div className="truncate text-xs text-muted-foreground md:hidden">
                                          {user.email || "N/A"}
                                        </div>
                                        <div className="text-xs text-muted-foreground">ID: {user.id.slice(0, 8)}…</div>
                                      </div>
                                    </TableCell>
                                    <TableCell className="hidden align-top md:table-cell">
                                      <span className="block truncate font-mono text-sm">{user.email || "N/A"}</span>
                                    </TableCell>
                                    <TableCell className="hidden align-top lg:table-cell">
                                      <Badge variant="outline" className={`capitalize ${getExperienceStyle(user.experience_level)}`}>
                                        {user.experience_level || "unknown"}
                                      </Badge>
                                    </TableCell>
                                    <TableCell className="align-top">
                                      {user.is_verified ? (
                                        <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                                          <UserCheck className="mr-1 h-3 w-3" />
                                          Verified
                                        </Badge>
                                      ) : (
                                        <Badge variant="secondary">
                                          <UserX className="mr-1 h-3 w-3" />
                                          Unverified
                                        </Badge>
                                      )}
                                    </TableCell>
                                    <TableCell className="align-top">
                                      {user.userType === 'Admin' ? (
                                        <Badge className="bg-blue-500/10 text-blue-700 dark:text-blue-300">
                                          <Shield className="mr-1 h-3 w-3" />
                                          Admin
                                        </Badge>
                                      ) : (
                                        <Badge variant="outline">User</Badge>
                                      )}
                                    </TableCell>
                                    <TableCell className="hidden align-top text-sm text-muted-foreground xl:table-cell">
                                      {safeFormatDate(user.created_at, "MMM d, yyyy")}
                                    </TableCell>
                                    <TableCell className="align-top text-right">
                                      <div className="flex flex-wrap justify-end gap-2">
                                        {user.id !== userProfile?.id && (
                                          <>
                                            <Button
                                              variant="outline"
                                              size="sm"
                                              className="rounded-lg"
                                              onClick={() => toggleAdminStatus(user.id, user.userType)}
                                            >
                                              {user.userType === 'Admin' ? "Demote" : "Promote"}
                                            </Button>
                                            <AlertDialog>
                                              <AlertDialogTrigger asChild>
                                                <Button
                                                  variant="destructive"
                                                  size="sm"
                                                  className="rounded-lg"
                                                  aria-label={`Delete user ${user.email || fullName}`}
                                                  title={`Delete user ${user.email || fullName}`}
                                                >
                                                  <Trash2 className="h-4 w-4" />
                                                </Button>
                                              </AlertDialogTrigger>
                                              <AlertDialogContent>
                                                <AlertDialogHeader>
                                                  <AlertDialogTitle>Delete user?</AlertDialogTitle>
                                                  <AlertDialogDescription>
                                                    This permanently deletes {user.email || "this user"} and all related chats, trades, and journal entries.
                                                  </AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                  <AlertDialogAction onClick={() => deleteUser(user.id, user.auth_id)}>
                                                    Delete
                                                  </AlertDialogAction>
                                                </AlertDialogFooter>
                                              </AlertDialogContent>
                                            </AlertDialog>
                                          </>
                                        )}
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                );
                              })
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Tip: use search to narrow the list before applying role changes or deletions.
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="analytics" className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              <Card className="rounded-3xl border-border/60 shadow-sm">
                <CardHeader>
                  <CardTitle>User experience mix</CardTitle>
                  <CardDescription>How your member base is distributed across skill levels.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  {userMix.map((segment) => (
                    <div key={segment.label} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <div className={`h-3 w-3 rounded-full ${segment.color}`} />
                          {segment.label}
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-semibold">{segment.value}</span>
                          <span className="ml-2 text-xs text-muted-foreground">{formatPercentage(segment.value, stats.totalUsers)}%</span>
                        </div>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full ${segment.color}`}
                          style={{ width: `${formatPercentage(segment.value, stats.totalUsers)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                  <Separator />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border bg-muted/20 p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Verified users</p>
                      <p className="mt-2 text-2xl font-semibold">{stats.verifiedUsers}</p>
                    </div>
                    <div className="rounded-2xl border bg-muted/20 p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Active chatters today</p>
                      <p className="mt-2 text-2xl font-semibold">{chatStats.activeToday}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-3xl border-border/60 shadow-sm">
                <CardHeader>
                  <CardTitle>Platform pulse</CardTitle>
                  <CardDescription>Snapshot of the highest-signal operational metrics.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    { icon: MessageSquare, label: "Total conversations", subtext: "AI chat sessions", value: chatStats.totalChats },
                    { icon: Activity, label: "Total messages", subtext: "User and AI exchanges", value: chatStats.totalMessages },
                    { icon: TrendingUp, label: "Open positions", subtext: "Active paper trades", value: tradingStats.totalPositions },
                    { icon: Database, label: "Journal entries", subtext: "Trade documentation", value: tradingStats.totalJournalEntries },
                  ].map((item) => (
                    <div key={item.label} className="flex flex-col gap-4 rounded-2xl border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="rounded-xl bg-primary/10 p-2 text-primary">
                          <item.icon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium">{item.label}</div>
                          <div className="text-xs text-muted-foreground">{item.subtext}</div>
                        </div>
                      </div>
                      <div className="text-left text-2xl font-semibold sm:text-right">{item.value}</div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="rounded-3xl border-border/60 shadow-sm">
                <CardHeader>
                  <CardTitle>Engagement metrics</CardTitle>
                  <CardDescription>Computed from live platform activity.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    { icon: MessageSquare, label: "Avg messages per chat", subtext: "Engagement depth per session", value: engagementStats.avgMessagesPerChat },
                    { icon: Activity, label: "Weekly active chats", subtext: "Sessions updated in last 7 days", value: engagementStats.weeklyActiveChats },
                    { icon: TrendingUp, label: "7-day retention rate", subtext: "Active chats vs total", value: `${engagementStats.retentionRate}%` },
                    { icon: BarChart3, label: "Lessons started", subtext: "Academy lesson progress rows", value: engagementStats.lessonsStarted },
                    { icon: Shield, label: "Quiz attempts", subtext: "Academy quiz submissions", value: engagementStats.quizAttempts },
                    { icon: Database, label: "Journal entries", subtext: "Trade documentation records", value: engagementStats.journalEntries },
                  ].map((item) => (
                    <div key={item.label} className="flex flex-col gap-4 rounded-2xl border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="rounded-xl bg-primary/10 p-2 text-primary">
                          <item.icon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium">{item.label}</div>
                          <div className="text-xs text-muted-foreground">{item.subtext}</div>
                        </div>
                      </div>
                      <div className="text-left text-2xl font-semibold sm:text-right">{item.value}</div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="activity" className="space-y-4">
            <Card className="rounded-3xl border-border/60 shadow-sm">
              <CardHeader>
                <CardTitle>Recent activity</CardTitle>
                <CardDescription>Most recent platform events, ordered by time.</CardDescription>
              </CardHeader>
              <CardContent>
                {recentActivity.length === 0 ? (
                  <div className="rounded-2xl border border-dashed p-10 text-center text-muted-foreground">
                    No recent activity.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {recentActivity.map((activity, index) => (
                      <div key={activity.id} className="flex flex-col gap-3 rounded-2xl border bg-muted/20 p-4 sm:flex-row sm:items-start">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                          <MessageSquare className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                            <p className="break-words font-medium">{activity.action}</p>
                            <Badge variant="outline" className="w-fit rounded-full px-2.5 text-[11px]">
                              Event {index + 1}
                            </Badge>
                          </div>
                          <p className="break-all text-sm text-muted-foreground">{activity.user_email}</p>
                          <p className="text-xs text-muted-foreground">{safeFormatDate(activity.timestamp, "MMM d, yyyy 'at' h:mm a")}</p>
                        </div>
                        <Clock className="mt-0.5 h-4 w-4 self-end text-muted-foreground sm:self-auto" />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="scheduled-jobs" className="space-y-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Scheduled Jobs</h2>
                <p className="text-sm text-muted-foreground">
                  Manually trigger background jobs that normally run on a schedule.
                </p>
              </div>
              <Button
                type="button"
                onClick={() => { void fetchSchedulerStatus(); }}
                disabled={schedulerLoading}
                variant="outline"
                size="sm"
                className="w-full gap-2 rounded-xl sm:w-auto"
              >
                <RefreshCw className={`h-4 w-4 ${schedulerLoading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {SCHEDULED_JOB_DEFS.map((def) => {
                const job = schedulerJobs.find((j) => j.id === def.id);
                const lastRun = job?.last_run ?? null;
                const jobStatus = jobStatuses[def.id] ?? "idle";
                const jobMessage = jobMessages[def.id] ?? "";
                const health = getJobHealth(lastRun, def.overdueSeconds);

                return (
                  <Card key={def.id} className="rounded-3xl border-border/60 shadow-sm">
                    <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
                      <div className="space-y-1">
                        <CardTitle className="text-base">{def.name}</CardTitle>
                        <CardDescription>{def.schedule}</CardDescription>
                      </div>
                      <div
                        className={`mt-1 h-3 w-3 rounded-full ${
                          health === "healthy"
                            ? "bg-emerald-500"
                            : health === "warning"
                            ? "bg-amber-500"
                            : "bg-slate-400"
                        }`}
                      />
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex items-center gap-2 text-sm">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground">Last run:</span>
                        <span
                          className={`font-medium ${
                            health === "warning" ? "text-amber-600 dark:text-amber-400" : ""
                          }`}
                        >
                          {schedulerLoading ? "Loading…" : formatRelativeTime(lastRun)}
                        </span>
                      </div>
                      <div>
                        <Button
                          size="sm"
                          className="w-full gap-2 rounded-xl"
                          variant="outline"
                          disabled={jobStatus === "running"}
                          onClick={() => { void triggerJob(def.id); }}
                        >
                          {jobStatus === "running" ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Running…
                            </>
                          ) : (
                            <>
                              <Play className="h-4 w-4" />
                              Run Now
                            </>
                          )}
                        </Button>
                        {jobStatus !== "idle" && (
                          <p
                            className={`mt-1.5 text-xs ${
                              jobStatus === "running"
                                ? "text-muted-foreground"
                                : jobStatus === "success"
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-red-600 dark:text-red-400"
                            }`}
                          >
                            {jobStatus === "running" ? "Running..." : jobMessage}
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent value="system-health" className="space-y-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold">System health monitor</h2>
                <p className="text-sm text-muted-foreground">Live connection status for Supabase, DataAPI, and the backend API.</p>
              </div>
              <Button type="button" onClick={(e) => { e.preventDefault(); void fetchSystemHealth(); }} disabled={healthLoading} variant="outline" size="sm" className="w-full gap-2 rounded-xl sm:w-auto">
                <RefreshCw className={`h-4 w-4 ${healthLoading ? "animate-spin" : ""}`} />
                Check health
              </Button>
            </div>

            {systemHealth && (
              <div className={`rounded-3xl border p-5 ${overallTone.panelClassName}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <div className="rounded-2xl bg-background/80 p-2.5">
                      <OverallStatusIcon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-semibold capitalize">System {systemHealth.overall}</p>
                      <p className="text-sm text-muted-foreground">Last checked: {systemHealth.timestamp ? new Date(systemHealth.timestamp).toLocaleString() : "Never"}</p>
                    </div>
                  </div>
                  <Badge variant="outline" className={`w-fit rounded-full px-3 py-1 ${overallTone.badgeClassName}`}>
                    {overallTone.label}
                  </Badge>
                </div>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-3">
              {/* Supabase */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">Supabase</CardTitle>
                  <Database className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  {healthLoading ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Checking...
                    </div>
                  ) : systemHealth?.services?.supabase ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <div className={`h-3 w-3 rounded-full ${
                          systemHealth.services.supabase.status === "connected" ? "bg-green-500" : "bg-red-500"
                        }`} />
                        <span className="font-medium capitalize">{systemHealth.services.supabase.status}</span>
                      </div>
                      {systemHealth.services.supabase.url && (
                        <p className="text-xs text-muted-foreground truncate">{systemHealth.services.supabase.url}</p>
                      )}
                      {systemHealth.services.supabase.message && (
                        <p className="text-xs text-red-400">{systemHealth.services.supabase.message}</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Not checked yet</p>
                  )}
                </CardContent>
              </Card>

              {/* DataAPI */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">DataAPI Server</CardTitle>
                  <Server className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  {healthLoading ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Checking...
                    </div>
                  ) : systemHealth?.services?.dataapi ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <div className={`h-3 w-3 rounded-full ${
                          systemHealth.services.dataapi.status === "connected" ? "bg-green-500" :
                          systemHealth.services.dataapi.status === "not_configured" ? "bg-yellow-500" : "bg-red-500"
                        }`} />
                        <span className="font-medium capitalize">{systemHealth.services.dataapi.status}</span>
                      </div>
                      {systemHealth.services.dataapi.database !== undefined && (
                        <p className="text-xs">
                          Database: <Badge variant={systemHealth.services.dataapi.database ? "default" : "destructive"} className="text-xs">
                            {systemHealth.services.dataapi.database ? "Connected" : "Disconnected"}
                          </Badge>
                        </p>
                      )}
                      {systemHealth.services.dataapi.url && (
                        <p className="text-xs text-muted-foreground truncate">{systemHealth.services.dataapi.url}</p>
                      )}
                      {systemHealth.services.dataapi.message && (
                        <p className="text-xs text-red-400">{systemHealth.services.dataapi.message}</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Not checked yet</p>
                  )}
                </CardContent>
              </Card>

              {/* Backend */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">Railway Backend</CardTitle>
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  {healthLoading ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Checking...
                    </div>
                  ) : systemHealth?.services?.backend ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <div className={`h-3 w-3 rounded-full ${
                          systemHealth.services.backend.status === "connected" ? "bg-green-500" : "bg-red-500"
                        }`} />
                        <span className="font-medium capitalize">{systemHealth.services.backend.status}</span>
                      </div>
                      {systemHealth.services.backend.uptime_seconds && (
                        <p className="text-xs text-muted-foreground">
                          Uptime: {Math.round(systemHealth.services.backend.uptime_seconds / 60)}m
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Not checked yet</p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* DataAPI Dashboard Data */}
            {systemHealth?.dataapi_dashboard && !systemHealth.dataapi_dashboard.error && (
              <div className="grid gap-4 md:grid-cols-2">
                {/* Engine API Info */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">DataAPI Info</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {systemHealth.dataapi_dashboard.api && (
                      <>
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <span className="text-muted-foreground">Name</span>
                          <span className="font-medium break-words sm:text-right">{systemHealth.dataapi_dashboard.api.name}</span>
                        </div>
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <span className="text-muted-foreground">Version</span>
                          <span className="font-medium break-words sm:text-right">{systemHealth.dataapi_dashboard.api.version}</span>
                        </div>
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <span className="text-muted-foreground">Environment</span>
                          <Badge variant="outline" className="w-fit">{systemHealth.dataapi_dashboard.api.environment}</Badge>
                        </div>
                      </>
                    )}
                    {systemHealth.dataapi_dashboard.database && (
                      <>
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <span className="text-muted-foreground">DB Connected</span>
                          <Badge variant={systemHealth.dataapi_dashboard.database.connected ? "default" : "destructive"} className="w-fit">
                            {systemHealth.dataapi_dashboard.database.connected ? "Yes" : "No"}
                          </Badge>
                        </div>
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                          <span className="text-muted-foreground">DB URL</span>
                          <span className="max-w-full break-all text-left text-xs font-mono sm:max-w-[200px] sm:text-right">{systemHealth.dataapi_dashboard.database.url_masked}</span>
                        </div>
                      </>
                    )}
                    {systemHealth.dataapi_dashboard.active_tickers !== undefined && (
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                        <span className="text-muted-foreground">Active Tickers</span>
                        <span className="font-medium sm:text-right">{systemHealth.dataapi_dashboard.active_tickers}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Table Row Counts */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Engine Database Tables</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {systemHealth.dataapi_dashboard.tables?.length > 0 ? (
                      <div className="max-w-full overflow-x-auto">
                        <Table className="min-w-[320px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Table</TableHead>
                            <TableHead className="text-xs text-right">Rows</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {systemHealth.dataapi_dashboard.tables.map((t: { table: string; row_count: number }) => (
                            <TableRow key={t.table}>
                              <TableCell className="max-w-[14rem] truncate text-xs font-mono">{t.table}</TableCell>
                              <TableCell className="text-xs text-right">
                                {t.row_count >= 0 ? t.row_count.toLocaleString() : (
                                  <span className="text-red-400">N/A</span>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">No table data</p>
                    )}
                  </CardContent>
                </Card>

                {/* Engine Workers */}
                {systemHealth.dataapi_dashboard.engine_workers?.length > 0 && (
                  <Card className="md:col-span-2">
                    <CardHeader>
                      <CardTitle className="text-sm">Engine Worker Heartbeats</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="max-w-full overflow-x-auto">
                        <Table className="min-w-[560px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Worker</TableHead>
                            <TableHead className="text-xs">Status</TableHead>
                            <TableHead className="text-xs">Last Heartbeat</TableHead>
                            <TableHead className="text-xs">Ago</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {systemHealth.dataapi_dashboard.engine_workers.map(
                            (w: { worker_name: string; status: string; last_heartbeat: string | null; seconds_ago: number | null }) => (
                            <TableRow key={w.worker_name}>
                              <TableCell className="max-w-[14rem] truncate text-xs font-mono">{w.worker_name}</TableCell>
                              <TableCell>
                                <Badge variant={w.status === "running" ? "default" : "secondary"} className="text-xs">
                                  {w.status}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">{w.last_heartbeat || "—"}</TableCell>
                              <TableCell className="text-xs">
                                {w.seconds_ago !== null ? (
                                  w.seconds_ago < 60 ? `${w.seconds_ago}s` : `${Math.round(w.seconds_ago / 60)}m`
                                ) : "—"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Service Clients */}
                {systemHealth.dataapi_dashboard.service_clients?.length > 0 && (
                  <Card className="md:col-span-2">
                    <CardHeader>
                      <CardTitle className="text-sm">Service Clients (IAM)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="max-w-full overflow-x-auto">
                        <Table className="min-w-[560px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Client ID</TableHead>
                            <TableHead className="text-xs">Name</TableHead>
                            <TableHead className="text-xs">Active</TableHead>
                            <TableHead className="text-xs">Scopes</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {systemHealth.dataapi_dashboard.service_clients.map(
                            (c: { client_id: string; display_name: string | null; is_active: boolean; scope_count: number }) => (
                            <TableRow key={c.client_id}>
                              <TableCell className="max-w-[14rem] truncate text-xs font-mono">{c.client_id}</TableCell>
                              <TableCell className="text-xs">{c.display_name || "—"}</TableCell>
                              <TableCell>
                                <Badge variant={c.is_active ? "default" : "destructive"} className="text-xs">
                                  {c.is_active ? "Yes" : "No"}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs">{c.scope_count}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* Orphaned Auth User Cleanup */}
            <Card>
              <CardHeader>
                <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="text-sm">Orphaned Auth User Cleanup</CardTitle>
                    <CardDescription className="mt-1">
                      Removes Supabase Auth records that have no matching profile row. These are left over from earlier deletions and permanently block those email addresses from being reused.
                    </CardDescription>
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="w-full gap-2 rounded-xl sm:w-auto"
                    disabled={purgeLoading || !BACKEND_URL}
                    onClick={() => void purgeOrphanedAuthUsers()}
                  >
                    {purgeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    {purgeLoading ? "Purging…" : "Purge orphaned accounts"}
                  </Button>
                </div>
              </CardHeader>
              {purgeResult && (
                <CardContent>
                  <p className="text-sm">
                    <span className="font-medium text-green-600 dark:text-green-400">{purgeResult.deleted} deleted</span>
                    {purgeResult.failed > 0 && (
                      <span className="ml-2 text-destructive">{purgeResult.failed} failed</span>
                    )}
                    {purgeResult.deleted === 0 && purgeResult.failed === 0 && (
                      <span className="text-muted-foreground ml-1">— no orphaned records found</span>
                    )}
                  </p>
                </CardContent>
              )}
            </Card>

            {/* Database Query Console */}
            <Card>
              <CardHeader>
                <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Terminal className="h-4 w-4" />
                      Engine Database Query Console
                    </CardTitle>
                    <CardDescription>
                      Run read-only SELECT queries against the engine database via DataAPI
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Preset Query Buttons */}
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => runQuery("SELECT ticker, company_name, is_active FROM tickers ORDER BY ticker LIMIT 50")}>
                    All Tickers
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => runQuery("SELECT t.ticker, ls.last_price, ls.price_change_pct, ls.rsi_14, ls.updated_at FROM latest_snapshot ls JOIN tickers t ON t.ticker_id = ls.ticker_id ORDER BY ls.updated_at DESC LIMIT 25")}>
                    Latest Prices
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => runQuery("SELECT t.ticker, ls.latest_signal, ls.signal_confidence, ls.signal_strategy, ls.signal_ts FROM latest_snapshot ls JOIN tickers t ON t.ticker_id = ls.ticker_id WHERE ls.latest_signal IS NOT NULL ORDER BY ls.signal_ts DESC LIMIT 25")}>
                    Latest Signals
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => runQuery("SELECT * FROM paper_trades ORDER BY created_at DESC LIMIT 20")}>
                    Recent Trades
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => runQuery("SELECT * FROM portfolio_valuation ORDER BY valuation_date DESC LIMIT 5")}>
                    Portfolio
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => runQuery("SELECT * FROM market_news ORDER BY published_at DESC LIMIT 15")}>
                    Market News
                  </Button>
                </div>

                {/* Custom Query Input */}
                <div className="space-y-2">
                    <Textarea
                      placeholder="SELECT * FROM tickers WHERE is_active = true LIMIT 10"
                      value={queryInput}
                      onChange={(e) => setQueryInput(e.target.value)}
                      className="min-h-[80px] font-mono text-xs sm:text-sm"
                    />
                  <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                    <Button onClick={() => runQuery()} disabled={queryLoading || !queryInput.trim()} size="sm" className="w-full gap-2 sm:w-auto">
                      {queryLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      Execute Query
                    </Button>
                    {queryResults && (
                      <span className="text-xs text-muted-foreground">
                        {queryResults.row_count} rows returned
                      </span>
                    )}
                  </div>
                </div>

                {/* Query Error */}
                {queryError && (
                  <div className="rounded-lg border border-red-500/50 bg-red-500/5 p-3">
                    <p className="text-sm text-red-400">{queryError}</p>
                  </div>
                )}

                {/* Query Results Table */}
                {queryResults?.rows?.length > 0 && (
                  <div className="max-h-[400px] max-w-full overflow-auto rounded-lg border">
                    <Table className="min-w-max">
                      <TableHeader>
                        <TableRow>
                          {Object.keys(queryResults.rows[0]).map((col) => (
                            <TableHead key={col} className="text-xs whitespace-nowrap">{col}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {queryResults.rows.map((row: Record<string, string | null>, idx: number) => (
                          <TableRow key={idx}>
                            {Object.values(row).map((val, ci) => (
                              <TableCell key={ci} className="max-w-[160px] truncate align-top text-xs sm:max-w-[200px]">
                                {val !== null ? String(val) : <span className="text-muted-foreground">null</span>}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
