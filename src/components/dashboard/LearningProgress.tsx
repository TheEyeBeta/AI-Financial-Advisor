import { BookOpen, Award, CheckCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useLearningTopics, useAchievements } from "@/hooks/use-data";

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
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-lg font-semibold">Learning Progress</CardTitle>
          <BookOpen className="h-5 w-5 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Loading...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg font-semibold">Learning Progress</CardTitle>
        <BookOpen className="h-5 w-5 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Overall Progress</span>
            <span className="font-medium">{totalProgress}%</span>
          </div>
          <Progress value={totalProgress} className="h-2" />
        </div>

        {topics.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4">
            No learning topics yet. Start learning to track your progress!
          </div>
        ) : (
          <div className="space-y-3">
            {topics.map((topic) => (
              <div key={topic.id} className="space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {topic.completed ? (
                      <CheckCircle className="h-4 w-4 text-success" />
                    ) : (
                      <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />
                    )}
                    <span className="text-sm">{topic.topic_name}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{topic.progress}%</span>
                </div>
                <Progress value={topic.progress} className="h-1.5" />
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 border-t pt-4">
          <div className="flex items-center gap-2 mb-2">
            <Award className="h-4 w-4 text-warning" />
            <span className="text-sm font-medium">Achievements</span>
          </div>
          {achievements.length === 0 ? (
            <div className="text-xs text-muted-foreground">No achievements yet. Keep trading to unlock achievements!</div>
          ) : (
            <div className="flex gap-2 flex-wrap">
              {achievements.map((achievement) => (
                <div
                  key={achievement.id}
                  className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1"
                >
                  <span>{achievement.icon || "🏆"}</span>
                  <span className="text-xs font-medium">{achievement.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
