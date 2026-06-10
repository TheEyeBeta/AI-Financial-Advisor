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
  BarChart3, UserCheck, UserX, Clock, Server,
  Wifi, WifiOff, Loader2, Play, Terminal, Sparkles,
  ShieldCheck, AlertTriangle, CheckCircle2, XCircle,
  MinusCircle, FileText, Zap, Radio, Eye,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { getPythonApiUrl } from "@/lib/env";
import { supabase } from "@/lib/supabase";
import { useState, useEffect, useCallback } from "react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/error";
import { format } from "date-fns";
import { adminApi, type SchedulerJob, type JobRunLog } from "@/services/api";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

// ─── Types ──────────────────────────────────────────────────────────────────

interface User {
  id: string;
  auth_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  userType: "User" | "Admin";
  is_verified: boolean | null;
  experience_level: string | null;
  risk_level: string | null;
  created_at: string;
}

interface ChatStats { totalChats: number; totalMessages: number; activeToday: number }
interface TradingStats { totalPositions: number; totalTrades: number; totalJournalEntries: number }
interface ActivityLog { id: string; user_email: string; action: string; timestamp: string }
interface EngagementStats {
  avgMessagesPerChat: number; weeklyActiveChats: number;
  lessonsStarted: number; journalEntries: number;
  quizAttempts: number; retentionRate: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const safeFormatDate = (timestamp: unknown, dateFormat: string, fallback = "—") => {
  if (timestamp === null || timestamp === undefined || timestamp === "") return fallback;
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp as string | number);
  return Number.isNaN(date.getTime()) ? fallback : format(date, dateFormat);
};

const formatPercentage = (value: number, total: number) => {
  if (!total) return 0;
  return Math.round((value / total) * 100);
};

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

const formatDuration = (startedAt: string, finishedAt: string | null): string => {
  if (!finishedAt) return "—";
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
};

const getJobHealth = (
  lastRun: string | null,
  overdueSeconds: number | null,
): "healthy" | "warning" | "unknown" => {
  if (!lastRun) return "unknown";
  if (overdueSeconds === null) return "healthy";
  return (Date.now() - new Date(lastRun).getTime()) / 1000 <= overdueSeconds
    ? "healthy"
    : "warning";
};

const getOverallTone = (overall?: string) => {
  switch (overall) {
    case "healthy":
      return {
        cls: "text-emerald-500",
        badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
        panel: "border-emerald-500/20 bg-emerald-500/5",
        icon: Wifi,
        label: "All systems operational",
      };
    case "degraded":
      return {
        cls: "text-amber-500",
        badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
        panel: "border-amber-500/20 bg-amber-500/5",
        icon: AlertTriangle,
        label: "Degraded performance",
      };
    default:
      return {
        cls: "text-rose-500",
        badge: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
        panel: "border-rose-500/20 bg-rose-500/5",
        icon: WifiOff,
        label: "Action required",
      };
  }
};

// ─── Job definitions ──────────────────────────────────────────────────────────

interface ScheduledJobDef {
  id: string;
  name: string;
  description: string;
  schedule: string;
  overdueSeconds: number | null;
  icon: React.ElementType;
}

const SCHEDULED_JOB_DEFS: ScheduledJobDef[] = [
  {
    id: "ranking",
    name: "Ranking Engine",
    description: "Scores all tickers using a 6-dimension composite algorithm and writes top 50 to trending_stocks.",
    schedule: "Daily · 01:00 UTC",
    overdueSeconds: 90000,
    icon: TrendingUp,
  },
  {
    id: "memory_extraction",
    name: "Memory Extraction",
    description: "Batch-processes unprocessed chats and extracts structured insights using GPT-4o mini.",
    schedule: "Every 15 minutes",
    overdueSeconds: 1200,
    icon: Sparkles,
  },
  {
    id: "intelligence",
    name: "Intelligence Engine",
    description: "Evaluates user Meridian data against market signals and generates proactive digests.",
    schedule: "Every 6 hours",
    overdueSeconds: 25200,
    icon: Zap,
  },
  {
    id: "meridian_refresh",
    name: "Meridian Context Refresh",
    description: "Refreshes the IRIS personalization context cache for all active users.",
    schedule: "On demand · cache miss",
    overdueSeconds: null,
    icon: Radio,
  },
];

const JOB_ID_TO_NAME: Record<string, string> = {
  ranking: "ranking_engine",
  memory_extraction: "memory_extraction",
  intelligence: "intelligence_engine",
  meridian_refresh: "meridian_refresh",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function PulsingDot({ health }: { health: "healthy" | "warning" | "unknown" }) {
  if (health === "healthy") {
    return (
      <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
      </span>
    );
  }
  if (health === "warning") {
    return (
      <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
      </span>
    );
  }
  return <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full bg-slate-400/60" />;
}

function StatusBadge({ status }: { status: "success" | "error" | "skipped" | null }) {
  if (status === "success") return (
    <Badge className="rounded-md bg-emerald-500/10 px-2 py-0 text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
      success
    </Badge>
  );
  if (status === "error") return (
    <Badge className="rounded-md bg-rose-500/10 px-2 py-0 text-[10px] font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-400 border-rose-500/20">
      error
    </Badge>
  );
  if (status === "skipped") return (
    <Badge className="rounded-md bg-amber-500/10 px-2 py-0 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400 border-amber-500/20">
      skipped
    </Badge>
  );
  return null;
}

function RunHistoryDots({ logs }: { logs: JobRunLog[] }) {
  const recent = [...logs].reverse().slice(0, 8);
  if (recent.length === 0) return <span className="text-xs text-muted-foreground">No runs yet</span>;
  return (
    <div className="flex items-center gap-1">
      {recent.map((log) => (
        <span
          key={log.id}
          title={`${safeFormatDate(log.started_at, "MMM d HH:mm")} · ${log.status}`}
          className={`h-1.5 w-1.5 rounded-full ${
            log.status === "success"
              ? "bg-emerald-500"
              : log.status === "error"
              ? "bg-rose-500"
              : "bg-amber-400"
          }`}
        />
      ))}
      <span className="ml-1 text-[10px] text-muted-foreground">recent runs</span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

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
    avgMessagesPerChat: 0, weeklyActiveChats: 0,
    lessonsStarted: 0, journalEntries: 0,
    quizAttempts: 0, retentionRate: 0,
  });

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
  const [jobRunLogs, setJobRunLogs] = useState<Record<string, JobRunLog[]>>({});
  const [jobLogsLoading, setJobLogsLoading] = useState<Record<string, boolean>>({});
  const [logsModalJobId, setLogsModalJobId] = useState<string | null>(null);
  const [lastJobsRefresh, setLastJobsRefresh] = useState<Date | null>(null);

  const [purgeLoading, setPurgeLoading] = useState(false);
  const [purgeResult, setPurgeResult] = useState<{ deleted: number; failed: number } | null>(null);

  const BACKEND_URL = getPythonApiUrl();

  const getAuthHeaders = async (): Promise<HeadersInit> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) throw new Error("Not authenticated — please sign in again");
    return { "Authorization": `Bearer ${session.access_token}`, "Content-Type": "application/json" };
  };

  // ── Data fetching ────────────────────────────────────────────────────────

  const fetchSystemHealth = async () => {
    setHealthLoading(true);
    try {
      const headers = await getAuthHeaders();
      const resp = await fetch(`${BACKEND_URL}/api/admin/system-health`, { headers });
      if (!resp.ok) throw new Error((await resp.text()) || `HTTP ${resp.status}`);
      setSystemHealth(await resp.json());
    } catch {
      const { error: sbError } = await supabase
        .schema("core").from("users").select("id", { count: "exact", head: true });
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
        { headers },
      );
      if (!resp.ok) throw new Error((await resp.text()) || `HTTP ${resp.status}`);
      setQueryResults(await resp.json());
    } catch (err) {
      setQueryError(String(err));
    } finally {
      setQueryLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const { data, error } = await supabase
        .schema("core").from("users")
        .select("id, auth_id, email, first_name, last_name, userType, is_verified, experience_level, risk_level, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setUsers(data || []);
      setFilteredUsers(data || []);
    } catch (error) {
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
        supabase.schema("ai").from("chat_messages")
          .select("id, user_id, role, created_at")
          .order("created_at", { ascending: false }).limit(10),
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
        })),
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
        retentionRate: chatsRes.count
          ? Math.round(((weeklyActiveRes.count ?? 0) / chatsRes.count) * 100)
          : 0,
      });
    } catch (error) {
      console.error("Error fetching engagement stats:", error);
    }
  };

  // ── Search filter ────────────────────────────────────────────────────────

  useEffect(() => {
    if (searchQuery) {
      setFilteredUsers(users.filter((u) =>
        u.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.first_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.last_name?.toLowerCase().includes(searchQuery.toLowerCase()),
      ));
    } else {
      setFilteredUsers(users);
    }
  }, [searchQuery, users]);

  // ── Initial load ─────────────────────────────────────────────────────────

  const loadAllData = useCallback(async () => {
    setLoading(true);
    await Promise.all([
      fetchUsers(), fetchChatStats(), fetchTradingStats(),
      fetchEngagementStats(), fetchSystemHealth(),
    ]);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { loadAllData(); }, [loadAllData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadAllData();
    setRefreshing(false);
    toast({ title: "Dashboard refreshed" });
  };

  // ── User actions ─────────────────────────────────────────────────────────

  const toggleAdminStatus = async (userId: string, currentType: "User" | "Admin") => {
    const newType = currentType === "Admin" ? "User" : "Admin";
    try {
      const { error } = await supabase.schema("core").from("users")
        .update({ userType: newType }).eq("id", userId);
      if (error) throw error;
      toast({ title: `User ${newType === "Admin" ? "promoted to" : "demoted from"} admin` });
      fetchUsers();
    } catch (error) {
      toast({ title: "Error", description: getErrorMessage(error) || "Failed to update role", variant: "destructive" });
    }
  };

  const deleteUser = async (userId: string, authId: string) => {
    try {
      if (BACKEND_URL && authId) {
        const headers = await getAuthHeaders();
        const resp = await fetch(`${BACKEND_URL}/api/admin/users/${authId}`, { method: "DELETE", headers });
        if (!resp.ok) throw new Error((await resp.text()) || `HTTP ${resp.status}`);
      } else {
        await supabase.schema("ai").from("chats").delete().eq("user_id", userId);
        const { error } = await supabase.schema("core").from("users").delete().eq("id", userId);
        if (error) throw error;
      }
      toast({ title: "User deleted" });
      fetchUsers();
    } catch (error) {
      toast({ title: "Error", description: getErrorMessage(error) || "Failed to delete user", variant: "destructive" });
    }
  };

  const purgeOrphanedAuthUsers = async () => {
    setPurgeLoading(true);
    setPurgeResult(null);
    try {
      const headers = await getAuthHeaders();
      const resp = await fetch(`${BACKEND_URL}/api/admin/purge-orphaned-auth-users`, { method: "POST", headers });
      if (!resp.ok) throw new Error((await resp.text()) || `HTTP ${resp.status}`);
      const result = await resp.json() as { deleted: number; failed: number };
      setPurgeResult(result);
      toast({ title: `Purge complete — ${result.deleted} records removed` });
    } catch (error) {
      toast({ title: "Purge failed", description: getErrorMessage(error), variant: "destructive" });
    } finally {
      setPurgeLoading(false);
    }
  };

  const exportUsers = () => {
    const csv = [
      ["ID", "Email", "First Name", "Last Name", "Verified", "Admin", "Experience", "Risk Level", "Created"],
      ...users.map((u) => [
        u.id, u.email || "", u.first_name || "", u.last_name || "",
        u.is_verified ? "Yes" : "No", u.userType === "Admin" ? "Yes" : "No",
        u.experience_level || "", u.risk_level || "", new Date(u.created_at).toISOString(),
      ]),
    ].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `users-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Exported" });
  };

  // ── Scheduler / jobs ─────────────────────────────────────────────────────

  const fetchSchedulerStatus = useCallback(async () => {
    setSchedulerLoading(true);
    try {
      const data = await adminApi.getSchedulerStatus();
      setSchedulerJobs(data.jobs ?? []);
      setLastJobsRefresh(new Date());
    } catch (err) {
      console.error("Scheduler status fetch failed:", err);
    } finally {
      setSchedulerLoading(false);
    }
  }, []);

  // Always fetches fresh — no cache bypass
  const fetchJobLogs = async (jobId: string) => {
    setJobLogsLoading((prev) => ({ ...prev, [jobId]: true }));
    try {
      const jobName = JOB_ID_TO_NAME[jobId] ?? jobId;
      const data = await adminApi.getJobRunLogs(jobName, 10);
      setJobRunLogs((prev) => ({ ...prev, [jobId]: data.logs ?? [] }));
    } catch (err) {
      console.error(`Failed to fetch logs for ${jobId}:`, err);
      setJobRunLogs((prev) => ({ ...prev, [jobId]: [] }));
    } finally {
      setJobLogsLoading((prev) => ({ ...prev, [jobId]: false }));
    }
  };

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
      const msg = err instanceof Error ? err.message : "Unknown error";
      setJobStatuses((prev) => ({ ...prev, [jobId]: "error" }));
      setJobMessages((prev) => ({ ...prev, [jobId]: msg }));
    } finally {
      // Always refresh both scheduler status and logs after a run attempt
      await Promise.all([fetchSchedulerStatus(), fetchJobLogs(jobId)]);
    }
  };

  const openJobLogs = async (jobId: string) => {
    setLogsModalJobId(jobId);
    await fetchJobLogs(jobId); // always fresh on open
  };

  // Pre-load job logs and status when the tab becomes active
  useEffect(() => {
    if (activeTab !== "scheduled-jobs") return;
    void fetchSchedulerStatus();
    SCHEDULED_JOB_DEFS.forEach((def) => { void fetchJobLogs(def.id); });
    const interval = setInterval(() => { void fetchSchedulerStatus(); }, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, fetchSchedulerStatus]);

  // ── Computed values ───────────────────────────────────────────────────────

  const stats = {
    totalUsers: users.length,
    adminUsers: users.filter((u) => u.userType === "Admin").length,
    verifiedUsers: users.filter((u) => u.is_verified).length,
    beginners: users.filter((u) => u.experience_level === "beginner").length,
    intermediate: users.filter((u) => u.experience_level === "intermediate").length,
    advanced: users.filter((u) => u.experience_level === "advanced").length,
  };

  const verificationRate = formatPercentage(stats.verifiedUsers, stats.totalUsers);
  const overallTone = getOverallTone(systemHealth?.overall as string | undefined);
  const OverallStatusIcon = overallTone.icon;

  const userMix = [
    { label: "Beginner", value: stats.beginners, color: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
    { label: "Intermediate", value: stats.intermediate, color: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
    { label: "Advanced", value: stats.advanced, color: "bg-rose-500", text: "text-rose-600 dark:text-rose-400" },
  ];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <AppLayout title="Admin">
      <div className="min-w-0 space-y-6 pb-10">

        {/* ── Page header ── */}
        <header className="flex flex-col gap-5 border-b border-border/60 pb-6 pt-1 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="gap-1.5 rounded-full border-primary/30 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
                <ShieldCheck className="h-3 w-3" />
                Admin workspace
              </Badge>
              {systemHealth && (
                <Badge variant="outline" className={`gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${overallTone.badge}`}>
                  <OverallStatusIcon className="h-3 w-3" />
                  {overallTone.label}
                </Badge>
              )}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Operations Console</h1>
            <p className="text-sm text-muted-foreground">
              Manage users, monitor infrastructure, and orchestrate background jobs from one place.
            </p>
          </div>
          <div className="flex flex-shrink-0 flex-wrap gap-2 sm:flex-col sm:items-end">
            <Button
              onClick={handleRefresh}
              disabled={refreshing}
              size="sm"
              className="gap-2 rounded-lg"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button onClick={exportUsers} variant="outline" size="sm" className="gap-2 rounded-lg">
              <Download className="h-3.5 w-3.5" />
              Export users
            </Button>
          </div>
        </header>

        {/* ── KPI strip ── */}
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            {
              icon: Users,
              label: "Total users",
              value: stats.totalUsers,
              sub: `${verificationRate}% verified`,
              accent: "border-l-primary",
            },
            {
              icon: MessageSquare,
              label: "Conversations",
              value: chatStats.totalChats,
              sub: `${chatStats.totalMessages} messages · ${chatStats.activeToday} today`,
              accent: "border-l-[hsl(var(--chart-5))]",
            },
            {
              icon: TrendingUp,
              label: "Trading activity",
              value: tradingStats.totalTrades + tradingStats.totalJournalEntries,
              sub: `${tradingStats.totalTrades} trades · ${tradingStats.totalJournalEntries} journal logs`,
              accent: "border-l-emerald-500",
            },
            {
              icon: Shield,
              label: "Admins",
              value: stats.adminUsers,
              sub: "Permissioned operators",
              accent: "border-l-amber-500",
            },
          ].map((item) => (
            <div
              key={item.label}
              className={`relative overflow-hidden rounded-2xl border border-l-4 bg-card p-5 ${item.accent}`}
            >
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                  {item.label}
                </p>
                <item.icon className="h-4 w-4 text-muted-foreground/50" />
              </div>
              <p className="text-3xl font-bold tabular-nums tracking-tight">{item.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">{item.sub}</p>
            </div>
          ))}
        </section>

        {/* ── Tabs ── */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-5">
          <TabsList className="h-auto w-full rounded-xl border border-border/60 bg-muted/40 p-1">
            <div className="flex w-full flex-wrap gap-0.5">
              {[
                { value: "users", icon: Users, label: "Users" },
                { value: "analytics", icon: BarChart3, label: "Analytics" },
                { value: "activity", icon: Activity, label: "Activity" },
                { value: "scheduled-jobs", icon: Clock, label: "Jobs" },
                { value: "system-health", icon: Server, label: "Infrastructure" },
              ].map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className="flex-1 gap-1.5 rounded-lg py-2.5 text-xs font-medium data-[state=active]:bg-background data-[state=active]:shadow-sm sm:text-sm"
                >
                  <tab.icon className="h-3.5 w-3.5" />
                  {tab.label}
                </TabsTrigger>
              ))}
            </div>
          </TabsList>

          {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ USERS TAB */}
          <TabsContent value="users" className="space-y-4">
            <Card className="rounded-2xl border-border/60">
              <CardHeader className="border-b border-border/40 pb-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <CardTitle className="text-base">User management</CardTitle>
                    <CardDescription className="mt-0.5">
                      {stats.totalUsers} members · {stats.verifiedUsers} verified · {stats.adminUsers} admins
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <div className="relative w-full sm:w-72">
                      <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="Search name or email…"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="h-9 rounded-lg border-border/70 pl-9 text-sm"
                      />
                    </div>
                    <Button onClick={exportUsers} variant="outline" size="sm" className="gap-2 rounded-lg">
                      <Download className="h-3.5 w-3.5" />
                      CSV
                    </Button>
                  </div>
                </div>

                {/* Mini stat row */}
                <div className="mt-4 grid grid-cols-3 gap-3">
                  {[
                    { label: "Verified", value: stats.verifiedUsers, sub: "ready for full access" },
                    { label: "Unverified", value: stats.totalUsers - stats.verifiedUsers, sub: "pending onboarding" },
                    { label: "Showing", value: filteredUsers.length, sub: searchQuery ? "matching your search" : "all accounts" },
                  ].map((s) => (
                    <div key={s.label} className="rounded-xl border bg-muted/20 px-4 py-3">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{s.label}</p>
                      <p className="mt-1 text-xl font-bold">{s.value}</p>
                      <p className="text-[11px] text-muted-foreground">{s.sub}</p>
                    </div>
                  ))}
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {loading ? (
                  <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading users…
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table className="min-w-[820px]">
                      <TableHeader>
                        <TableRow className="border-b border-border/40 bg-muted/30 hover:bg-muted/30">
                          <TableHead className="pl-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground">User</TableHead>
                          <TableHead className="hidden text-xs font-semibold uppercase tracking-wider text-muted-foreground md:table-cell">Email</TableHead>
                          <TableHead className="hidden text-xs font-semibold uppercase tracking-wider text-muted-foreground lg:table-cell">Level</TableHead>
                          <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</TableHead>
                          <TableHead className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Role</TableHead>
                          <TableHead className="hidden text-xs font-semibold uppercase tracking-wider text-muted-foreground xl:table-cell">Joined</TableHead>
                          <TableHead className="pr-6 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredUsers.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={7} className="py-16 text-center text-sm text-muted-foreground">
                              {searchQuery ? "No users match your search." : "No users yet."}
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredUsers.map((user) => {
                            const fullName = user.first_name || user.last_name
                              ? `${user.first_name || ""} ${user.last_name || ""}`.trim()
                              : "No name";
                            const initials = (user.first_name?.[0] ?? "") + (user.last_name?.[0] ?? "");

                            return (
                              <TableRow key={user.id} className="border-b border-border/30 hover:bg-muted/20">
                                <TableCell className="py-3 pl-6">
                                  <div className="flex items-center gap-3">
                                    <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                                      {initials || "?"}
                                    </div>
                                    <div className="min-w-0">
                                      <p className="truncate font-medium text-sm">{fullName}</p>
                                      <p className="truncate text-[11px] text-muted-foreground md:hidden">{user.email || "—"}</p>
                                    </div>
                                  </div>
                                </TableCell>
                                <TableCell className="hidden py-3 md:table-cell">
                                  <span className="font-mono text-xs text-muted-foreground">{user.email || "—"}</span>
                                </TableCell>
                                <TableCell className="hidden py-3 lg:table-cell">
                                  <Badge variant="outline" className={`text-xs capitalize ${
                                    user.experience_level === "beginner"
                                      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                      : user.experience_level === "intermediate"
                                      ? "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                      : user.experience_level === "advanced"
                                      ? "border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400"
                                      : "border-border/60 bg-muted/40 text-muted-foreground"
                                  }`}>
                                    {user.experience_level || "unknown"}
                                  </Badge>
                                </TableCell>
                                <TableCell className="py-3">
                                  {user.is_verified ? (
                                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                      <CheckCircle2 className="h-3 w-3" /> Verified
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                      <MinusCircle className="h-3 w-3" /> Pending
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell className="py-3">
                                  {user.userType === "Admin" ? (
                                    <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                                      <Shield className="h-3 w-3" /> Admin
                                    </span>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">User</span>
                                  )}
                                </TableCell>
                                <TableCell className="hidden py-3 text-xs text-muted-foreground xl:table-cell">
                                  {safeFormatDate(user.created_at, "MMM d, yyyy")}
                                </TableCell>
                                <TableCell className="py-3 pr-6 text-right">
                                  {user.id !== userProfile?.id && (
                                    <div className="flex justify-end gap-1.5">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-7 rounded-md px-2.5 text-xs"
                                        onClick={() => toggleAdminStatus(user.id, user.userType)}
                                      >
                                        {user.userType === "Admin" ? "Demote" : "Promote"}
                                      </Button>
                                      <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 w-7 rounded-md p-0 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500"
                                          >
                                            <Trash2 className="h-3.5 w-3.5" />
                                          </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                          <AlertDialogHeader>
                                            <AlertDialogTitle>Delete user?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                              This permanently removes {user.email || "this user"} and all associated data — chats, trades, and journal entries.
                                            </AlertDialogDescription>
                                          </AlertDialogHeader>
                                          <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction
                                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                              onClick={() => deleteUser(user.id, user.auth_id)}
                                            >
                                              Delete permanently
                                            </AlertDialogAction>
                                          </AlertDialogFooter>
                                        </AlertDialogContent>
                                      </AlertDialog>
                                    </div>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ANALYTICS TAB */}
          <TabsContent value="analytics" className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-2">

              {/* User mix */}
              <Card className="rounded-2xl border-border/60">
                <CardHeader className="border-b border-border/40 pb-4">
                  <CardTitle className="text-base">Experience distribution</CardTitle>
                  <CardDescription>Member base breakdown by skill level</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5 pt-5">
                  {userMix.map((seg) => {
                    const pct = formatPercentage(seg.value, stats.totalUsers);
                    return (
                      <div key={seg.label}>
                        <div className="mb-2 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className={`h-2 w-2 rounded-full ${seg.color}`} />
                            <span className="text-sm font-medium">{seg.label}</span>
                          </div>
                          <div className="flex items-center gap-3 tabular-nums">
                            <span className={`text-sm font-bold ${seg.text}`}>{pct}%</span>
                            <span className="w-8 text-right text-sm text-muted-foreground">{seg.value}</span>
                          </div>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full rounded-full transition-all duration-700 ${seg.color}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                  <Separator />
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "Verified", value: stats.verifiedUsers },
                      { label: "Active today", value: chatStats.activeToday },
                    ].map((s) => (
                      <div key={s.label} className="rounded-xl border bg-muted/20 p-4">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{s.label}</p>
                        <p className="mt-1.5 text-2xl font-bold">{s.value}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Platform pulse */}
              <Card className="rounded-2xl border-border/60">
                <CardHeader className="border-b border-border/40 pb-4">
                  <CardTitle className="text-base">Platform pulse</CardTitle>
                  <CardDescription>Highest-signal operational metrics</CardDescription>
                </CardHeader>
                <CardContent className="divide-y divide-border/30 pt-0">
                  {[
                    { icon: MessageSquare, label: "Total conversations", sub: "AI chat sessions", value: chatStats.totalChats },
                    { icon: Activity, label: "Total messages", sub: "User and AI exchanges", value: chatStats.totalMessages },
                    { icon: TrendingUp, label: "Open positions", sub: "Active paper trades", value: tradingStats.totalPositions },
                    { icon: Database, label: "Journal entries", sub: "Trade documentation", value: tradingStats.totalJournalEntries },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <item.icon className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">{item.label}</p>
                          <p className="text-xs text-muted-foreground">{item.sub}</p>
                        </div>
                      </div>
                      <span className="text-2xl font-bold tabular-nums">{item.value}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Engagement */}
              <Card className="rounded-2xl border-border/60 xl:col-span-2">
                <CardHeader className="border-b border-border/40 pb-4">
                  <CardTitle className="text-base">Engagement metrics</CardTitle>
                  <CardDescription>Computed from live platform activity</CardDescription>
                </CardHeader>
                <CardContent className="pt-5">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {[
                      { label: "Avg messages / chat", value: engagementStats.avgMessagesPerChat, sub: "Engagement depth" },
                      { label: "Weekly active chats", value: engagementStats.weeklyActiveChats, sub: "Updated in last 7d" },
                      { label: "7-day retention", value: `${engagementStats.retentionRate}%`, sub: "Active vs total chats" },
                      { label: "Lessons started", value: engagementStats.lessonsStarted, sub: "Academy progress rows" },
                      { label: "Quiz attempts", value: engagementStats.quizAttempts, sub: "Academy submissions" },
                      { label: "Journal entries", value: engagementStats.journalEntries, sub: "Trade documentation" },
                    ].map((m) => (
                      <div key={m.label} className="rounded-xl border bg-muted/20 p-4">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{m.label}</p>
                        <p className="mt-1.5 text-3xl font-bold tabular-nums">{m.value}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{m.sub}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ACTIVITY TAB */}
          <TabsContent value="activity" className="space-y-4">
            <Card className="rounded-2xl border-border/60">
              <CardHeader className="border-b border-border/40 pb-4">
                <CardTitle className="text-base">Recent activity</CardTitle>
                <CardDescription>Most recent platform events, ordered by time</CardDescription>
              </CardHeader>
              <CardContent className="pt-4">
                {recentActivity.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-16 text-center">
                    <Activity className="h-8 w-8 text-muted-foreground/30" />
                    <p className="text-sm text-muted-foreground">No recent activity</p>
                  </div>
                ) : (
                  <div className="relative space-y-0">
                    {/* Timeline line */}
                    <div className="absolute left-[19px] top-3 bottom-3 w-px bg-border/50" />
                    {recentActivity.map((activity, index) => (
                      <div key={activity.id} className="relative flex gap-4 pb-4">
                        <div className="relative z-10 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-border/60 bg-background shadow-sm">
                          <MessageSquare className="h-4 w-4 text-primary/70" />
                        </div>
                        <div className="min-w-0 flex-1 rounded-xl border border-border/40 bg-muted/20 px-4 py-3">
                          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-sm font-medium">{activity.action}</p>
                            <Badge variant="outline" className="w-fit rounded-full px-2 py-0 text-[10px] tabular-nums">
                              #{index + 1}
                            </Badge>
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {safeFormatDate(activity.timestamp, "MMM d, yyyy 'at' h:mm a")}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ SCHEDULED JOBS TAB */}
          <TabsContent value="scheduled-jobs" className="space-y-5">

            {/* Section header */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold">Job Orchestration</h2>
                <p className="text-sm text-muted-foreground">
                  {lastJobsRefresh
                    ? `Status refreshed ${formatRelativeTime(lastJobsRefresh.toISOString())}`
                    : "Fetching scheduler status…"}
                </p>
              </div>
              <Button
                onClick={() => { void fetchSchedulerStatus(); }}
                disabled={schedulerLoading}
                variant="outline"
                size="sm"
                className="gap-2 rounded-lg"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${schedulerLoading ? "animate-spin" : ""}`} />
                Refresh status
              </Button>
            </div>

            {/* Job cards grid */}
            <div className="grid gap-4 lg:grid-cols-2">
              {SCHEDULED_JOB_DEFS.map((def) => {
                const job = schedulerJobs.find((j) => j.id === def.id);
                const lastRun = job?.last_run ?? null;
                const jobStatus = jobStatuses[def.id] ?? "idle";
                const jobMessage = jobMessages[def.id] ?? "";
                const health = getJobHealth(lastRun, def.overdueSeconds);
                const logs = jobRunLogs[def.id] ?? [];
                const lastLog = logs[0] ?? null;
                const logsLoading = jobLogsLoading[def.id] ?? false;
                const Icon = def.icon;

                return (
                  <div
                    key={def.id}
                    className={`rounded-2xl border bg-card transition-all ${
                      jobStatus === "running"
                        ? "border-primary/40 shadow-md shadow-primary/5"
                        : jobStatus === "success"
                        ? "border-emerald-500/30"
                        : jobStatus === "error"
                        ? "border-rose-500/30"
                        : "border-border/60"
                    }`}
                  >
                    {/* Card header */}
                    <div className="flex items-start justify-between border-b border-border/40 px-5 py-4">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-border/60 bg-muted/30">
                          <Icon className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <p className="font-semibold text-sm leading-tight">{def.name}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{def.schedule}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {lastLog && <StatusBadge status={lastLog.status} />}
                        <PulsingDot health={health} />
                      </div>
                    </div>

                    {/* Card body */}
                    <div className="space-y-4 px-5 py-4">
                      {/* Stats row */}
                      <div className="flex flex-wrap gap-x-5 gap-y-1">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Last run</p>
                          <p className={`mt-0.5 text-sm font-semibold tabular-nums ${
                            health === "warning" ? "text-amber-600 dark:text-amber-400" : ""
                          }`}>
                            {schedulerLoading ? "…" : formatRelativeTime(lastRun)}
                          </p>
                        </div>
                        {lastLog?.finished_at && (
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Duration</p>
                            <p className="mt-0.5 text-sm font-semibold tabular-nums">
                              {formatDuration(lastLog.started_at, lastLog.finished_at)}
                            </p>
                          </div>
                        )}
                        {lastLog?.records_processed != null && (
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Records</p>
                            <p className="mt-0.5 text-sm font-semibold tabular-nums">
                              {lastLog.records_processed.toLocaleString()}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Run history dots */}
                      {logsLoading ? (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Loading history…
                        </div>
                      ) : (
                        <RunHistoryDots logs={logs} />
                      )}

                      {/* Last summary */}
                      {lastLog?.summary && (
                        <p className="text-xs leading-relaxed text-muted-foreground line-clamp-2">
                          {lastLog.summary}
                        </p>
                      )}
                      {lastLog?.error && (
                        <p className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-600 dark:text-rose-400 line-clamp-2">
                          {lastLog.error}
                        </p>
                      )}

                      {/* Status message */}
                      {jobStatus !== "idle" && (
                        <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium ${
                          jobStatus === "running"
                            ? "border-primary/20 bg-primary/5 text-primary"
                            : jobStatus === "success"
                            ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
                            : "border-rose-500/20 bg-rose-500/5 text-rose-600 dark:text-rose-400"
                        }`}>
                          {jobStatus === "running" ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : jobStatus === "success" ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : (
                            <XCircle className="h-3 w-3" />
                          )}
                          {jobStatus === "running" ? "Running — do not close this page…" : jobMessage}
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex gap-2 pt-1">
                        <Button
                          size="sm"
                          className="flex-1 gap-2 rounded-lg"
                          disabled={jobStatus === "running"}
                          onClick={() => { void triggerJob(def.id); }}
                        >
                          {jobStatus === "running" ? (
                            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Running…</>
                          ) : (
                            <><Play className="h-3.5 w-3.5" /> Run now</>
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-2 rounded-lg"
                          onClick={() => { void openJobLogs(def.id); }}
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Logs
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Job logs modal */}
            <Dialog open={logsModalJobId !== null} onOpenChange={(open) => { if (!open) setLogsModalJobId(null); }}>
              <DialogContent className="max-h-[85vh] max-w-4xl overflow-hidden p-0">
                <DialogHeader className="border-b border-border/60 px-6 py-4">
                  <DialogTitle className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <Terminal className="h-4 w-4 text-primary" />
                      <span className="text-base font-semibold">
                        {logsModalJobId
                          ? SCHEDULED_JOB_DEFS.find((d) => d.id === logsModalJobId)?.name
                          : ""}{" "}
                        — Run History
                      </span>
                    </div>
                    {logsModalJobId && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2 rounded-lg text-xs"
                        disabled={jobLogsLoading[logsModalJobId] ?? false}
                        onClick={() => { if (logsModalJobId) void fetchJobLogs(logsModalJobId); }}
                      >
                        <RefreshCw className={`h-3 w-3 ${(jobLogsLoading[logsModalJobId] ?? false) ? "animate-spin" : ""}`} />
                        Refresh
                      </Button>
                    )}
                  </DialogTitle>
                </DialogHeader>

                <div className="overflow-y-auto">
                  {logsModalJobId && (jobLogsLoading[logsModalJobId] ?? false) && (
                    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading logs…
                    </div>
                  )}

                  {logsModalJobId && !(jobLogsLoading[logsModalJobId] ?? false) && (() => {
                    const logs = jobRunLogs[logsModalJobId] ?? [];
                    if (logs.length === 0) {
                      return (
                        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                          <FileText className="h-8 w-8 text-muted-foreground/30" />
                          <p className="text-sm text-muted-foreground">
                            No run records yet. Logs appear after the first execution.
                          </p>
                        </div>
                      );
                    }
                    return (
                      <div className="divide-y divide-border/40">
                        {logs.map((log, idx) => (
                          <div key={log.id} className="px-6 py-4">
                            <div className="mb-2 flex flex-wrap items-center gap-3">
                              <span className="text-xs text-muted-foreground tabular-nums">
                                #{logs.length - idx}
                              </span>
                              <StatusBadge status={log.status} />
                              <span className="font-mono text-xs text-muted-foreground">
                                {safeFormatDate(log.started_at, "MMM d, yyyy · HH:mm:ss")}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {formatDuration(log.started_at, log.finished_at)}
                              </span>
                              {log.records_processed != null && (
                                <span className="text-xs text-muted-foreground">
                                  {log.records_processed.toLocaleString()} records
                                </span>
                              )}
                            </div>
                            {log.error && (
                              <p className="mt-1 rounded-md border border-rose-500/20 bg-rose-500/5 px-3 py-2 font-mono text-xs text-rose-600 dark:text-rose-400">
                                {log.error}
                              </p>
                            )}
                            {log.summary && (
                              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                {log.summary}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </DialogContent>
            </Dialog>
          </TabsContent>

          {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ HEALTH TAB */}
          <TabsContent value="system-health" className="space-y-4">

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold">Infrastructure</h2>
                <p className="text-sm text-muted-foreground">Live connection status for all platform services</p>
              </div>
              <Button
                onClick={() => { void fetchSystemHealth(); }}
                disabled={healthLoading}
                variant="outline"
                size="sm"
                className="gap-2 rounded-lg"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${healthLoading ? "animate-spin" : ""}`} />
                Check health
              </Button>
            </div>

            {/* Overall status banner */}
            {systemHealth && (
              <div className={`flex items-center justify-between rounded-2xl border p-4 ${overallTone.panel}`}>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-current/20 bg-background/60">
                    <OverallStatusIcon className={`h-5 w-5 ${overallTone.cls}`} />
                  </div>
                  <div>
                    <p className="font-semibold capitalize text-sm">System {String(systemHealth.overall)}</p>
                    <p className="text-xs text-muted-foreground">
                      {systemHealth.timestamp
                        ? `Checked ${new Date(systemHealth.timestamp as string).toLocaleTimeString()}`
                        : "Not checked yet"}
                    </p>
                  </div>
                </div>
                <Badge variant="outline" className={`rounded-full px-3 ${overallTone.badge}`}>
                  {overallTone.label}
                </Badge>
              </div>
            )}

            {/* Service cards */}
            <div className="grid gap-4 md:grid-cols-3">
              {[
                {
                  label: "Supabase",
                  icon: Database,
                  data: systemHealth?.services?.supabase,
                },
                {
                  label: "DataAPI Server",
                  icon: Server,
                  data: systemHealth?.services?.dataapi,
                },
                {
                  label: "Railway Backend",
                  icon: Activity,
                  data: systemHealth?.services?.backend,
                },
              ].map((svc) => (
                <div key={svc.label} className="rounded-2xl border border-border/60 bg-card p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{svc.label}</p>
                    <svc.icon className="h-4 w-4 text-muted-foreground/50" />
                  </div>
                  {healthLoading ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Checking…
                    </div>
                  ) : svc.data ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <div className={`h-2.5 w-2.5 rounded-full ${
                          String(svc.data.status) === "connected" ? "bg-emerald-500" :
                          String(svc.data.status) === "not_configured" ? "bg-amber-500" : "bg-rose-500"
                        }`} />
                        <span className="text-sm font-semibold capitalize">{String(svc.data.status)}</span>
                      </div>
                      {svc.data.url && (
                        <p className="truncate font-mono text-[11px] text-muted-foreground">
                          {String(svc.data.url)}
                        </p>
                      )}
                      {svc.data.uptime_seconds != null && (
                        <p className="text-xs text-muted-foreground">
                          Uptime: {Math.round(Number(svc.data.uptime_seconds) / 60)}m
                        </p>
                      )}
                      {svc.data.message && (
                        <p className="text-xs text-rose-500">{String(svc.data.message)}</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No data — press Check health</p>
                  )}
                </div>
              ))}
            </div>

            {/* DataAPI dashboard data */}
            {systemHealth?.dataapi_dashboard && !(systemHealth.dataapi_dashboard as Record<string, unknown>).error && (() => {
              const dash = systemHealth.dataapi_dashboard as Record<string, unknown>;
              return (
                <div className="grid gap-4 md:grid-cols-2">
                  {/* API Info */}
                  <Card className="rounded-2xl border-border/60">
                    <CardHeader className="border-b border-border/40 pb-3">
                      <CardTitle className="text-sm">DataAPI Info</CardTitle>
                    </CardHeader>
                    <CardContent className="divide-y divide-border/30 pt-0">
                      {[
                        { label: "Name", value: (dash.api as Record<string, string>)?.name },
                        { label: "Version", value: (dash.api as Record<string, string>)?.version },
                        { label: "Environment", value: (dash.api as Record<string, string>)?.environment },
                        { label: "Active Tickers", value: String(dash.active_tickers ?? "—") },
                      ].filter((r) => r.value).map((row) => (
                        <div key={row.label} className="flex items-center justify-between py-2.5">
                          <span className="text-xs text-muted-foreground">{row.label}</span>
                          <span className="font-mono text-xs font-medium">{row.value}</span>
                        </div>
                      ))}
                      {(dash.database as Record<string, unknown>)?.connected !== undefined && (
                        <div className="flex items-center justify-between py-2.5">
                          <span className="text-xs text-muted-foreground">DB Connected</span>
                          <Badge variant={
                            (dash.database as Record<string, boolean>).connected ? "default" : "destructive"
                          } className="text-[10px]">
                            {(dash.database as Record<string, boolean>).connected ? "Yes" : "No"}
                          </Badge>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Table counts */}
                  <Card className="rounded-2xl border-border/60">
                    <CardHeader className="border-b border-border/40 pb-3">
                      <CardTitle className="text-sm">Engine Database Tables</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      {(dash.tables as { table: string; row_count: number }[])?.length > 0 ? (
                        <div className="max-h-48 overflow-y-auto">
                          {(dash.tables as { table: string; row_count: number }[]).map((t) => (
                            <div
                              key={t.table}
                              className="flex items-center justify-between border-b border-border/30 px-4 py-2 last:border-b-0 hover:bg-muted/20"
                            >
                              <span className="max-w-[180px] truncate font-mono text-xs">{t.table}</span>
                              <span className="tabular-nums text-xs font-semibold">
                                {t.row_count >= 0 ? t.row_count.toLocaleString() : "—"}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="px-4 py-6 text-xs text-muted-foreground">No table data</p>
                      )}
                    </CardContent>
                  </Card>

                  {/* Engine workers */}
                  {(dash.engine_workers as unknown[])?.length > 0 && (
                    <Card className="rounded-2xl border-border/60 md:col-span-2">
                      <CardHeader className="border-b border-border/40 pb-3">
                        <CardTitle className="text-sm">Engine Worker Heartbeats</CardTitle>
                      </CardHeader>
                      <CardContent className="p-0 overflow-x-auto">
                        <Table className="min-w-[560px]">
                          <TableHeader>
                            <TableRow className="bg-muted/20 hover:bg-muted/20">
                              <TableHead className="pl-4 text-[10px] font-semibold uppercase tracking-wider">Worker</TableHead>
                              <TableHead className="text-[10px] font-semibold uppercase tracking-wider">Status</TableHead>
                              <TableHead className="text-[10px] font-semibold uppercase tracking-wider">Last Heartbeat</TableHead>
                              <TableHead className="text-[10px] font-semibold uppercase tracking-wider">Ago</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(dash.engine_workers as { worker_name: string; status: string; last_heartbeat: string | null; seconds_ago: number | null }[]).map((w) => (
                              <TableRow key={w.worker_name} className="border-b border-border/30">
                                <TableCell className="py-2.5 pl-4 font-mono text-xs">{w.worker_name}</TableCell>
                                <TableCell className="py-2.5">
                                  <Badge variant={w.status === "running" ? "default" : "secondary"} className="text-[10px]">
                                    {w.status}
                                  </Badge>
                                </TableCell>
                                <TableCell className="py-2.5 text-xs text-muted-foreground">{w.last_heartbeat || "—"}</TableCell>
                                <TableCell className="py-2.5 text-xs tabular-nums">
                                  {w.seconds_ago != null
                                    ? w.seconds_ago < 60 ? `${w.seconds_ago}s` : `${Math.round(w.seconds_ago / 60)}m`
                                    : "—"}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  )}

                  {/* Service clients */}
                  {(dash.service_clients as unknown[])?.length > 0 && (
                    <Card className="rounded-2xl border-border/60 md:col-span-2">
                      <CardHeader className="border-b border-border/40 pb-3">
                        <CardTitle className="text-sm">Service Clients (IAM)</CardTitle>
                      </CardHeader>
                      <CardContent className="p-0 overflow-x-auto">
                        <Table className="min-w-[560px]">
                          <TableHeader>
                            <TableRow className="bg-muted/20 hover:bg-muted/20">
                              <TableHead className="pl-4 text-[10px] font-semibold uppercase tracking-wider">Client ID</TableHead>
                              <TableHead className="text-[10px] font-semibold uppercase tracking-wider">Name</TableHead>
                              <TableHead className="text-[10px] font-semibold uppercase tracking-wider">Active</TableHead>
                              <TableHead className="text-[10px] font-semibold uppercase tracking-wider">Scopes</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(dash.service_clients as { client_id: string; display_name: string | null; is_active: boolean; scope_count: number }[]).map((c) => (
                              <TableRow key={c.client_id} className="border-b border-border/30">
                                <TableCell className="py-2.5 pl-4 font-mono text-xs">{c.client_id}</TableCell>
                                <TableCell className="py-2.5 text-xs">{c.display_name || "—"}</TableCell>
                                <TableCell className="py-2.5">
                                  <Badge variant={c.is_active ? "default" : "destructive"} className="text-[10px]">
                                    {c.is_active ? "Active" : "Inactive"}
                                  </Badge>
                                </TableCell>
                                <TableCell className="py-2.5 text-xs tabular-nums">{c.scope_count}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  )}
                </div>
              );
            })()}

            {/* Orphaned auth cleanup */}
            <Card className="rounded-2xl border-border/60">
              <CardHeader className="pb-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle className="text-sm">Orphaned Auth Cleanup</CardTitle>
                    <CardDescription className="mt-1 text-xs">
                      Removes Supabase Auth records with no matching profile row. These block email re-registration.
                    </CardDescription>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-2 rounded-lg"
                    disabled={purgeLoading || !BACKEND_URL}
                    onClick={() => void purgeOrphanedAuthUsers()}
                  >
                    {purgeLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    {purgeLoading ? "Purging…" : "Purge orphaned accounts"}
                  </Button>
                </div>
              </CardHeader>
              {purgeResult && (
                <CardContent className="border-t border-border/40 pt-4">
                  <p className="text-sm">
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                      {purgeResult.deleted} deleted
                    </span>
                    {purgeResult.failed > 0 && (
                      <span className="ml-2 text-rose-500">{purgeResult.failed} failed</span>
                    )}
                    {purgeResult.deleted === 0 && purgeResult.failed === 0 && (
                      <span className="ml-1 text-muted-foreground">— no orphaned records found</span>
                    )}
                  </p>
                </CardContent>
              )}
            </Card>

            {/* Query console */}
            <Card className="rounded-2xl border-border/60">
              <CardHeader className="border-b border-border/40 pb-4">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Terminal className="h-4 w-4 text-primary" />
                  Engine Database Query Console
                </CardTitle>
                <CardDescription className="text-xs">
                  Read-only SELECT queries against the engine database via DataAPI
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pt-4">
                {/* Preset buttons */}
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: "All Tickers", sql: "SELECT ticker, company_name, is_active FROM tickers ORDER BY ticker LIMIT 50" },
                    { label: "Latest Prices", sql: "SELECT t.ticker, ls.last_price, ls.price_change_pct, ls.rsi_14, ls.updated_at FROM latest_snapshot ls JOIN tickers t ON t.ticker_id = ls.ticker_id ORDER BY ls.updated_at DESC LIMIT 25" },
                    { label: "Latest Signals", sql: "SELECT t.ticker, ls.latest_signal, ls.signal_confidence, ls.signal_strategy, ls.signal_ts FROM latest_snapshot ls JOIN tickers t ON t.ticker_id = ls.ticker_id WHERE ls.latest_signal IS NOT NULL ORDER BY ls.signal_ts DESC LIMIT 25" },
                    { label: "Recent Trades", sql: "SELECT * FROM paper_trades ORDER BY created_at DESC LIMIT 20" },
                    { label: "Portfolio", sql: "SELECT * FROM portfolio_valuation ORDER BY valuation_date DESC LIMIT 5" },
                    { label: "Market News", sql: "SELECT * FROM market_news ORDER BY published_at DESC LIMIT 15" },
                  ].map((preset) => (
                    <Button
                      key={preset.label}
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-lg px-3 text-xs"
                      onClick={() => runQuery(preset.sql)}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>

                {/* Custom query */}
                <div className="space-y-2">
                  <Textarea
                    placeholder="SELECT * FROM tickers WHERE is_active = true LIMIT 10"
                    value={queryInput}
                    onChange={(e) => setQueryInput(e.target.value)}
                    className="min-h-[80px] rounded-xl border-border/70 font-mono text-xs"
                  />
                  <div className="flex items-center gap-3">
                    <Button
                      onClick={() => runQuery()}
                      disabled={queryLoading || !queryInput.trim()}
                      size="sm"
                      className="gap-2 rounded-lg"
                    >
                      {queryLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                      Execute
                    </Button>
                    {queryResults && (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {String(queryResults.row_count)} rows
                      </span>
                    )}
                  </div>
                </div>

                {/* Error */}
                {queryError && (
                  <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3">
                    <p className="font-mono text-xs text-rose-500">{queryError}</p>
                  </div>
                )}

                {/* Results table */}
                {(queryResults?.rows as unknown[])?.length > 0 && (
                  <div className="max-h-[400px] overflow-auto rounded-xl border border-border/60">
                    <Table className="min-w-max">
                      <TableHeader>
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          {Object.keys((queryResults!.rows as Record<string, unknown>[])[0]).map((col) => (
                            <TableHead key={col} className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider">
                              {col}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(queryResults!.rows as Record<string, string | null>[]).map((row, idx) => (
                          <TableRow key={idx} className="border-b border-border/30 hover:bg-muted/20">
                            {Object.values(row).map((val, ci) => (
                              <TableCell key={ci} className="max-w-[180px] truncate py-2 align-top font-mono text-xs">
                                {val !== null ? String(val) : <span className="text-muted-foreground/50">null</span>}
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
