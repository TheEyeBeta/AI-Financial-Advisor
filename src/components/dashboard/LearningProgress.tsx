import { BookOpen, Award, CheckCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useLearningTopics, useAchievements } from "@/hooks/use-data";
import { cn } from "@/lib/utils";

export function LearningProgress() {
  const { data: topics = [], isLoading: topicsLoading } = useLearningTopics();
  const { data: achievements = [], isLoading: achievementsLoading } = useAchievements();

  const totalProgress = topics.length > 0
    ? Math.round(
        topics.reduce((acc, topic) => acc + topic.progress, 0) / topics.length
      )
    : 0;

  if (topicsLoading || achievementsLoading) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardContent className="pt-5 pb-4">
          <div className="h-4 w-24 bg-muted/50 rounded animate-pulse mb-4" />
          <div className="h-2 bg-muted/30 rounded animate-pulse mb-6" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-16 bg-muted/30 rounded-lg animate-pulse" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardContent className="pt-5 pb-4">
        {/* Header with overall progress */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            <p className="text-xs text-muted-foreground/70 uppercase tracking-wide">Learning</p>
          </div>
          <span className="text-sm font-semibold">{totalProgress}%</span>
        </div>
        <Progress value={totalProgress} className="h-1.5 mb-5" />

        {topics.length === 0 ? (
          <div className="py-6 text-center">
            <BookOpen className="h-8 w-8 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No learning topics yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Start learning to track progress</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {topics.map((topic) => (
              <div 
                key={topic.id} 
                className={cn(
                  "relative rounded-xl p-3 transition-colors",
                  topic.completed 
                    ? "bg-profit/10" 
                    : "bg-muted/30 hover:bg-muted/40"
                )}
              >
                <div className="flex items-center gap-1.5 mb-2">
                  {topic.completed ? (
                    <CheckCircle className="h-3.5 w-3.5 text-profit" />
                  ) : (
                    <div className="h-3.5 w-3.5 rounded-full border-2 border-muted-foreground/20" />
                  )}
                  <span className="text-xs font-medium truncate">{topic.topic_name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Progress value={topic.progress} className="h-1 flex-1" />
                  <span className="text-[10px] text-muted-foreground/60 min-w-[28px] text-right">
                    {topic.progress}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Achievements */}
        {(achievements.length > 0 || topics.length > 0) && (
          <div className="mt-5 pt-4 border-t border-border/30">
            <div className="flex items-center gap-1.5 mb-3">
              <Award className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">Achievements</span>
            </div>
            {achievements.length === 0 ? (
              <p className="text-xs text-muted-foreground/50">Keep trading to unlock achievements</p>
            ) : (
              <div className="flex gap-2 flex-wrap">
                {achievements.map((achievement) => (
                  <div
                    key={achievement.id}
                    className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs"
                  >
                    <span>{achievement.icon || "🏆"}</span>
                    <span className="font-medium text-amber-600 dark:text-amber-400">{achievement.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
