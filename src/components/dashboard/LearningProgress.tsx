import { BookOpen, Award, CheckCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

const topics = [
  { name: "Stock Market Basics", progress: 100, completed: true },
  { name: "Technical Analysis", progress: 75, completed: false },
  { name: "Options Trading", progress: 40, completed: false },
  { name: "Risk Management", progress: 60, completed: false },
  { name: "Portfolio Theory", progress: 20, completed: false },
];

const achievements = [
  { name: "First Trade", icon: "🎯" },
  { name: "Week Streak", icon: "🔥" },
  { name: "Profit Master", icon: "💰" },
];

export function LearningProgress() {
  const totalProgress = Math.round(
    topics.reduce((acc, topic) => acc + topic.progress, 0) / topics.length
  );

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

        <div className="space-y-3">
          {topics.map((topic) => (
            <div key={topic.name} className="space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {topic.completed ? (
                    <CheckCircle className="h-4 w-4 text-success" />
                  ) : (
                    <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30" />
                  )}
                  <span className="text-sm">{topic.name}</span>
                </div>
                <span className="text-xs text-muted-foreground">{topic.progress}%</span>
              </div>
              <Progress value={topic.progress} className="h-1.5" />
            </div>
          ))}
        </div>

        <div className="mt-4 border-t pt-4">
          <div className="flex items-center gap-2 mb-2">
            <Award className="h-4 w-4 text-warning" />
            <span className="text-sm font-medium">Achievements</span>
          </div>
          <div className="flex gap-2">
            {achievements.map((achievement) => (
              <div
                key={achievement.name}
                className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1"
              >
                <span>{achievement.icon}</span>
                <span className="text-xs font-medium">{achievement.name}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
