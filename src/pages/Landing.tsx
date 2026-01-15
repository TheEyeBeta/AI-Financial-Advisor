import { useState } from "react";
import { TrendingUp, ArrowRight, Sparkles, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SignUpDialog } from "@/components/auth/SignUpDialog";
import { SignInDialog } from "@/components/auth/SignInDialog";
import { useAuth } from "@/hooks/use-auth";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function Landing() {
  const { isAuthenticated, loading } = useAuth();
  const navigate = useNavigate();
  const [showSignUp, setShowSignUp] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);

  // Redirect to AI Advisor if already authenticated
  // Use a small delay to prevent flickering during initial load
  useEffect(() => {
    if (!loading && isAuthenticated) {
      // Small timeout to ensure smooth transition
      const timer = setTimeout(() => {
        navigate("/advisor", { replace: true });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isAuthenticated, loading, navigate]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-background via-background to-muted/20 p-4 sm:p-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col items-center text-center space-y-6 sm:space-y-8">
        {/* Main Heading */}
        <div className="space-y-3 sm:space-y-4">
          <div className="flex items-center justify-center gap-2 sm:gap-3">
            <TrendingUp className="h-8 w-8 sm:h-12 sm:w-12 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              AI Financial Advisor
            </h1>
          </div>
          <p className="text-base sm:text-lg lg:text-xl text-muted-foreground max-w-2xl mx-auto px-4">
            Your personal guide to mastering investing, trading, and financial success.
            Start your journey to financial freedom today.
          </p>
        </div>

        {/* Motivational Message Card */}
        <Card className="w-full max-w-2xl border-primary/20 bg-gradient-to-r from-primary/5 to-primary/10">
          <CardContent className="p-4 sm:p-6 lg:p-8">
            <div className="flex items-start gap-3 sm:gap-4">
              <Sparkles className="h-6 w-6 sm:h-8 sm:w-8 text-primary shrink-0 mt-1" />
              <div className="text-left space-y-2 sm:space-y-3">
                <h2 className="text-xl sm:text-2xl font-semibold">
                  Transform Your Financial Future
                </h2>
                <p className="text-muted-foreground text-sm sm:text-base lg:text-lg leading-relaxed">
                  Every successful investor started with a single step. Whether you're just beginning 
                  or looking to refine your strategy, our AI-powered platform is designed to help you 
                  learn, practice, and excel in the world of finance. Take control of your financial 
                  destiny and start building the wealth you deserve.
                </p>
                <p className="text-muted-foreground text-sm sm:text-base lg:text-lg leading-relaxed font-medium">
                  Your journey to financial mastery begins now.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-center w-full sm:w-auto">
          <Button
            size="default"
            className="text-sm sm:text-base px-5 py-2.5 sm:px-6 sm:py-3 w-full sm:w-auto"
            onClick={() => setShowSignUp(true)}
          >
            Get Started
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
          <Button
            size="default"
            variant="outline"
            className="text-sm sm:text-base px-5 py-2.5 sm:px-6 sm:py-3 w-full sm:w-auto"
            onClick={() => setShowSignIn(true)}
          >
            <LogIn className="mr-2 h-4 w-4" />
            Sign In
          </Button>
        </div>
        <p className="text-xs sm:text-sm text-muted-foreground px-4">
          Free to start • No credit card required
        </p>

        {/* Features Preview */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 mt-8 sm:mt-12 w-full max-w-3xl px-4">
          <Card>
            <CardContent className="p-4 sm:p-6 text-center">
              <div className="text-2xl sm:text-3xl mb-2 sm:mb-3">📊</div>
              <h3 className="font-semibold mb-2 text-sm sm:text-base">Paper Trading</h3>
              <p className="text-xs sm:text-sm text-muted-foreground">
                Practice with virtual money and learn risk-free
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 sm:p-6 text-center">
              <div className="text-2xl sm:text-3xl mb-2 sm:mb-3">🤖</div>
              <h3 className="font-semibold mb-2 text-sm sm:text-base">AI Advisor</h3>
              <p className="text-xs sm:text-sm text-muted-foreground">
                Get personalized financial guidance 24/7
              </p>
            </CardContent>
          </Card>
          <Card className="sm:col-span-2 lg:col-span-1">
            <CardContent className="p-4 sm:p-6 text-center">
              <div className="text-2xl sm:text-3xl mb-2 sm:mb-3">📈</div>
              <h3 className="font-semibold mb-2 text-sm sm:text-base">Track Progress</h3>
              <p className="text-xs sm:text-sm text-muted-foreground">
                Monitor your portfolio and learn from your trades
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Sign Up Dialog */}
      <SignUpDialog open={showSignUp} onOpenChange={setShowSignUp} />
      
      {/* Sign In Dialog */}
      <SignInDialog open={showSignIn} onOpenChange={setShowSignIn} />
    </div>
  );
}
