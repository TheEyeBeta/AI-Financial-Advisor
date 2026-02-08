import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Users, Shield, Database, MessageSquare, TrendingUp, 
  Activity, Search, Download, Trash2, RefreshCw,
  BarChart3, UserCheck, UserX, Clock
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
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

interface User {
  id: string;
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

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

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
      fetchRecentActivity(),
    ]);
    setLoading(false);
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadAllData();
    setRefreshing(false);
    toast({ title: "Refreshed", description: "All data has been refreshed" });
  };

  const fetchUsers = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("users")
        .select("id, email, first_name, last_name, userType, is_verified, experience_level, risk_level, created_at")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setUsers(data || []);
      setFilteredUsers(data || []);
    } catch (error: unknown) {
      console.error("Error fetching users:", error);
    }
  }, []);

  const fetchChatStats = useCallback(async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      const [chatsResult, messagesResult, todayResult] = await Promise.all([
        supabase.from("chats").select("id", { count: "exact", head: true }),
        supabase.from("chat_messages").select("id", { count: "exact", head: true }),
        supabase.from("chats").select("id", { count: "exact", head: true }).gte("updated_at", today),
      ]);

      setChatStats({
        totalChats: chatsResult.count || 0,
        totalMessages: messagesResult.count || 0,
        activeToday: todayResult.count || 0,
      });
    } catch (error) {
      console.error("Error fetching chat stats:", error);
    }
  }, []);

  const fetchTradingStats = useCallback(async () => {
    try {
      const [positionsResult, tradesResult, journalResult] = await Promise.all([
        supabase.from("open_positions").select("id", { count: "exact", head: true }),
        supabase.from("trades").select("id", { count: "exact", head: true }),
        supabase.from("trade_journal").select("id", { count: "exact", head: true }),
      ]);

      setTradingStats({
        totalPositions: positionsResult.count || 0,
        totalTrades: tradesResult.count || 0,
        totalJournalEntries: journalResult.count || 0,
      });
    } catch (error) {
      console.error("Error fetching trading stats:", error);
    }
  }, []);

  const fetchRecentActivity = useCallback(async () => {
    try {
      // Get recent chat messages as activity
      const { data } = await supabase
        .from("chat_messages")
        .select("id, user_id, role, created_at")
        .order("created_at", { ascending: false })
        .limit(10);

      if (data) {
        // Map to activity format
        const activities: ActivityLog[] = data.map((msg) => ({
          id: msg.id,
          user_email: "User",
          action: msg.role === "user" ? "Sent message" : "Received AI response",
          timestamp: msg.created_at,
        }));
        setRecentActivity(activities);
      }
    } catch (error) {
      console.error("Error fetching activity:", error);
    }
  }, []);

  const loadAllData = useCallback(async () => {
    setLoading(true);
    await Promise.all([
      fetchUsers(),
      fetchChatStats(),
      fetchTradingStats(),
      fetchRecentActivity(),
    ]);
    setLoading(false);
  }, [fetchUsers, fetchChatStats, fetchTradingStats, fetchRecentActivity]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  const toggleAdminStatus = async (userId: string, currentType: 'User' | 'Admin') => {
    const newType = currentType === 'Admin' ? 'User' : 'Admin';
    try {
      const { error } = await supabase
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

  const deleteUser = async (userId: string) => {
    try {
      const { error } = await supabase
        .from("users")
        .delete()
        .eq("id", userId);

      if (error) throw error;

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

  const stats = {
    totalUsers: users.length,
    adminUsers: users.filter((u) => u.userType === 'Admin').length,
    verifiedUsers: users.filter((u) => u.is_verified).length,
    beginners: users.filter((u) => u.experience_level === "beginner").length,
    intermediate: users.filter((u) => u.experience_level === "intermediate").length,
    advanced: users.filter((u) => u.experience_level === "advanced").length,
  };

  return (
    <AppLayout title="Admin Panel">
      <div className="space-y-6">
        {/* Header with Refresh */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Admin Dashboard</h1>
            <p className="text-muted-foreground">Manage users, view analytics, and monitor system health</p>
          </div>
          <Button onClick={handleRefresh} disabled={refreshing} variant="outline" className="gap-2">
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Connection Test */}
        <SupabaseConnectionTest />

        {/* Stats Overview */}
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total Users</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalUsers}</div>
              <p className="text-xs text-muted-foreground">
                {stats.verifiedUsers} verified ({stats.totalUsers > 0 ? Math.round((stats.verifiedUsers / stats.totalUsers) * 100) : 0}%)
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Chats</CardTitle>
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{chatStats.totalChats}</div>
              <p className="text-xs text-muted-foreground">
                {chatStats.totalMessages} messages • {chatStats.activeToday} active today
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Trading Activity</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{tradingStats.totalPositions}</div>
              <p className="text-xs text-muted-foreground">
                {tradingStats.totalTrades} trades • {tradingStats.totalJournalEntries} journal entries
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Admins</CardTitle>
              <Shield className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.adminUsers}</div>
              <p className="text-xs text-muted-foreground">
                System administrators
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Tabs for different sections */}
        <Tabs defaultValue="users" className="space-y-4">
          <TabsList>
            <TabsTrigger value="users" className="gap-2">
              <Users className="h-4 w-4" />
              Users
            </TabsTrigger>
            <TabsTrigger value="analytics" className="gap-2">
              <BarChart3 className="h-4 w-4" />
              Analytics
            </TabsTrigger>
            <TabsTrigger value="activity" className="gap-2">
              <Activity className="h-4 w-4" />
              Activity
            </TabsTrigger>
          </TabsList>

          {/* Users Tab */}
          <TabsContent value="users" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div>
                    <CardTitle>User Management</CardTitle>
                    <CardDescription>View and manage all registered users</CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search users..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-8 w-[200px]"
                      />
                    </div>
                    <Button onClick={exportUsers} variant="outline" size="icon">
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="text-sm text-muted-foreground py-4">Loading users...</div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>User</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Experience</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Role</TableHead>
                          <TableHead>Joined</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredUsers.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                              {searchQuery ? "No users match your search" : "No users found"}
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredUsers.map((user) => (
                            <TableRow key={user.id}>
                              <TableCell>
                                <div className="font-medium">
                                  {user.first_name || user.last_name
                                    ? `${user.first_name || ""} ${user.last_name || ""}`.trim()
                                    : "No name"}
                                </div>
                              </TableCell>
                              <TableCell className="font-mono text-sm">{user.email || "N/A"}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="capitalize">
                                  {user.experience_level || "unknown"}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                {user.is_verified ? (
                                  <Badge className="bg-green-500/10 text-green-700 dark:text-green-400">
                                    <UserCheck className="h-3 w-3 mr-1" />
                                    Verified
                                  </Badge>
                                ) : (
                                  <Badge variant="secondary">
                                    <UserX className="h-3 w-3 mr-1" />
                                    Unverified
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell>
                                {user.userType === 'Admin' ? (
                                  <Badge className="bg-blue-500/10 text-blue-700 dark:text-blue-400">
                                    <Shield className="h-3 w-3 mr-1" />
                                    Admin
                                  </Badge>
                                ) : (
                                  <Badge variant="outline">User</Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground">
                                {format(new Date(user.created_at), "MMM d, yyyy")}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-2">
                                  {user.id !== userProfile?.id && (
                                    <>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => toggleAdminStatus(user.id, user.userType)}
                                      >
                                        {user.userType === 'Admin' ? "Demote" : "Promote"}
                                      </Button>
                                      <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                          <Button variant="destructive" size="sm">
                                            <Trash2 className="h-4 w-4" />
                                          </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                          <AlertDialogHeader>
                                            <AlertDialogTitle>Delete User?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                              This will permanently delete {user.email || "this user"} and all their data including chats, trades, and journal entries. This cannot be undone.
                                            </AlertDialogDescription>
                                          </AlertDialogHeader>
                                          <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction onClick={() => deleteUser(user.id)}>
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
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Analytics Tab */}
          <TabsContent value="analytics" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              {/* User Experience Distribution */}
              <Card>
                <CardHeader>
                  <CardTitle>User Experience Levels</CardTitle>
                  <CardDescription>Distribution of users by experience</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-3 w-3 rounded-full bg-green-500" />
                        <span className="text-sm">Beginner</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{stats.beginners}</span>
                        <span className="text-xs text-muted-foreground">
                          ({stats.totalUsers > 0 ? Math.round((stats.beginners / stats.totalUsers) * 100) : 0}%)
                        </span>
                      </div>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div 
                        className="h-full bg-green-500 transition-all" 
                        style={{ width: `${stats.totalUsers > 0 ? (stats.beginners / stats.totalUsers) * 100 : 0}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-3 w-3 rounded-full bg-yellow-500" />
                        <span className="text-sm">Intermediate</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{stats.intermediate}</span>
                        <span className="text-xs text-muted-foreground">
                          ({stats.totalUsers > 0 ? Math.round((stats.intermediate / stats.totalUsers) * 100) : 0}%)
                        </span>
                      </div>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div 
                        className="h-full bg-yellow-500 transition-all" 
                        style={{ width: `${stats.totalUsers > 0 ? (stats.intermediate / stats.totalUsers) * 100 : 0}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-3 w-3 rounded-full bg-red-500" />
                        <span className="text-sm">Advanced</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{stats.advanced}</span>
                        <span className="text-xs text-muted-foreground">
                          ({stats.totalUsers > 0 ? Math.round((stats.advanced / stats.totalUsers) * 100) : 0}%)
                        </span>
                      </div>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div 
                        className="h-full bg-red-500 transition-all" 
                        style={{ width: `${stats.totalUsers > 0 ? (stats.advanced / stats.totalUsers) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Platform Statistics */}
              <Card>
                <CardHeader>
                  <CardTitle>Platform Statistics</CardTitle>
                  <CardDescription>Overall platform usage metrics</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                      <div className="flex items-center gap-3">
                        <MessageSquare className="h-5 w-5 text-primary" />
                        <div>
                          <div className="font-medium">Total Conversations</div>
                          <div className="text-xs text-muted-foreground">AI chat sessions</div>
                        </div>
                      </div>
                      <div className="text-2xl font-bold">{chatStats.totalChats}</div>
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                      <div className="flex items-center gap-3">
                        <Activity className="h-5 w-5 text-primary" />
                        <div>
                          <div className="font-medium">Total Messages</div>
                          <div className="text-xs text-muted-foreground">User + AI messages</div>
                        </div>
                      </div>
                      <div className="text-2xl font-bold">{chatStats.totalMessages}</div>
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                      <div className="flex items-center gap-3">
                        <TrendingUp className="h-5 w-5 text-primary" />
                        <div>
                          <div className="font-medium">Open Positions</div>
                          <div className="text-xs text-muted-foreground">Active paper trades</div>
                        </div>
                      </div>
                      <div className="text-2xl font-bold">{tradingStats.totalPositions}</div>
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                      <div className="flex items-center gap-3">
                        <Database className="h-5 w-5 text-primary" />
                        <div>
                          <div className="font-medium">Journal Entries</div>
                          <div className="text-xs text-muted-foreground">Trade documentation</div>
                        </div>
                      </div>
                      <div className="text-2xl font-bold">{tradingStats.totalJournalEntries}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Activity Tab */}
          <TabsContent value="activity" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
                <CardDescription>Latest actions across the platform</CardDescription>
              </CardHeader>
              <CardContent>
                {recentActivity.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">
                    No recent activity
                  </div>
                ) : (
                  <div className="space-y-4">
                    {recentActivity.map((activity) => (
                      <div key={activity.id} className="flex items-center gap-4 p-3 rounded-lg bg-muted/30">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                          <MessageSquare className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1">
                          <div className="font-medium">{activity.action}</div>
                          <div className="text-xs text-muted-foreground">
                            {format(new Date(activity.timestamp), "MMM d, yyyy 'at' h:mm a")}
                          </div>
                        </div>
                        <Clock className="h-4 w-4 text-muted-foreground" />
                      </div>
                    ))}
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
