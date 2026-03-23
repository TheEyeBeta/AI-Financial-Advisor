import { Compass, LineChart, Trophy, type LucideIcon } from "lucide-react";
import { TIER_IDS } from "@/services/academy-api";

export type JourneyMeta = {
  chapter: string;
  hook: string;
  summary: string;
  icon: LucideIcon;
  badgeClass: string;
  iconClass: string;
  panelClass: string;
  ribbonClass: string;
  buttonClass: string;
};

export const DEFAULT_JOURNEY_META: JourneyMeta = {
  chapter: "New Chapter",
  hook: "Chart your next move.",
  summary: "Every lesson adds context, confidence, and momentum to the path ahead.",
  icon: Compass,
  badgeClass: "!border-primary/20 !bg-primary/10 !text-primary",
  iconClass: "!border-primary/20 !bg-primary/10 !text-primary",
  panelClass: "border-border/60 bg-card/90",
  ribbonClass: "from-primary/70 via-primary/40 to-transparent",
  buttonClass: "!bg-primary !text-primary-foreground hover:!bg-primary/90",
};

const TIER_JOURNEY_META: Record<string, JourneyMeta> = {
  [TIER_IDS.BEGINNER]: {
    chapter: "Chapter 01",
    hook: "Lay the foundation.",
    summary: "Start with the language of markets, risk, and portfolio basics so every later lesson clicks faster.",
    icon: Compass,
    badgeClass: "!border-emerald-500/20 !bg-emerald-500/10 !text-emerald-700 dark:!text-emerald-300",
    iconClass: "!border-emerald-500/20 !bg-emerald-500/10 !text-emerald-700 dark:!text-emerald-300",
    panelClass: "border-emerald-500/20 bg-card/95",
    ribbonClass: "from-emerald-500 via-emerald-300 to-cyan-300",
    buttonClass: "!bg-emerald-600 !text-white hover:!bg-emerald-500",
  },
  [TIER_IDS.INTERMEDIATE]: {
    chapter: "Chapter 02",
    hook: "Read the market with intent.",
    summary: "Move from theory to interpretation with stronger pattern recognition, valuation, and decision-making discipline.",
    icon: LineChart,
    badgeClass: "!border-sky-500/20 !bg-sky-500/10 !text-sky-700 dark:!text-sky-300",
    iconClass: "!border-sky-500/20 !bg-sky-500/10 !text-sky-700 dark:!text-sky-300",
    panelClass: "border-sky-500/20 bg-card/95",
    ribbonClass: "from-sky-500 via-blue-400 to-indigo-300",
    buttonClass: "!bg-sky-600 !text-white hover:!bg-sky-500",
  },
  [TIER_IDS.ADVANCED]: {
    chapter: "Chapter 03",
    hook: "Turn insight into edge.",
    summary: "Bring together structure, conviction, and execution as the path shifts into more advanced strategy work.",
    icon: Trophy,
    badgeClass: "!border-amber-500/20 !bg-amber-500/10 !text-amber-700 dark:!text-amber-300",
    iconClass: "!border-amber-500/20 !bg-amber-500/10 !text-amber-700 dark:!text-amber-300",
    panelClass: "border-amber-500/20 bg-card/95",
    ribbonClass: "from-amber-500 via-orange-400 to-yellow-300",
    buttonClass: "!bg-amber-500 !text-white hover:!bg-amber-400",
  },
};

export function getJourneyMeta(tierId: string): JourneyMeta {
  return TIER_JOURNEY_META[tierId] ?? DEFAULT_JOURNEY_META;
}
