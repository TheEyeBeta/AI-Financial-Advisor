import { useState } from "react";
import {
  BarChart3,
  BookOpen,
  Globe,
  Shield,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";

import { cn } from "@/lib/utils";

interface SuggestedTopicsProps {
  onSelectTopic: (topic: string) => void;
  hasMeridianData?: boolean;
  knowledgeTier?: number;
}

type Category = "portfolio" | "market" | "learning" | "planning" | "analysis";

interface Topic {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  question: string;
  category: Category;
}

const ALL_TOPICS: Topic[] = [
  // PORTFOLIO & POSITIONS
  {
    icon: BarChart3,
    label: "Monthly performance",
    question: "How is my portfolio performing this month?",
    category: "portfolio",
  },
  {
    icon: Shield,
    label: "Position risk",
    question: "Which of my positions has the most risk right now?",
    category: "portfolio",
  },
  {
    icon: Target,
    label: "Sector concentration",
    question: "Am I too concentrated in any one sector?",
    category: "portfolio",
  },
  {
    icon: TrendingUp,
    label: "Best & worst position",
    question: "What's my best and worst performing position?",
    category: "portfolio",
  },
  {
    icon: Shield,
    label: "Holdings review",
    question: "Should I be worried about any of my current holdings?",
    category: "portfolio",
  },

  // MARKET & TOP STOCKS
  {
    icon: TrendingUp,
    label: "Strongest stocks",
    question: "What are the strongest stocks in the market right now?",
    category: "market",
  },
  {
    icon: Globe,
    label: "Leading sectors",
    question: "Which sectors are leading the market today?",
    category: "market",
  },
  {
    icon: Target,
    label: "High-conviction picks",
    question: "Are there any high-conviction opportunities I should know about?",
    category: "market",
  },
  {
    icon: Globe,
    label: "Market regime",
    question: "What does the current market regime mean for my investments?",
    category: "market",
  },
  {
    icon: BarChart3,
    label: "Top-ranked stocks",
    question: "Which top-ranked stocks have improving fundamentals?",
    category: "market",
  },

  // LEARNING & EDUCATION
  {
    icon: BookOpen,
    label: "Dollar-cost averaging",
    question: "Explain dollar-cost averaging in simple terms",
    category: "learning",
  },
  {
    icon: BookOpen,
    label: "RSI explained",
    question: "What does a high RSI actually mean for a stock?",
    category: "learning",
  },
  {
    icon: BookOpen,
    label: "Stock valuation",
    question: "How do I know if a stock is overvalued?",
    category: "learning",
  },
  {
    icon: BookOpen,
    label: "Momentum vs value",
    question: "What's the difference between momentum and value investing?",
    category: "learning",
  },
  {
    icon: Shield,
    label: "Diversification",
    question: "How should I think about portfolio diversification?",
    category: "learning",
  },

  // PERSONAL FINANCIAL PLANNING
  {
    icon: Target,
    label: "Financial goals",
    question: "Am I on track with my financial goals?",
    category: "planning",
  },
  {
    icon: TrendingUp,
    label: "Monthly investing",
    question: "How much should I be investing each month?",
    category: "planning",
  },
  {
    icon: Shield,
    label: "Idle cash",
    question: "What should I do with cash sitting in my account?",
    category: "planning",
  },
  {
    icon: BarChart3,
    label: "Risk vs horizon",
    question: "How do I balance risk with my investment horizon?",
    category: "planning",
  },
  {
    icon: Target,
    label: "My financial plan",
    question: "What would a financial plan look like for someone in my situation?",
    category: "planning",
  },

  // ANALYSIS REQUESTS
  {
    icon: BarChart3,
    label: "NVDA breakdown",
    question: "Give me a full breakdown of NVDA right now",
    category: "analysis",
  },
  {
    icon: BarChart3,
    label: "Top 3 stocks",
    question: "Compare the top 3 ranked stocks for me",
    category: "analysis",
  },
  {
    icon: Shield,
    label: "Risk/reward",
    question: "What's the risk/reward on my biggest position?",
    category: "analysis",
  },
  {
    icon: Globe,
    label: "Tech sector",
    question: "Analyse the tech sector for me",
    category: "analysis",
  },
  {
    icon: Target,
    label: "Your recommendation",
    question: "What would you buy if you were in my position?",
    category: "analysis",
  },
];

// Module-level: track which questions were shown last to prevent identical
// back-to-back repeats across chat resets within the same browser session.
let _lastShownSet: Set<string> = new Set();

function getCategoryWeight(
  category: Category,
  hasMeridianData: boolean,
  knowledgeTier: number,
): number {
  switch (category) {
    case "portfolio":
      // hide portfolio entirely when no Meridian data (filtered before this call)
      return hasMeridianData ? 3 : 0;
    case "planning":
      return hasMeridianData ? 3 : 1;
    case "learning":
      return knowledgeTier === 1 ? 3 : 1;
    case "market":
      // promote market questions when there is no personal portfolio context
      return !hasMeridianData ? 3 : 2;
    case "analysis":
      return 2;
    default:
      return 1;
  }
}

type WeightedTopic = Topic & { weight: number };

function buildWeightedPool(hasMeridianData: boolean, knowledgeTier: number): WeightedTopic[] {
  return ALL_TOPICS
    .filter((t) => {
      // Hide portfolio questions entirely when the user has no Meridian data
      if (!hasMeridianData && t.category === "portfolio") return false;
      return true;
    })
    .map((t) => ({
      ...t,
      weight: getCategoryWeight(t.category, hasMeridianData, knowledgeTier),
    }));
}

function pickWeightedRandom(
  pool: WeightedTopic[],
  count: number,
  exclude: Set<string>,
): Topic[] {
  // Try to avoid previously shown questions; fall back to full pool if not enough remain
  let available = pool.filter((t) => !exclude.has(t.question));
  if (available.length < count) {
    available = pool;
  }

  const selected: Topic[] = [];
  const remaining = [...available];

  for (let i = 0; i < Math.min(count, remaining.length); i++) {
    const totalWeight = remaining.reduce((sum, t) => sum + t.weight, 0);
    if (totalWeight <= 0) break;

    let rand = Math.random() * totalWeight;
    let pickedIndex = remaining.length - 1; // fallback to last item

    for (let j = 0; j < remaining.length; j++) {
      rand -= remaining[j].weight;
      if (rand <= 0) {
        pickedIndex = j;
        break;
      }
    }

    selected.push(remaining[pickedIndex]);
    remaining.splice(pickedIndex, 1);
  }

  return selected;
}

export function SuggestedTopics({
  onSelectTopic,
  hasMeridianData = false,
  knowledgeTier = 2,
}: SuggestedTopicsProps) {
  const [topics] = useState<Topic[]>(() => {
    const pool = buildWeightedPool(hasMeridianData, knowledgeTier);
    const selected = pickWeightedRandom(pool, 4, _lastShownSet);
    // Update module-level tracker so the next mount gets different questions
    _lastShownSet = new Set(selected.map((t) => t.question));
    return selected;
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5" />
        <span>Suggested starting points</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {topics.map((topic) => (
          <button
            key={topic.question}
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
