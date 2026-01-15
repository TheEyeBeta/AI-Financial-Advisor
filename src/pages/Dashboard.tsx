import { AppLayout } from "@/components/layout/AppLayout";
import { PortfolioPerformance } from "@/components/dashboard/PortfolioPerformance";
import { TradeStatistics } from "@/components/dashboard/TradeStatistics";
import { MarketOverview } from "@/components/dashboard/MarketOverview";
import { LearningProgress } from "@/components/dashboard/LearningProgress";

const Dashboard = () => {
  return (
    <AppLayout title="Dashboard">
      <div className="grid gap-4 sm:gap-6 grid-cols-1 lg:grid-cols-2">
        <PortfolioPerformance />
        <TradeStatistics />
        <MarketOverview />
        <LearningProgress />
      </div>
    </AppLayout>
  );
};

export default Dashboard;
