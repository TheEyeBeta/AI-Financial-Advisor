import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  BookOpen,
  Award,
  CheckCircle,
  ChevronRight,
  GraduationCap,
  Trophy,
  Star,
  RotateCcw,
} from "lucide-react";
import {
  useLearningTopics,
  useAchievements,
  useInitializeLearningTopics,
  useUpdateLearningProgress,
} from "@/hooks/use-data";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { useState } from "react";

const Learning = () => {
  const { data: topics = [], isLoading: topicsLoading } = useLearningTopics();
  const { data: achievements = [], isLoading: achievementsLoading } = useAchievements();
  const { userProfile } = useAuth();
  const initializeTopics = useInitializeLearningTopics();
  const updateProgress = useUpdateLearningProgress();
  const navigate = useNavigate();
  const [expandedTopic, setExpandedTopic] = useState<string | null>(null);

  const totalProgress = topics.length > 0
    ? Math.round(topics.reduce((acc, topic) => acc + topic.progress, 0) / topics.length)
    : 0;

  const completedCount = topics.filter((t) => t.completed).length;

  const handleToggleComplete = async (topicName: string, currentProgress: number, isCompleted: boolean) => {
    try {
      if (isCompleted) {
        // Mark as incomplete
        await updateProgress.mutateAsync({ topicName, progress: 0, completed: false });
        toast({ title: "Topic reset", description: `"${topicName}" marked as incomplete.` });
      } else {
        // Mark as complete
        await updateProgress.mutateAsync({ topicName, progress: 100, completed: true });
        toast({ title: "Topic completed!", description: `Great job finishing "${topicName}"!` });
      }
    } catch {
      toast({
        title: "Error",
        description: "Failed to update progress. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleInitialize = async () => {
    try {
      const experienceLevel = (userProfile?.experience_level as 'beginner' | 'intermediate' | 'advanced') || 'beginner';
      await initializeTopics.mutateAsync(experienceLevel);
      toast({
        title: "Learning path created!",
        description: "Your personalized curriculum is ready.",
      });
    } catch {
      toast({
        title: "Error",
        description: "Failed to initialize topics. Please try again.",
        variant: "destructive",
      });
    }
  };

  const isLoading = topicsLoading || achievementsLoading;

  if (isLoading) {
    return (
      <AppLayout title="Learning">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="h-8 w-48 bg-muted/50 rounded animate-pulse" />
          <div className="h-4 w-64 bg-muted/30 rounded animate-pulse" />
          <div className="h-24 bg-muted/30 rounded-xl animate-pulse" />
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-16 bg-muted/30 rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Learning">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="animate-in fade-in duration-300">
          <div className="flex items-center gap-3 mb-1">
            <GraduationCap className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold text-foreground">Learning Center</h1>
          </div>
          <p className="text-sm text-muted-foreground/70">
            Work through each topic at your own pace. Check off topics as you complete them.
          </p>
        </div>

        {topics.length === 0 ? (
          /* Empty State - Initialize Topics */
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardContent className="py-16 text-center">
              <BookOpen className="h-14 w-14 mx-auto mb-4 text-muted-foreground/20" />
              <h2 className="text-lg font-semibold mb-2">Start Your Learning Journey</h2>
              <p className="text-sm text-muted-foreground/70 max-w-md mx-auto mb-6">
                Get a personalized curriculum based on your experience level.
                Topics are tailored to help you grow as an investor.
              </p>
              <div className="flex flex-col items-center gap-3">
                <Badge variant="outline" className="text-xs px-3 py-1">
                  Level: {userProfile?.experience_level || 'beginner'}
                </Badge>
                <Button
                  onClick={handleInitialize}
                  disabled={initializeTopics.isPending}
                  className="gap-2"
                >
                  <BookOpen className="h-4 w-4" />
                  {initializeTopics.isPending ? "Creating curriculum..." : "Generate My Curriculum"}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Overall Progress Card */}
            <Card className="border-border/50 bg-card/50 backdrop-blur-sm animate-in fade-in duration-300" style={{ animationDelay: '50ms' }}>
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Trophy className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">Overall Progress</p>
                      <p className="text-xs text-muted-foreground/60">
                        {completedCount} of {topics.length} topics completed
                      </p>
                    </div>
                  </div>
                  <span className="text-2xl font-bold text-primary">{totalProgress}%</span>
                </div>
                <Progress value={totalProgress} className="h-2" />
              </CardContent>
            </Card>

            {/* Topics List - W3Schools Style */}
            <div className="space-y-2 animate-in fade-in duration-300" style={{ animationDelay: '100ms' }}>
              <div className="flex items-center justify-between px-1">
                <p className="text-xs text-muted-foreground/70 uppercase tracking-wide font-medium">
                  Curriculum
                </p>
                <p className="text-xs text-muted-foreground/50">
                  {completedCount}/{topics.length} done
                </p>
              </div>

              {topics.map((topic, index) => {
                const isExpanded = expandedTopic === topic.id;

                return (
                  <Card
                    key={topic.id}
                    className={cn(
                      "border-border/50 backdrop-blur-sm transition-all duration-200",
                      topic.completed
                        ? "bg-profit/5 border-profit/20"
                        : "bg-card/50 hover:bg-muted/30"
                    )}
                  >
                    <CardContent className="p-0">
                      <div className="flex items-center gap-3 p-4">
                        {/* Step Number / Checkbox */}
                        <div className="flex-shrink-0">
                          <Checkbox
                            checked={topic.completed}
                            onCheckedChange={() =>
                              handleToggleComplete(topic.topic_name, topic.progress, topic.completed)
                            }
                            disabled={updateProgress.isPending}
                            className={cn(
                              "h-6 w-6 rounded-md transition-colors",
                              topic.completed
                                ? "border-profit data-[state=checked]:bg-profit data-[state=checked]:border-profit"
                                : "border-muted-foreground/30"
                            )}
                          />
                        </div>

                        {/* Topic Info */}
                        <div
                          className="flex-1 min-w-0 cursor-pointer"
                          onClick={() => setExpandedTopic(isExpanded ? null : topic.id)}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground/50 font-mono min-w-[28px]">
                              {String(index + 1).padStart(2, '0')}
                            </span>
                            <span
                              className={cn(
                                "text-sm font-medium truncate",
                                topic.completed && "line-through text-muted-foreground/60"
                              )}
                            >
                              {topic.topic_name}
                            </span>
                            {topic.completed && (
                              <CheckCircle className="h-4 w-4 text-profit flex-shrink-0" />
                            )}
                          </div>
                          {!topic.completed && topic.progress > 0 && (
                            <div className="flex items-center gap-2 mt-1.5 ml-[28px]">
                              <Progress value={topic.progress} className="h-1 flex-1 max-w-[200px]" />
                              <span className="text-[10px] text-muted-foreground/50">{topic.progress}%</span>
                            </div>
                          )}
                        </div>

                        {/* Action */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {topic.completed ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 text-xs text-muted-foreground/60 hover:text-foreground gap-1"
                              onClick={() =>
                                handleToggleComplete(topic.topic_name, topic.progress, topic.completed)
                              }
                            >
                              <RotateCcw className="h-3 w-3" />
                              Reset
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 text-xs gap-1 text-primary hover:text-primary"
                              onClick={() =>
                                navigate('/advisor', {
                                  state: { initialMessage: `Teach me about: ${topic.topic_name}` },
                                })
                              }
                            >
                              Learn
                              <ChevronRight className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Expanded Detail */}
                      {isExpanded && !topic.completed && (
                        <div className="px-4 pb-4 pt-0 border-t border-border/20 mt-0">
                          <div className="flex items-center gap-3 pt-3">
                            <Button
                              size="sm"
                              className="gap-1.5"
                              onClick={() =>
                                navigate('/advisor', {
                                  state: { initialMessage: `Teach me about: ${topic.topic_name}` },
                                })
                              }
                            >
                              <BookOpen className="h-3.5 w-3.5" />
                              Start Lesson
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5"
                              onClick={() =>
                                handleToggleComplete(topic.topic_name, topic.progress, topic.completed)
                              }
                            >
                              <CheckCircle className="h-3.5 w-3.5" />
                              Mark Complete
                            </Button>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Achievements Section */}
            <Card className="border-border/50 bg-card/50 backdrop-blur-sm animate-in fade-in duration-300" style={{ animationDelay: '150ms' }}>
              <CardContent className="pt-5 pb-4">
                <div className="flex items-center gap-2 mb-4">
                  <Award className="h-4 w-4 text-amber-500" />
                  <p className="text-xs text-muted-foreground/70 uppercase tracking-wide font-medium">
                    Achievements
                  </p>
                </div>
                {achievements.length === 0 ? (
                  <div className="py-4 text-center">
                    <Star className="h-8 w-8 mx-auto mb-2 text-muted-foreground/20" />
                    <p className="text-sm text-muted-foreground/60">
                      Complete topics and trade to unlock achievements
                    </p>
                  </div>
                ) : (
                  <div className="flex gap-2 flex-wrap">
                    {achievements.map((achievement) => (
                      <div
                        key={achievement.id}
                        className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1.5 text-xs"
                      >
                        <span>{achievement.icon || "🏆"}</span>
                        <span className="font-medium text-amber-600 dark:text-amber-400">
                          {achievement.name}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
};

export default Learning;
