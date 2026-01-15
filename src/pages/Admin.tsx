import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Users, Shield, Database, Settings } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { useState, useEffect } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { SupabaseConnectionTest } from "@/utils/test-connection";

interface User {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  is_admin: boolean;
  is_verified: boolean;
  created_at: string;
}

export default function Admin() {
  const { userProfile } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const { data, error } = await supabase
        .from("users")
        .select("id, email, first_name, last_name, is_admin, is_verified, created_at")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setUsers(data || []);
    } catch (error: any) {
      console.error("Error fetching users:", error);
      toast({
        title: "Error",
        description: "Failed to load users",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleAdminStatus = async (userId: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from("users")
        .update({ is_admin: !currentStatus })
        .eq("id", userId);

      if (error) throw error;

      toast({
        title: "Success",
        description: `User ${!currentStatus ? "promoted to" : "removed from"} admin`,
      });

      // Refresh users list
      fetchUsers();
    } catch (error: any) {
      console.error("Error updating admin status:", error);
      toast({
        title: "Error",
        description: "Failed to update admin status",
        variant: "destructive",
      });
    }
  };

  const stats = {
    totalUsers: users.length,
    adminUsers: users.filter((u) => u.is_admin).length,
    verifiedUsers: users.filter((u) => u.is_verified).length,
  };

  return (
    <AppLayout title="Admin Panel">
      <div className="space-y-4 sm:space-y-6">
        {/* Connection Test */}
        <SupabaseConnectionTest />

        {/* Stats Cards */}
        <div className="grid gap-4 sm:gap-6 grid-cols-1 lg:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-lg font-semibold">Total Users</CardTitle>
              <Users className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats.totalUsers}</div>
              <p className="text-xs text-muted-foreground mt-1">Registered users</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-lg font-semibold">Admins</CardTitle>
              <Shield className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats.adminUsers}</div>
              <p className="text-xs text-muted-foreground mt-1">Administrators</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-lg font-semibold">Verified</CardTitle>
              <Database className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{stats.verifiedUsers}</div>
              <p className="text-xs text-muted-foreground mt-1">Email verified</p>
            </CardContent>
          </Card>
        </div>

        {/* Users Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold">User Management</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-sm text-muted-foreground py-4">Loading users...</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Joined</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          No users found
                        </TableCell>
                      </TableRow>
                    ) : (
                      users.map((user) => (
                        <TableRow key={user.id}>
                          <TableCell>
                            {user.first_name || user.last_name
                              ? `${user.first_name || ""} ${user.last_name || ""}`.trim()
                              : "N/A"}
                          </TableCell>
                          <TableCell className="font-mono text-sm">{user.email || "N/A"}</TableCell>
                          <TableCell>
                            {user.is_verified ? (
                              <Badge variant="default" className="bg-green-500/10 text-green-700 dark:text-green-400">
                                Verified
                              </Badge>
                            ) : (
                              <Badge variant="secondary">Unverified</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {user.is_admin ? (
                              <Badge variant="default" className="bg-blue-500/10 text-blue-700 dark:text-blue-400">
                                Admin
                              </Badge>
                            ) : (
                              <Badge variant="outline">User</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {new Date(user.created_at).toLocaleDateString()}
                          </TableCell>
                          <TableCell className="text-right">
                            {user.id !== userProfile?.id && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => toggleAdminStatus(user.id, user.is_admin)}
                              >
                                {user.is_admin ? "Remove Admin" : "Make Admin"}
                              </Button>
                            )}
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
      </div>
    </AppLayout>
  );
}
