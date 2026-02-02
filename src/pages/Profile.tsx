import { useState, useEffect } from "react";
import { User, Save, Loader2, Mail, Calendar, TrendingUp, Shield, AlertTriangle, RefreshCw } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { toast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/error";
import { format } from "date-fns";

// Helper function to format risk level for display
const formatRiskLevel = (riskLevel: string | null | undefined): string => {
  if (!riskLevel) return "Not set";
  if (riskLevel === "very_high") return "Very High";
  if (riskLevel === "mid") return "Moderate";
  return riskLevel.charAt(0).toUpperCase() + riskLevel.slice(1);
};

const Profile = () => {
  const { user, userProfile, profileLoading } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  const [firstName, setFirstName] = useState(userProfile?.first_name || "");
  const [lastName, setLastName] = useState(userProfile?.last_name || "");
  const [age, setAge] = useState(userProfile?.age?.toString() || "");
  const [experienceLevel, setExperienceLevel] = useState(userProfile?.experience_level || "beginner");
  const [riskLevel, setRiskLevel] = useState(userProfile?.risk_level || "mid");
  const [riskOverride, setRiskOverride] = useState(false);
  const [showRiskOverride, setShowRiskOverride] = useState(false);

  // Sync form state when userProfile changes
  useEffect(() => {
    if (userProfile) {
      setFirstName(userProfile.first_name || "");
      setLastName(userProfile.last_name || "");
      setAge(userProfile.age?.toString() || "");
      setExperienceLevel(userProfile.experience_level || "beginner");
      setRiskLevel(userProfile.risk_level || "mid");
    }
  }, [userProfile]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile?.id) return;

    setIsSaving(true);
    try {
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
      // Always save risk level (whether calculated or overridden)
      if (riskLevel) {
        updates.risk_level = riskLevel as 'low' | 'mid' | 'high' | 'very_high';
      }

      const { error } = await supabase
        .from("users")
        .update(updates)
        .eq("id", userProfile.id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Profile updated successfully",
      });
      
      // Refresh the page to update the profile in context
      window.location.reload();
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
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Profile & Settings">
      <div className="space-y-6 max-w-4xl">
        {/* Page Header */}
        <div className="flex items-center gap-3 animate-in fade-in duration-300">
          <div className="p-2 rounded-lg bg-primary/10">
            <User className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">Profile & Settings</h1>
            <p className="text-sm text-muted-foreground">Manage your account and preferences</p>
          </div>
        </div>

        {/* Account Info Card */}
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm animate-in fade-in duration-300" style={{ animationDelay: '50ms' }}>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Mail className="h-4 w-4 text-muted-foreground" />
              Account Information
            </CardTitle>
            <CardDescription className="text-xs">Your account details and verification status</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  Email
                </Label>
                <Input value={user?.email || ""} disabled className="bg-muted" />
                <p className="text-xs text-muted-foreground">
                  Email cannot be changed
                </p>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  Member Since
                </Label>
                <Input
                  value={userProfile?.created_at ? format(new Date(userProfile.created_at), "MMMM d, yyyy") : "N/A"}
                  disabled
                  className="bg-muted"
                />
              </div>
            </div>
            <div className="flex items-center gap-4 pt-2">
              <div className="flex items-center gap-2">
                <Label>Verification Status:</Label>
                {userProfile?.is_verified ? (
                  <Badge variant="default" className="bg-green-500">
                    Verified
                  </Badge>
                ) : (
                  <Badge variant="secondary">Unverified</Badge>
                )}
              </div>
              {userProfile?.userType === "Admin" && (
                <Badge variant="outline" className="flex items-center gap-1">
                  <Shield className="h-3 w-3" />
                  Admin
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Profile Details Card */}
        <Card className="border-border/50 bg-card/50 backdrop-blur-sm animate-in fade-in duration-300" style={{ animationDelay: '100ms' }}>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Profile Details</CardTitle>
            <CardDescription className="text-xs">Update your personal information and preferences</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name</Label>
                  <Input
                    id="firstName"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Enter your first name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input
                    id="lastName"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Enter your last name"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="age">Age</Label>
                <Input
                  id="age"
                  type="number"
                  min="13"
                  max="150"
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  placeholder="Enter your age"
                />
                <p className="text-xs text-muted-foreground">
                  Must be between 13 and 150
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="experienceLevel">Experience Level</Label>
                  <Select value={experienceLevel} onValueChange={setExperienceLevel}>
                    <SelectTrigger id="experienceLevel">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="beginner">Beginner</SelectItem>
                      <SelectItem value="intermediate">Intermediate</SelectItem>
                      <SelectItem value="advanced">Advanced</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Used to personalize AI advisor responses
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="riskLevel">Risk Tolerance</Label>
                    {!showRiskOverride && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowRiskOverride(true)}
                        className="h-auto py-1 text-xs"
                      >
                        <RefreshCw className="h-3 w-3 mr-1" />
                        Override
                      </Button>
                    )}
                  </div>
                  {showRiskOverride ? (
                    <div className="space-y-2">
                      <Select value={riskLevel} onValueChange={setRiskLevel}>
                        <SelectTrigger id="riskLevel">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Low</SelectItem>
                          <SelectItem value="mid">Moderate</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                          <SelectItem value="very_high">Very High</SelectItem>
                        </SelectContent>
                      </Select>
                      <div className="flex items-start gap-2 p-2 rounded-md bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800">
                        <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5 shrink-0" />
                        <p className="text-xs text-yellow-800 dark:text-yellow-200">
                          You're manually overriding your calculated risk level. This may not align with your profile.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setShowRiskOverride(false);
                          setRiskLevel(userProfile?.risk_level || "mid");
                        }}
                        className="w-full"
                      >
                        Use Calculated Risk Level
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="p-3 rounded-md bg-muted border">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">
                            {formatRiskLevel(userProfile?.risk_level)}
                          </span>
                          <Badge variant="outline" className="text-xs">
                            Algorithm Calculated
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Based on your age, marital status, and investment goals
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="submit" disabled={isSaving}>
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
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
};

export default Profile;
