import {
  BarChart3,
  Coins,
  Compass,
  Globe,
  Shield,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";

import type { ExperienceLevel } from "@/types/database";
import { cn } from "@/lib/utils";

interface SuggestedTopicsProps {
  onSelectTopic: (topic: string) => void;
  experienceLevel?: ExperienceLevel;
}

interface Topic {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  question: string;
}

const beginnerTopics: Topic[] = [
  {
    icon: TrendingUp,
    label: "Getting started",
    question: "I am new to investing. What should I focus on first?",
  },
  {
    icon: Coins,
    label: "Small budget",
    question: "How can I start investing with a small amount of money?",
  },
  {
    icon: Shield,
    label: "Risk basics",
    question: "How do I avoid obvious mistakes and manage risk early on?",
  },
  {
    icon: Compass,
    label: "First portfolio",
    question: "What does a simple first portfolio look like?",
  },
];

const intermediateTopics: Topic[] = [
  {
    icon: BarChart3,
    label: "Portfolio review",
    question: "Help me review my portfolio risk, concentration, and rebalancing choices.",
  },
  {
    icon: Globe,
    label: "Market recap",
    question: "Summarize the market and tell me what matters most right now.",
  },
  {
    icon: Shield,
    label: "Risk controls",
    question: "Walk me through stronger position sizing and risk controls.",
  },
  {
    icon: Target,
    label: "Tax efficiency",
    question: "How can I make my portfolio more tax-efficient?",
  },
];

const advancedTopics: Topic[] = [
  {
    icon: Target,
    label: "Thesis check",
    question: "Pressure-test the thesis behind a position I am considering.",
  },
  {
    icon: Globe,
    label: "Macro regime",
    question: "Walk through the current macro regime and how it affects positioning.",
  },
  {
    icon: BarChart3,
    label: "Stress test",
    question: "Stress-test my portfolio under a rates or growth shock.",
  },
  {
    icon: Shield,
    label: "Risk framing",
    question: "Help me think about portfolio fragility and hidden risk.",
  },
];

export function SuggestedTopics({ onSelectTopic, experienceLevel }: SuggestedTopicsProps) {
  const topics =
    experienceLevel === "advanced"
      ? advancedTopics
      : experienceLevel === "intermediate"
        ? intermediateTopics
        : beginnerTopics;

  return (
    <div>
      <div className="mb-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5" />
        <span>Suggested starting points</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {topics.map((topic) => (
          <button
            key={topic.label}
            type="button"
            onClick={() => onSelectTopic(topic.question)}
            className={cn(
              "rounded-[22px] border border-border/60 bg-card/80 p-4 text-left transition-colors",
              "hover:border-border hover:bg-card",
            )}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <topic.icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{topic.label}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {topic.question}
                </p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
