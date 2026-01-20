import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ArrowLeft, Loader2, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { toast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/error";

type MaritalStatus = "single" | "married" | "divorced" | "widowed" | "partnered";
type InvestmentGoal = "retirement" | "wealth_building" | "income" | "education" | "major_purchase" | "other";
type RiskTolerance = "low" | "mid" | "high" | "very_high";

interface OnboardingAnswers {
  age: string;
  maritalStatus: MaritalStatus | "";
  goal: InvestmentGoal | "";
  riskTolerance: RiskTolerance | "";
}

const Onboarding = () => {
  const { userProfile, userId } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [answers, setAnswers] = useState<OnboardingAnswers>({
    age: "",
    maritalStatus: "",
    goal: "",
    riskTolerance: "",
  });

  // Redirect admins away from onboarding
  if (userProfile?.userType === "Admin") {
    navigate("/admin", { replace: true });
    return null;
  }

  const totalSteps = 4;

  const handleNext = () => {
    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const calculateRiskLevel = (answers: OnboardingAnswers): RiskTolerance => {
    // If user explicitly stated their risk tolerance, use that
    if (answers.riskTolerance) {
      return answers.riskTolerance;
    }

    // Otherwise, calculate based on age, marital status, and goals
    let riskScore = 0;

    // Age factor (younger = higher risk tolerance)
    const ageNum = parseInt(answers.age, 10);
    if (ageNum < 30) riskScore += 2;
    else if (ageNum < 40) riskScore += 1;
    else if (ageNum < 50) riskScore += 0;
    else if (ageNum < 60) riskScore -= 1;
    else riskScore -= 2;

    // Marital status factor
    if (answers.maritalStatus === "single") riskScore += 1;
    else if (answers.maritalStatus === "married" || answers.maritalStatus === "partnered") riskScore -= 1;

    // Goal factor
    if (answers.goal === "wealth_building") riskScore += 2;
    else if (answers.goal === "retirement") {
      if (ageNum < 40) riskScore += 1;
      else riskScore -= 1;
    } else if (answers.goal === "income") riskScore -= 2;
    else if (answers.goal === "education" || answers.goal === "major_purchase") riskScore -= 1;

    // Convert score to risk level
    if (riskScore >= 2) return "very_high";
    if (riskScore >= 1) return "high";
    if (riskScore >= -1) return "mid";
    return "low";
  };

  const handleSubmit = async () => {
    if (!userProfile?.id || !userId) {
      toast({
        title: "Error",
        description: "User profile not found. Please try signing in again.",
        variant: "destructive",
      });
      return;
    }

    // Validate all answers
    if (!answers.age || !answers.maritalStatus || !answers.goal || !answers.riskTolerance) {
      toast({
        title: "Incomplete",
        description: "Please answer all questions before continuing.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      // Calculate risk level
      const calculatedRiskLevel = calculateRiskLevel(answers);
      
      // Update user profile with answers and calculated risk level
      const { error } = await supabase
        .from("users")
        .update({
          age: parseInt(answers.age, 10),
          marital_status: answers.maritalStatus,
          investment_goal: answers.goal,
          risk_level: calculatedRiskLevel,
          onboarding_complete: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userProfile.id);

      if (error) throw error;

      // Invalidate user profile query to refresh it
      queryClient.invalidateQueries({ queryKey: ['user-profile'] });

      toast({
        title: "Welcome!",
        description: "Your profile has been set up. Let's get started!",
      });

      // Small delay to ensure profile is refreshed, then redirect
      setTimeout(() => {
        navigate("/advisor");
      }, 500);
    } catch (error: unknown) {
      toast({
        title: "Error",
        description: getErrorMessage(error) || "Failed to save your preferences. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const canProceed = () => {
    switch (currentStep) {
      case 1:
        return answers.age !== "";
      case 2:
        return answers.maritalStatus !== "";
      case 3:
        return answers.goal !== "";
      case 4:
        return answers.riskTolerance !== "";
      default:
        return false;
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-gradient-to-br from-background to-muted/20">
      <Card className="w-full max-w-2xl">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <TrendingUp className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-3xl">Welcome to FinanceAI!</CardTitle>
          <CardDescription className="text-base">
            Let's personalize your experience. This will only take a minute.
          </CardDescription>
          {/* Progress Bar */}
          <div className="w-full bg-muted rounded-full h-2 mt-4">
            <div
              className="bg-primary h-2 rounded-full transition-all duration-300"
              style={{ width: `${(currentStep / totalSteps) * 100}%` }}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            Step {currentStep} of {totalSteps}
          </p>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Step 1: Age */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <div>
                <Label className="text-lg font-semibold">What is your age?</Label>
                <p className="text-sm text-muted-foreground mt-1">
                  This helps us understand your investment time horizon.
                </p>
              </div>
              <input
                type="number"
                min="13"
                max="150"
                value={answers.age}
                onChange={(e) => setAnswers({ ...answers, age: e.target.value })}
                placeholder="Enter your age"
                className="w-full px-4 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          )}

          {/* Step 2: Marital Status */}
          {currentStep === 2 && (
            <div className="space-y-4">
              <div>
                <Label className="text-lg font-semibold">What is your marital status?</Label>
                <p className="text-sm text-muted-foreground mt-1">
                  This helps us tailor recommendations to your situation.
                </p>
              </div>
              <RadioGroup
                value={answers.maritalStatus}
                onValueChange={(value) => setAnswers({ ...answers, maritalStatus: value as MaritalStatus })}
                className="space-y-3"
              >
                <div className="flex items-center space-x-2 p-3 rounded-lg border border-input hover:bg-accent cursor-pointer">
                  <RadioGroupItem value="single" id="single" />
                  <Label htmlFor="single" className="cursor-pointer flex-1">
                    Single
                  </Label>
                </div>
                <div className="flex items-center space-x-2 p-3 rounded-lg border border-input hover:bg-accent cursor-pointer">
                  <RadioGroupItem value="married" id="married" />
                  <Label htmlFor="married" className="cursor-pointer flex-1">
                    Married
                  </Label>
                </div>
                <div className="flex items-center space-x-2 p-3 rounded-lg border border-input hover:bg-accent cursor-pointer">
                  <RadioGroupItem value="partnered" id="partnered" />
                  <Label htmlFor="partnered" className="cursor-pointer flex-1">
                    Domestic Partnership
                  </Label>
                </div>
                <div className="flex items-center space-x-2 p-3 rounded-lg border border-input hover:bg-accent cursor-pointer">
                  <RadioGroupItem value="divorced" id="divorced" />
                  <Label htmlFor="divorced" className="cursor-pointer flex-1">
                    Divorced
                  </Label>
                </div>
                <div className="flex items-center space-x-2 p-3 rounded-lg border border-input hover:bg-accent cursor-pointer">
                  <RadioGroupItem value="widowed" id="widowed" />
                  <Label htmlFor="widowed" className="cursor-pointer flex-1">
                    Widowed
                  </Label>
                </div>
              </RadioGroup>
            </div>
          )}

          {/* Step 3: Investment Goals */}
          {currentStep === 3 && (
            <div className="space-y-4">
              <div>
                <Label className="text-lg font-semibold">What is your primary investment goal?</Label>
                <p className="text-sm text-muted-foreground mt-1">
                  Select the goal that best describes what you're investing for.
                </p>
              </div>
              <RadioGroup
                value={answers.goal}
                onValueChange={(value) => setAnswers({ ...answers, goal: value as InvestmentGoal })}
                className="space-y-3"
              >
                <div className="flex items-center space-x-2 p-3 rounded-lg border border-input hover:bg-accent cursor-pointer">
                  <RadioGroupItem value="retirement" id="retirement" />
                  <Label htmlFor="retirement" className="cursor-pointer flex-1">
                    Retirement Planning
                  </Label>
                </div>
                <div className="flex items-center space-x-2 p-3 rounded-lg border border-input hover:bg-accent cursor-pointer">
                  <RadioGroupItem value="wealth_building" id="wealth_building" />
                  <Label htmlFor="wealth_building" className="cursor-pointer flex-1">
                    Long-term Wealth Building
                  </Label>
                </div>
                <div className="flex items-center space-x-2 p-3 rounded-lg border border-input hover:bg-accent cursor-pointer">
                  <RadioGroupItem value="income" id="income" />
                  <Label htmlFor="income" className="cursor-pointer flex-1">
                    Generate Regular Income
                  </Label>
                </div>
                <div className="flex items-center space-x-2 p-3 rounded-lg border border-input hover:bg-accent cursor-pointer">
                  <RadioGroupItem value="education" id="education" />
                  <Label htmlFor="education" className="cursor-pointer flex-1">
                    Education Funding
                  </Label>
                </div>
                <div className="flex items-center space-x-2 p-3 rounded-lg border border-input hover:bg-accent cursor-pointer">
                  <RadioGroupItem value="major_purchase" id="major_purchase" />
                  <Label htmlFor="major_purchase" className="cursor-pointer flex-1">
                    Major Purchase (Home, Car, etc.)
                  </Label>
                </div>
                <div className="flex items-center space-x-2 p-3 rounded-lg border border-input hover:bg-accent cursor-pointer">
                  <RadioGroupItem value="other" id="other" />
                  <Label htmlFor="other" className="cursor-pointer flex-1">
                    Other
                  </Label>
                </div>
              </RadioGroup>
            </div>
          )}

          {/* Step 4: Risk Tolerance */}
          {currentStep === 4 && (
            <div className="space-y-4">
              <div>
                <Label className="text-lg font-semibold">What level of risk are you willing to take?</Label>
                <p className="text-sm text-muted-foreground mt-1">
                  This directly determines your risk profile. Higher risk can mean higher returns, but also higher potential losses.
                </p>
              </div>
              <RadioGroup
                value={answers.riskTolerance}
                onValueChange={(value) => setAnswers({ ...answers, riskTolerance: value as RiskTolerance })}
                className="space-y-3"
              >
                <div className="flex items-center space-x-2 p-4 rounded-lg border border-input hover:bg-accent cursor-pointer">
                  <RadioGroupItem value="low" id="low" />
                  <Label htmlFor="low" className="cursor-pointer flex-1">
                    <div>
                      <div className="font-medium">Low Risk</div>
                      <div className="text-sm text-muted-foreground">
                        Prefer stability and capital preservation. Willing to accept lower returns for lower volatility.
                      </div>
                    </div>
                  </Label>
                </div>
                <div className="flex items-center space-x-2 p-4 rounded-lg border border-input hover:bg-accent cursor-pointer">
                  <RadioGroupItem value="mid" id="mid" />
                  <Label htmlFor="mid" className="cursor-pointer flex-1">
                    <div>
                      <div className="font-medium">Moderate Risk</div>
                      <div className="text-sm text-muted-foreground">
                        Balanced approach. Willing to accept some volatility for moderate growth potential.
                      </div>
                    </div>
                  </Label>
                </div>
                <div className="flex items-center space-x-2 p-4 rounded-lg border border-input hover:bg-accent cursor-pointer">
                  <RadioGroupItem value="high" id="high" />
                  <Label htmlFor="high" className="cursor-pointer flex-1">
                    <div>
                      <div className="font-medium">High Risk</div>
                      <div className="text-sm text-muted-foreground">
                        Comfortable with significant volatility. Seeking higher returns and can tolerate larger losses.
                      </div>
                    </div>
                  </Label>
                </div>
                <div className="flex items-center space-x-2 p-4 rounded-lg border border-input hover:bg-accent cursor-pointer">
                  <RadioGroupItem value="very_high" id="very_high" />
                  <Label htmlFor="very_high" className="cursor-pointer flex-1">
                    <div>
                      <div className="font-medium">Very High Risk</div>
                      <div className="text-sm text-muted-foreground">
                        Aggressive investor. Comfortable with extreme volatility and potential for substantial losses in pursuit of maximum returns.
                      </div>
                    </div>
                  </Label>
                </div>
              </RadioGroup>
            </div>
          )}

          {/* Navigation Buttons */}
          <div className="flex justify-between pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={handleBack}
              disabled={currentStep === 1 || isSubmitting}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>

            {currentStep < totalSteps ? (
              <Button
                type="button"
                onClick={handleNext}
                disabled={!canProceed() || isSubmitting}
              >
                Next
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={!canProceed() || isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Setting up...
                  </>
                ) : (
                  <>
                    Complete Setup
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Onboarding;
