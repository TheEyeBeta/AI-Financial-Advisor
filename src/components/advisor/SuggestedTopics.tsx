import { Lightbulb, TrendingUp, Shield, PiggyBank, BarChart3, Coins } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SuggestedTopicsProps {
  onSelectTopic: (topic: string) => void;
}

const topics = [
  {
    icon: TrendingUp,
    label: "Getting Started",
    question: "I'm new to investing. What are the first steps I should take to start building wealth? Please explain the basics of stocks, bonds, and index funds.",
  },
  {
    icon: Coins,
    label: "Smart Saving",
    question: "What's the best strategy for someone who wants to invest consistently but doesn't have a lot of money to start with? Explain dollar-cost averaging and how much I should be investing monthly.",
  },
  {
    icon: BarChart3,
    label: "Portfolio Building",
    question: "How do I build a diversified investment portfolio? What's the right mix of stocks, bonds, and other assets for someone my age? Explain asset allocation strategies.",
  },
  {
    icon: Shield,
    label: "Risk & Protection",
    question: "How do I protect my investments during market downturns? Explain risk management strategies, stop-losses, and how to avoid emotional investing decisions.",
  },
  {
    icon: PiggyBank,
    label: "Retirement Planning",
    question: "Help me understand retirement accounts. What's the difference between a 401(k), IRA, and Roth IRA? How much should I be saving for retirement and what's compound interest?",
  },
  {
    icon: Lightbulb,
    label: "Market Analysis",
    question: "How do professional investors analyze stocks before buying? Explain fundamental analysis (P/E ratio, earnings) vs technical analysis (charts, trends). Which should I use?",
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
