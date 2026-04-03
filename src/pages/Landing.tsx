import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  LineChart,
  LogIn,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react";

import { SignInDialog } from "@/components/auth/SignInDialog";
import { SignUpDialog } from "@/components/auth/SignUpDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";

export default function Landing() {
  const { isAuthenticated, loading } = useAuth();
  const navigate = useNavigate();
  const [showSignUp, setShowSignUp] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);

  useEffect(() => {
    if (!loading && isAuthenticated) {
      const timer = setTimeout(() => {
        navigate("/advisor", { replace: true });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isAuthenticated, loading, navigate]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-background via-background to-muted/20 p-4 sm:p-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center space-y-6 text-center sm:space-y-8">
        <div className="space-y-4">
          <div className="flex items-center justify-center gap-3">
            <TrendingUp className="h-8 w-8 text-primary sm:h-12 sm:w-12" />
            <h1 className="text-3xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              AI Financial Advisor
            </h1>
          </div>
          <p className="mx-auto max-w-3xl px-4 text-base text-muted-foreground sm:text-lg lg:text-xl">
            Educational market analysis, ranked stock signals, guided learning, and paper trading in one investor workspace.
          </p>
        </div>

        <Card className="w-full max-w-3xl border-primary/20 bg-gradient-to-r from-primary/5 to-primary/10">
          <CardContent className="p-5 sm:p-6 lg:p-8">
            <div className="flex items-start gap-4 text-left">
              <ShieldCheck className="mt-1 h-7 w-7 shrink-0 text-primary sm:h-8 sm:w-8" />
              <div className="space-y-3">
                <h2 className="text-xl font-semibold sm:text-2xl">Research first. Act deliberately.</h2>
                <p className="text-sm leading-relaxed text-muted-foreground sm:text-base lg:text-lg">
                  Use the platform to understand markets, compare ranked opportunities, and practice decision-making before risking real capital.
                </p>
                <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
                  Educational analysis only. Not personalised investment advice.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row sm:items-center">
          <Button
            size="default"
            className="w-full px-5 py-2.5 text-sm sm:w-auto sm:px-6 sm:py-3 sm:text-base"
            onClick={() => setShowSignUp(true)}
          >
            Create Account
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
          <Button
            size="default"
            variant="outline"
            className="w-full px-5 py-2.5 text-sm sm:w-auto sm:px-6 sm:py-3 sm:text-base"
            onClick={() => setShowSignIn(true)}
          >
            <LogIn className="mr-2 h-4 w-4" />
            Sign In
          </Button>
        </div>

        <p className="px-4 text-xs text-muted-foreground sm:text-sm">
          Free to start. No credit card required.
        </p>

        <div className="mt-8 grid w-full max-w-4xl grid-cols-1 gap-4 px-4 sm:mt-12 sm:grid-cols-2 lg:grid-cols-3 sm:gap-6">
          <Card>
            <CardContent className="p-4 text-center sm:p-6">
              <LineChart className="mx-auto mb-3 h-8 w-8 text-primary" />
              <h3 className="mb-2 text-sm font-semibold sm:text-base">Paper Trading</h3>
              <p className="text-xs text-muted-foreground sm:text-sm">
                Practice with virtual capital before committing real money.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center sm:p-6">
              <Sparkles className="mx-auto mb-3 h-8 w-8 text-primary" />
              <h3 className="mb-2 text-sm font-semibold sm:text-base">AI Analysis</h3>
              <p className="text-xs text-muted-foreground sm:text-sm">
                Ask questions, compare scenarios, and review risk trade-offs with clear explanations.
              </p>
            </CardContent>
          </Card>
          <Card className="sm:col-span-2 lg:col-span-1">
            <CardContent className="p-4 text-center sm:p-6">
              <BookOpen className="mx-auto mb-3 h-8 w-8 text-primary" />
              <h3 className="mb-2 text-sm font-semibold sm:text-base">Structured Learning</h3>
              <p className="text-xs text-muted-foreground sm:text-sm">
                Build investing judgment through guided lessons, quizzes, and progress tracking.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <SignUpDialog open={showSignUp} onOpenChange={setShowSignUp} />
      <SignInDialog open={showSignIn} onOpenChange={setShowSignIn} />
    </div>
  );
}
