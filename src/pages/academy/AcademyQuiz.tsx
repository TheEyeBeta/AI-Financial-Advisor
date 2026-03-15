import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle,
  XCircle,
  Trophy,
  RotateCcw,
  Loader2,
  Brain,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import {
  academyApi,
  injectTemplateVars,
  type Quiz,
  type QuizQuestion,
  type QuizOption,
  type QuizAttempt,
} from "@/services/academy-api";

interface QuizProps {
  quiz: Quiz;
  questions: QuizQuestion[];
  options: QuizOption[];
  lessonId: string;
  previousAttempt: QuizAttempt | null;
  onPassed: (score: number) => void;
}

interface QuestionResult {
  questionId: string;
  isCorrect: boolean;
  scoreAwarded: number;
  selectedOptionIds: string[] | null;
  freeTextAnswer: string | null;
  aiRationale: string | null;
  feedback: string | null;
}

export function AcademyQuiz({ quiz, questions, options, lessonId, previousAttempt, onPassed }: QuizProps) {
  const { user } = useAuth();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [textAnswers, setTextAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<QuestionResult[] | null>(null);
  const [attemptScore, setAttemptScore] = useState<number | null>(null);
  const [passed, setPassed] = useState<boolean | null>(null);
  const [showRetry, setShowRetry] = useState(false);

  const optionsByQuestion = new Map<string, QuizOption[]>();
  for (const opt of options) {
    if (!optionsByQuestion.has(opt.question_id)) {
      optionsByQuestion.set(opt.question_id, []);
    }
    optionsByQuestion.get(opt.question_id)!.push(opt);
  }

  const allAnswered = questions.every((q) => {
    if (q.question_type === 'short_answer') {
      return (textAnswers[q.id] || '').trim().length > 0;
    }
    return !!answers[q.id];
  });

  async function callAIGrader(question: QuizQuestion, answer: string): Promise<{ score: number; rationale: string }> {
    try {
      const template = await academyApi.getPromptTemplate('short_answer_grader');
      const pythonBackendUrl = import.meta.env.VITE_PYTHON_API_URL;
      if (!pythonBackendUrl || !template) {
        return { score: 50, rationale: "Auto-graded." };
      }

      const systemPrompt = injectTemplateVars(template.template_text, {
        question: question.prompt_md,
        answer,
      });

      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) return { score: 50, rationale: "Not authenticated." };

      const response = await fetch(`${pythonBackendUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: `Grade this answer. Return ONLY a JSON object: {"score": <0-100>, "rationale": "<brief explanation>"}. Question: ${question.prompt_md}\nAnswer: ${answer}`,
            },
          ],
          max_tokens: 300,
        }),
      });

      if (!response.ok) return { score: 50, rationale: "Grading unavailable." };

      const data = await response.json();
      const content: string = data.response || '';

      // Parse JSON from response
      const jsonMatch = content.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          score: Math.max(0, Math.min(100, Number(parsed.score) || 0)),
          rationale: String(parsed.rationale || 'Graded by AI.'),
        };
      }
      return { score: 50, rationale: content.slice(0, 200) };
    } catch {
      return { score: 50, rationale: "Grading unavailable." };
    }
  }

  async function handleSubmit() {
    if (!user?.id || !allAnswered) return;
    setSubmitting(true);

    try {
      const totalPoints = questions.reduce((sum, q) => sum + q.points, 0);
      const questionResults: QuestionResult[] = [];

      for (const question of questions) {
        if (question.question_type === 'short_answer') {
          const freeText = textAnswers[question.id] || '';
          const { score: aiScore, rationale } = await callAIGrader(question, freeText);
          const scoreAwarded = Math.round((aiScore / 100) * question.points);
          questionResults.push({
            questionId: question.id,
            isCorrect: aiScore >= 70,
            scoreAwarded,
            selectedOptionIds: null,
            freeTextAnswer: freeText,
            aiRationale: rationale,
            feedback: null,
          });
        } else {
          const selectedOptionId = answers[question.id];
          const questionOptions = optionsByQuestion.get(question.id) || [];
          const selectedOption = questionOptions.find((o) => o.id === selectedOptionId);
          const isCorrect = selectedOption?.is_correct ?? false;
          const feedback = selectedOption?.feedback_md || null;
          questionResults.push({
            questionId: question.id,
            isCorrect,
            scoreAwarded: isCorrect ? question.points : 0,
            selectedOptionIds: selectedOptionId ? [selectedOptionId] : null,
            freeTextAnswer: null,
            aiRationale: null,
            feedback,
          });
        }
      }

      const totalEarned = questionResults.reduce((sum, r) => sum + r.scoreAwarded, 0);
      const scorePercent = totalPoints > 0 ? Math.round((totalEarned / totalPoints) * 100) : 0;
      const hasPassed = scorePercent >= quiz.pass_score;

      // Create attempt
      const attempt = await academyApi.createQuizAttempt({
        quiz_id: quiz.id,
        user_id: user.id,
        score: scorePercent,
        passed: hasPassed,
        ai_feedback_md: null,
      });

      // Create answers
      await academyApi.createQuizAnswers(
        questionResults.map((r) => ({
          attempt_id: attempt.id,
          question_id: r.questionId,
          selected_option_ids: r.selectedOptionIds,
          free_text_answer: r.freeTextAnswer,
          is_correct: r.isCorrect,
          score_awarded: r.scoreAwarded,
          ai_rationale_md: r.aiRationale,
        })),
      );

      // Update progress if passed
      if (hasPassed) {
        await academyApi.updateProgressOnPass(user.id, lessonId, scorePercent);
        onPassed(scorePercent);
      }

      setResults(questionResults);
      setAttemptScore(scorePercent);
      setPassed(hasPassed);
    } catch (err) {
      console.error("Quiz submission error:", err);
      toast({ title: "Error", description: "Failed to submit quiz.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  function handleRetry() {
    setAnswers({});
    setTextAnswers({});
    setResults(null);
    setAttemptScore(null);
    setPassed(null);
    setShowRetry(false);
  }

  // Show previous attempt summary if exists and not currently taking quiz
  if (previousAttempt && !results && !showRetry) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Quiz</h2>
          <Badge
            variant="outline"
            className={cn(
              "text-xs",
              previousAttempt.passed
                ? "bg-success/10 text-success border-success/20"
                : "bg-loss/10 text-loss border-loss/20",
            )}
          >
            {previousAttempt.passed ? "Passed" : "Not Passed"}
          </Badge>
        </div>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "h-10 w-10 rounded-xl flex items-center justify-center",
                    previousAttempt.passed ? "bg-success/10" : "bg-muted/30",
                  )}
                >
                  <Trophy
                    className={cn(
                      "h-5 w-5",
                      previousAttempt.passed ? "text-success" : "text-muted-foreground/40",
                    )}
                  />
                </div>
                <div>
                  <p className="text-sm font-medium">Best Score</p>
                  <p className="text-2xl font-bold text-primary">
                    {Math.round(previousAttempt.score)}%
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setShowRetry(true)}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Retry Quiz
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show results after submission
  if (results !== null && attemptScore !== null) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Quiz Results</h2>
          {passed ? (
            <Badge variant="outline" className="bg-success/10 text-success border-success/20 gap-1">
              <CheckCircle className="h-3 w-3" />
              Passed
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-loss/10 text-loss border-loss/20 gap-1">
              <XCircle className="h-3 w-3" />
              Not Passed
            </Badge>
          )}
        </div>

        {/* Score summary */}
        <Card className="border-border/50 bg-card/50">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "h-10 w-10 rounded-xl flex items-center justify-center",
                    passed ? "bg-success/10" : "bg-muted/30",
                  )}
                >
                  <Trophy
                    className={cn(
                      "h-5 w-5",
                      passed ? "text-success" : "text-muted-foreground/40",
                    )}
                  />
                </div>
                <div>
                  <p className="text-sm font-medium">Your Score</p>
                  <p className="text-2xl font-bold text-primary">{attemptScore}%</p>
                  <p className="text-xs text-muted-foreground/60">
                    Pass mark: {quiz.pass_score}%
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={handleRetry}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Per-question feedback */}
        <div className="space-y-3">
          {questions.map((question, i) => {
            const result = results.find((r) => r.questionId === question.id);
            if (!result) return null;
            const qOptions = optionsByQuestion.get(question.id) || [];
            const correctOption = qOptions.find((o) => o.is_correct);

            return (
              <Card
                key={question.id}
                className={cn(
                  "border",
                  result.isCorrect
                    ? "border-success/20 bg-success/5"
                    : "border-loss/20 bg-loss/5",
                )}
              >
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start gap-2">
                    {result.isCorrect ? (
                      <CheckCircle className="h-4 w-4 text-success flex-shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="h-4 w-4 text-loss flex-shrink-0 mt-0.5" />
                    )}
                    <p className="text-sm font-medium">
                      Q{i + 1}: {question.prompt_md}
                    </p>
                  </div>

                  {question.question_type === 'short_answer' && result.freeTextAnswer && (
                    <div className="ml-6">
                      <p className="text-xs text-muted-foreground/70">
                        Your answer: {result.freeTextAnswer}
                      </p>
                      {result.aiRationale && (
                        <div className="flex items-start gap-1.5 mt-1.5 text-xs text-muted-foreground/70 bg-muted/30 rounded-md p-2">
                          <Brain className="h-3 w-3 flex-shrink-0 mt-0.5 text-primary/60" />
                          <span>{result.aiRationale}</span>
                        </div>
                      )}
                      <p className="text-xs mt-1 font-medium">
                        Score: {result.scoreAwarded}/{question.points} pts
                      </p>
                    </div>
                  )}

                  {question.question_type !== 'short_answer' && (
                    <div className="ml-6 space-y-1">
                      {!result.isCorrect && correctOption && (
                        <p className="text-xs text-success/80">
                          Correct answer: {correctOption.label}
                        </p>
                      )}
                      {result.feedback && (
                        <p className="text-xs text-muted-foreground/70">{result.feedback}</p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    );
  }

  // Quiz form
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{quiz.title}</h2>

      <div className="space-y-4">
        {questions.map((question, i) => {
          const qOptions = optionsByQuestion.get(question.id) || [];

          return (
            <Card key={question.id} className="border-border/50 bg-card/50">
              <CardContent className="p-5 space-y-4">
                <div className="flex items-start gap-2">
                  <span className="text-xs font-mono text-muted-foreground/50 mt-0.5 min-w-[20px]">
                    {i + 1}.
                  </span>
                  <p className="text-sm font-medium">{question.prompt_md}</p>
                </div>

                <div className="ml-6">
                  {(question.question_type === 'mc_single' ||
                    question.question_type === 'true_false') && (
                    <RadioGroup
                      value={answers[question.id] || ''}
                      onValueChange={(val) =>
                        setAnswers((prev) => ({ ...prev, [question.id]: val }))
                      }
                    >
                      {qOptions.map((opt) => (
                        <div key={opt.id} className="flex items-center space-x-2">
                          <RadioGroupItem value={opt.id} id={opt.id} />
                          <Label
                            htmlFor={opt.id}
                            className="text-sm cursor-pointer text-foreground/80"
                          >
                            {opt.label}
                          </Label>
                        </div>
                      ))}
                    </RadioGroup>
                  )}

                  {question.question_type === 'short_answer' && (
                    <Textarea
                      placeholder="Type your answer here..."
                      className="min-h-[80px] text-sm resize-none bg-background/50"
                      value={textAnswers[question.id] || ''}
                      onChange={(e) =>
                        setTextAnswers((prev) => ({ ...prev, [question.id]: e.target.value }))
                      }
                    />
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Separator />

      {!allAnswered && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
          <AlertCircle className="h-3.5 w-3.5" />
          <span>Please answer all questions before submitting.</span>
        </div>
      )}

      <Button
        className="w-full sm:w-auto gap-2"
        disabled={!allAnswered || submitting}
        onClick={handleSubmit}
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Grading...
          </>
        ) : (
          "Submit Quiz"
        )}
      </Button>
    </div>
  );
}
