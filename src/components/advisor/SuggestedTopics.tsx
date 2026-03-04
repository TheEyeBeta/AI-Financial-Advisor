import { 
  Lightbulb, TrendingUp, Shield, PiggyBank, BarChart3, Coins, 
  TrendingDown, Target, Zap, Sparkles, Globe,
  LineChart, Activity, DollarSign, PieChart, Layers
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
  gradient?: string;
}

// Beginner topics - foundational concepts
const beginnerTopics: Topic[] = [
  {
    icon: TrendingUp,
    label: "Getting Started",
    question: "I'm new to investing — what's the simplest way to get started?",
    gradient: "from-blue-500 to-cyan-500",
  },
  {
    icon: Coins,
    label: "Smart Saving",
    question: "I don't have a lot of money to start with. How can I invest consistently on a small budget?",
    gradient: "from-green-500 to-emerald-500",
  },
  {
    icon: BarChart3,
    label: "Portfolio Building",
    question: "What's a good starter portfolio for someone who's never invested before?",
    gradient: "from-purple-500 to-pink-500",
  },
  {
    icon: Shield,
    label: "Risk & Protection",
    question: "How do I avoid losing money when the market drops?",
    gradient: "from-orange-500 to-red-500",
  },
  {
    icon: PiggyBank,
    label: "Retirement Planning",
    question: "When should I start saving for retirement, and what's the best account to use?",
    gradient: "from-indigo-500 to-blue-500",
  },
  {
    icon: Lightbulb,
    label: "Market Analysis",
    question: "How do I know if a stock is worth buying?",
    gradient: "from-yellow-500 to-amber-500",
  },
];

// Intermediate topics - strategy and optimization
const intermediateTopics: Topic[] = [
  {
    icon: PieChart,
    label: "Portfolio Optimization",
    question: "How can I optimize my portfolio allocation? Discuss rebalancing strategies, tax-loss harvesting, and when to adjust my asset allocation based on market conditions.",
    gradient: "from-purple-500 to-indigo-500",
  },
  {
    icon: TrendingUp,
    label: "Sector Analysis",
    question: "How do I evaluate different market sectors? Explain sector rotation strategies, how to identify undervalued sectors, and when to overweight or underweight specific industries.",
    gradient: "from-blue-500 to-cyan-500",
  },
  {
    icon: Shield,
    label: "Advanced Risk Management",
    question: "What are advanced risk management techniques? Discuss position sizing, correlation analysis, portfolio heat maps, and how to protect against black swan events.",
    gradient: "from-red-500 to-orange-500",
  },
  {
    icon: Target,
    label: "Options Strategies",
    question: "Explain basic options strategies for income generation and hedging. Cover covered calls, protective puts, and when to use options in a portfolio.",
    gradient: "from-green-500 to-teal-500",
  },
  {
    icon: Zap,
    label: "Market Timing",
    question: "Is market timing possible? Discuss technical indicators, market sentiment, economic cycles, and whether timing the market is worth the effort.",
    gradient: "from-yellow-500 to-amber-500",
  },
  {
    icon: DollarSign,
    label: "Tax Efficiency",
    question: "How can I make my investments more tax-efficient? Explain tax-advantaged accounts, capital gains strategies, and tax-loss harvesting in detail.",
    gradient: "from-emerald-500 to-green-500",
  },
];

// Advanced topics - sophisticated strategies
const advancedTopics: Topic[] = [
  {
    icon: TrendingDown,
    label: "Derivatives & Hedging",
    question: "Explain advanced derivatives strategies for portfolio hedging. Discuss futures, swaps, and complex options strategies like iron condors and butterfly spreads.",
    gradient: "from-red-500 to-rose-500",
  },
  {
    icon: LineChart,
    label: "Quantitative Analysis",
    question: "How do I implement quantitative trading strategies? Discuss backtesting, factor models, risk parity, and algorithmic trading approaches.",
    gradient: "from-indigo-500 to-purple-500",
  },
  {
    icon: Target,
    label: "Arbitrage Strategies",
    question: "What arbitrage opportunities exist in modern markets? Explain statistical arbitrage, pairs trading, and market microstructure arbitrage.",
    gradient: "from-cyan-500 to-blue-500",
  },
  {
    icon: Activity,
    label: "Portfolio Theory",
    question: "Discuss modern portfolio theory, efficient frontier, and alternative risk metrics. How do I construct an optimal portfolio using quantitative methods?",
    gradient: "from-violet-500 to-purple-500",
  },
  {
    icon: Layers,
    label: "Market Microstructure",
    question: "Explain market microstructure and its impact on trading. Discuss order flow, liquidity provision, and how institutional trading affects prices.",
    gradient: "from-slate-500 to-gray-500",
  },
  {
    icon: Globe,
    label: "Alternative Investments",
    question: "How should I incorporate alternative investments? Discuss private equity, commodities, real estate, and other non-traditional assets in a sophisticated portfolio.",
    gradient: "from-amber-500 to-orange-500",
  },
];

export function SuggestedTopics({ onSelectTopic, experienceLevel }: SuggestedTopicsProps) {
  // Select topics based on experience level, default to beginner
  const topics = experienceLevel === 'advanced' 
    ? advancedTopics 
    : experienceLevel === 'intermediate' 
    ? intermediateTopics 
    : beginnerTopics;

  const levelLabel = experienceLevel === 'advanced' 
    ? 'Advanced' 
    : experienceLevel === 'intermediate' 
    ? 'Intermediate' 
    : 'Beginner';

  return (
    <div className="mb-6 animate-in fade-in duration-300">
      {/* Compact header */}
      <div className="text-center mb-4">
        <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs mb-2">
          <Sparkles className="h-3 w-3" />
          {levelLabel}
        </div>
        <h2 className="text-lg font-semibold text-foreground">
          Quick topics
        </h2>
      </div>
      
      {/* Compact grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {topics.map((topic, index) => (
          <button
            key={topic.label}
            className={cn(
              "group flex items-center gap-2.5 px-3 py-2.5 rounded-xl",
              "border border-border/50 bg-card/30 hover:bg-card/60",
              "hover:border-primary/30 hover:shadow-sm",
              "transition-all duration-200 text-left",
              "animate-in fade-in"
            )}
            style={{ animationDelay: `${index * 30}ms` }}
            onClick={() => onSelectTopic(topic.question)}
          >
            <div className={cn(
              "p-1.5 rounded-lg bg-gradient-to-br shrink-0",
              topic.gradient || "from-gray-500 to-gray-600",
            )}>
              <topic.icon className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="text-sm font-medium text-foreground/80 group-hover:text-foreground truncate">
              {topic.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
