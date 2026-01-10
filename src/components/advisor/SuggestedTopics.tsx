import { Lightbulb, TrendingUp, Shield, PiggyBank, BarChart3, Coins } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SuggestedTopicsProps {
  onSelectTopic: (topic: string) => void;
}

const topics = [
  {
    icon: TrendingUp,
    label: "Options Trading",
    question: "Explain options trading and how calls and puts work",
  },
  {
    icon: Coins,
    label: "Dollar-Cost Averaging",
    question: "What is dollar-cost averaging and why is it effective?",
  },
  {
    icon: BarChart3,
    label: "ETFs vs Mutual Funds",
    question: "What are ETFs and how do they compare to mutual funds?",
  },
  {
    icon: Shield,
    label: "Risk Management",
    question: "How should I think about risk when investing?",
  },
  {
    icon: PiggyBank,
    label: "Retirement Planning",
    question: "What are the basics of retirement planning and 401(k) accounts?",
  },
  {
    icon: Lightbulb,
    label: "Market Analysis",
    question: "What's the difference between fundamental and technical analysis?",
  },
];

export function SuggestedTopics({ onSelectTopic }: SuggestedTopicsProps) {
  return (
    <div className="mb-6 space-y-4">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-foreground">
          What would you like to learn about?
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Select a topic or ask your own question
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {topics.map((topic) => (
          <Button
            key={topic.label}
            variant="outline"
            className="h-auto flex-col gap-2 p-4 text-left hover:bg-accent hover:border-primary/30"
            onClick={() => onSelectTopic(topic.question)}
          >
            <topic.icon className="h-5 w-5 text-primary" />
            <span className="text-sm font-medium">{topic.label}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
