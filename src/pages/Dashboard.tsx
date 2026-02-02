import { AppLayout } from "@/components/layout/AppLayout";
import { PortfolioPerformance } from "@/components/dashboard/PortfolioPerformance";
import { TradeStatistics } from "@/components/dashboard/TradeStatistics";
import { MarketOverview } from "@/components/dashboard/MarketOverview";
import { LearningProgress } from "@/components/dashboard/LearningProgress";
import { useAuth } from "@/hooks/use-auth";

const Dashboard = () => {
  const { userProfile } = useAuth();
  const greeting = userProfile?.first_name 
    ? `Welcome back, ${userProfile.first_name}` 
    : "Welcome back";

  const currentHour = new Date().getHours();
  const timeOfDay = currentHour < 12 ? "morning" : currentHour < 18 ? "afternoon" : "evening";

  return (
    <AppLayout title="Dashboard">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="animate-in fade-in duration-300">
          <h1 className="text-2xl font-semibold text-foreground">{greeting}</h1>
          <p className="text-sm text-muted-foreground/70 mt-0.5">
            Good {timeOfDay}. Here's your portfolio at a glance.
          </p>
        </div>

        {/* Main Stats - Portfolio Performance spans full width on mobile, half on lg */}
        <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
          <div className="lg:col-span-2 animate-in fade-in slide-in-from-bottom-2 duration-300" style={{ animationDelay: '50ms' }}>
            <PortfolioPerformance />
          </div>
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300" style={{ animationDelay: '100ms' }}>
            <TradeStatistics />
          </div>
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300" style={{ animationDelay: '150ms' }}>
            <MarketOverview />
          </div>
          <div className="lg:col-span-2 animate-in fade-in slide-in-from-bottom-2 duration-300" style={{ animationDelay: '200ms' }}>
            <LearningProgress />
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Dashboard;
