import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Lock,
  CheckCircle,
  ChevronRight,
  Menu,
  Bot,
  ChevronDown,
  BookOpen,
  GraduationCap,
} from "lucide-react";

// ─── Responsive helper — true when viewport ≥ 1280 px (xl breakpoint) ────────

function subscribe(cb: () => void) {
  const mq = window.matchMedia('(min-width: 1280px)');
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
function getSnapshot() {
  return window.matchMedia('(min-width: 1280px)').matches;
}
function getServerSnapshot() {
  return false;
}
function useIsDesktopXl() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "@/hooks/use-toast";
import {
  academyApi,
  TIER_IDS,
  type Tier,
  type Lesson,
  type LessonBlock,
  type Quiz,
  type QuizQuestion,
  type QuizOption,
  type QuizAttempt,
  type UserLessonProgress,
} from "@/services/academy-api";
import { AcademyQuiz } from "./AcademyQuiz";
import { AcademyTutor } from "./AcademyTutor";

// ─── Simple Markdown renderer (no external deps) ─────────────────────────────

/** Escape HTML special characters before injecting markdown-generated HTML. */
function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderInlineMarkdown(text: string): string {
  // Escape first so that any HTML already in the DB content is inert, then
  // re-introduce only the specific safe HTML tags we intentionally create.
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code class="bg-muted/60 rounded px-1 py-0.5 text-sm font-mono">$1</code>')
    .replace(
      /\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-primary underline">$1</a>',
    );
}

function MarkdownParagraph({ content }: { content: string }) {
  const paragraphs = content.split(/\n\n+/);
  return (
    <div className="space-y-3">
      {paragraphs.map((para, i) => {
        if (para.startsWith('- ') || para.startsWith('* ')) {
          const items = para.split('\n').filter(Boolean);
          return (
            <ul key={i} className="list-disc list-inside space-y-1 text-sm text-foreground/85">
              {items.map((item, j) => (
                <li
                  key={j}
                  dangerouslySetInnerHTML={{
                    __html: renderInlineMarkdown(item.replace(/^[-*]\s+/, '')),
                  }}
                />
              ))}
            </ul>
          );
        }
        if (/^\d+\.\s/.test(para)) {
          const items = para.split('\n').filter(Boolean);
          return (
            <ol key={i} className="list-decimal list-inside space-y-1 text-sm text-foreground/85">
              {items.map((item, j) => (
                <li
                  key={j}
                  dangerouslySetInnerHTML={{
                    __html: renderInlineMarkdown(item.replace(/^\d+\.\s+/, '')),
                  }}
                />
              ))}
            </ol>
          );
        }
        // Apply inline markdown first (which escapes HTML), then turn remaining
        // newlines into <br/> tags so soft-breaks render correctly.
        const html = renderInlineMarkdown(para).replace(/\n/g, '<br/>');
        return (
          <p
            key={i}
            className="text-sm text-foreground/85 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      })}
    </div>
  );
}

// ─── Block renderer ───────────────────────────────────────────────────────────

function LessonBlockRenderer({ block }: { block: LessonBlock }) {
  switch (block.block_type) {
    case 'heading':
      return (
        <h2 className="text-xl font-semibold text-foreground mt-6 mb-3">{block.content_md}</h2>
      );

    case 'paragraph':
      return <MarkdownParagraph content={block.content_md} />;

    case 'code': {
      const language = (block.data?.language as string) || 'text';
      return (
        <div className="rounded-lg border border-border/50 overflow-hidden my-3">
          <div className="flex items-center justify-between px-4 py-2 bg-muted/40 border-b border-border/30">
            <span className="text-xs font-mono text-muted-foreground/60 uppercase tracking-wide">
              {language}
            </span>
          </div>
          <pre className="p-4 overflow-x-auto bg-muted/20">
            <code className="text-sm font-mono text-foreground/90 leading-relaxed">
              {block.content_md}
            </code>
          </pre>
        </div>
      );
    }

    case 'callout': {
      const variant = (block.data?.variant as string) || 'info';
      const isWarning = variant === 'warning';
      return (
        <div
          className={cn(
            "rounded-lg border px-4 py-3 my-3",
            isWarning
              ? "border-warning/30 bg-warning/5 text-warning-foreground"
              : "border-primary/30 bg-primary/5",
          )}
        >
          <p
            className={cn(
              "text-sm leading-relaxed",
              isWarning ? "text-warning" : "text-primary",
            )}
          >
            {block.content_md}
          </p>
        </div>
      );
    }

    case 'example':
      return (
        <div className="rounded-lg border border-border/60 my-3 overflow-hidden">
          <div className="px-4 py-2 bg-muted/30 border-b border-border/40">
            <span className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wide">
              Example
            </span>
          </div>
          <div className="p-4">
            <MarkdownParagraph content={block.content_md} />
          </div>
        </div>
      );

    case 'formula':
      return (
        <div className="rounded-lg border border-border/50 bg-muted/20 px-4 py-3 my-3 text-center">
          <code className="text-base font-mono text-foreground/90">{block.content_md}</code>
        </div>
      );

    case 'image': {
      const src = (block.data?.src as string) || (block.data?.url as string) || '';
      const alt = (block.data?.alt as string) || 'Lesson image';
      if (!src) return null;
      return (
        <div className="my-3">
          <img
            src={src}
            alt={alt}
            className="rounded-lg border border-border/50 max-w-full h-auto"
          />
          {block.content_md && (
            <p className="text-xs text-muted-foreground/60 mt-1.5 text-center">{block.content_md}</p>
          )}
        </div>
      );
    }

    case 'exercise':
      return (
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-4 my-3">
          <p className="text-xs font-medium text-primary/70 uppercase tracking-wide mb-2">
            Exercise
          </p>
          <MarkdownParagraph content={block.content_md} />
        </div>
      );

    default:
      return (
        <div className="text-sm text-foreground/85 my-2">
          <MarkdownParagraph content={block.content_md} />
        </div>
      );
  }
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

interface SidebarProps {
  tiers: Tier[];
  lessonsByTier: Map<string, Lesson[]>;
  currentLessonId: string;
  progress: UserLessonProgress[];
  enrolledTierIds: Set<string>;
  onNavigate: (slug: string) => void;
}

function LessonSidebar({
  tiers,
  lessonsByTier,
  currentLessonId,
  progress,
  enrolledTierIds,
  onNavigate,
}: SidebarProps) {
  const progressMap = new Map(progress.map((p) => [p.lesson_id, p]));
  const [openTiers, setOpenTiers] = useState<Set<string>>(() => {
    // Open the tier that contains the current lesson by default
    return new Set(tiers.map((t) => t.id));
  });

  function toggleTier(tierId: string) {
    setOpenTiers((prev) => {
      const next = new Set(prev);
      if (next.has(tierId)) {
        next.delete(tierId);
      } else {
        next.add(tierId);
      }
      return next;
    });
  }

  return (
    <div className="py-4 px-2 space-y-1">
      <div className="px-2 mb-3">
        <p className="text-xs text-muted-foreground/50 uppercase tracking-wider font-medium">
          Course Content
        </p>
      </div>
      {tiers.map((tier) => {
        const tierLessons = lessonsByTier.get(tier.id) || [];
        const isLocked = tier.id !== TIER_IDS.BEGINNER && !enrolledTierIds.has(tier.id);
        const isOpen = openTiers.has(tier.id);

        return (
          <Collapsible key={tier.id} open={isOpen} onOpenChange={() => toggleTier(tier.id)}>
            <CollapsibleTrigger className="flex items-center gap-2 w-full px-2 py-2 rounded-lg hover:bg-muted/30 transition-colors text-left">
              {isLocked ? (
                <Lock className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/30" />
              ) : isOpen ? (
                <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/60" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/60" />
              )}
              <span
                className={cn(
                  "text-xs font-semibold uppercase tracking-wide",
                  isLocked ? "text-muted-foreground/30" : "text-muted-foreground/70",
                )}
              >
                {tier.name}
              </span>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <div className="ml-4 border-l border-border/30 pl-2 py-1 space-y-0.5">
                {tierLessons.map((lesson) => {
                  const isCurrent = lesson.id === currentLessonId;
                  const lessonProgress = progressMap.get(lesson.id);
                  const isCompleted = lessonProgress?.status === 'completed';

                  return (
                    <button
                      key={lesson.id}
                      disabled={isLocked}
                      onClick={() => !isLocked && onNavigate(lesson.slug)}
                      className={cn(
                        "flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-md text-xs transition-colors",
                        isCurrent
                          ? "bg-primary/10 text-primary font-medium"
                          : isLocked
                          ? "text-muted-foreground/25 cursor-not-allowed"
                          : "text-muted-foreground/70 hover:text-foreground hover:bg-muted/30",
                      )}
                    >
                      <span className="flex-1 truncate">{lesson.title}</span>
                      {isCompleted && (
                        <CheckCircle className="h-3 w-3 flex-shrink-0 text-success" />
                      )}
                    </button>
                  );
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AcademyLesson() {
  const { slug } = useParams<{ slug: string }>();
  const { userId } = useAuth();
  const navigate = useNavigate();

  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [tier, setTier] = useState<Tier | null>(null);
  const [blocks, setBlocks] = useState<LessonBlock[]>([]);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [options, setOptions] = useState<QuizOption[]>([]);
  const [bestAttempt, setBestAttempt] = useState<QuizAttempt | null>(null);
  const [allTiers, setAllTiers] = useState<Tier[]>([]);
  const [allLessons, setAllLessons] = useState<Lesson[]>([]);
  const [progress, setProgress] = useState<UserLessonProgress[]>([]);
  const [enrollments, setEnrollments] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tutorOpen, setTutorOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const isDesktopXl = useIsDesktopXl();

  const latestLoadReqRef = useRef(0);

  const loadLesson = useCallback(async () => {
    if (!userId || !slug) return;
    const reqId = ++latestLoadReqRef.current;
    try {
      setLoading(true);
      setError(null);

      const foundLesson = await academyApi.getLessonBySlug(slug);
      if (reqId !== latestLoadReqRef.current) return;
      if (!foundLesson) {
        navigate("/academy");
        return;
      }

      const [tiersData, allLessonsData, progressData, enrollmentsData] = await Promise.all([
        academyApi.getTiers(),
        academyApi.getAllLessons(),
        academyApi.getUserLessonProgress(userId),
        academyApi.getTierEnrollments(userId),
      ]);

      if (reqId !== latestLoadReqRef.current) return;

      const foundTier = tiersData.find((t) => t.id === foundLesson.tier_id);

      // Check enrollment
      if (foundTier && foundTier.id !== TIER_IDS.BEGINNER) {
        const isEnrolled = enrollmentsData.some((e) => e.tier_id === foundTier.id);
        if (!isEnrolled) {
          navigate("/academy");
          return;
        }
      }

      // Load lesson content
      const [blocksData, quizData] = await Promise.all([
        academyApi.getLessonBlocks(foundLesson.id),
        academyApi.getQuizByLesson(foundLesson.id),
      ]);

      let questionsData: QuizQuestion[] = [];
      let optionsData: QuizOption[] = [];
      let bestAttemptData: QuizAttempt | null = null;

      if (quizData) {
        questionsData = await academyApi.getQuizQuestions(quizData.id);
        if (questionsData.length > 0) {
          optionsData = await academyApi.getQuizOptions(questionsData.map((q) => q.id));
        }
        bestAttemptData = await academyApi.getBestQuizAttempt(quizData.id, userId);
      }

      // Upsert progress to in_progress if not already completed
      const existingProgress = progressData.find((p) => p.lesson_id === foundLesson.id);
      if (!existingProgress || existingProgress.status !== 'completed') {
        await academyApi
          .upsertLessonProgress(userId, foundLesson.id, 'in_progress')
          .catch((err) => console.error('Failed to upsert lesson progress to in_progress:', err));
      }

      if (reqId !== latestLoadReqRef.current) return;

      // Update local progress state
      if (!existingProgress || existingProgress.status !== 'completed') {
        const updated = progressData.filter((p) => p.lesson_id !== foundLesson.id);
        updated.push({
          id: existingProgress?.id || '',
          user_id: userId,
          lesson_id: foundLesson.id,
          status: 'in_progress',
          best_quiz_score: existingProgress?.best_quiz_score ?? null,
          completed_at: null,
        });
        setProgress(updated);
      } else {
        setProgress(progressData);
      }

      setLesson(foundLesson);
      setTier(foundTier || null);
      setBlocks(blocksData);
      setQuiz(quizData);
      setQuestions(questionsData);
      setOptions(optionsData);
      setBestAttempt(bestAttemptData);
      setAllTiers(tiersData);
      setAllLessons(allLessonsData);
      setEnrollments(enrollmentsData.map((e) => e.tier_id));
    } catch (err) {
      if (reqId !== latestLoadReqRef.current) return;
      console.error("Error loading lesson:", err);
      setError("Failed to load lesson. Please try again.");
      toast({ title: "Error", description: "Failed to load lesson.", variant: "destructive" });
    } finally {
      if (reqId === latestLoadReqRef.current) {
        setLoading(false);
      }
    }
  }, [userId, slug, navigate]);

  useEffect(() => {
    if (!userId || !slug) return;
    loadLesson();
  }, [userId, slug, loadLesson]);

  function handleQuizPassed(score: number) {
    if (!lesson) return;
    setProgress((prev) => {
      const existing = prev.find((p) => p.lesson_id === lesson.id);
      const bestScore = Math.max(score, existing?.best_quiz_score ?? 0);
      const updated = prev.filter((p) => p.lesson_id !== lesson.id);
      updated.push({
        id: existing?.id || '',
        user_id: userId || '',
        lesson_id: lesson.id,
        status: 'completed',
        best_quiz_score: bestScore,
        completed_at: existing?.completed_at ?? new Date().toISOString(),
      });
      return updated;
    });
  }

  const lessonsByTier = new Map<string, Lesson[]>();
  for (const l of allLessons) {
    if (!lessonsByTier.has(l.tier_id)) {
      lessonsByTier.set(l.tier_id, []);
    }
    lessonsByTier.get(l.tier_id)!.push(l);
  }

  const lessonContent = blocks.map((b) => b.content_md).join('\n\n');

  const sidebarProps: SidebarProps = {
    tiers: allTiers,
    lessonsByTier,
    currentLessonId: lesson?.id || '',
    progress,
    enrolledTierIds: new Set([TIER_IDS.BEGINNER, ...enrollments]),
    onNavigate: (s) => {
      setMobileSidebarOpen(false);
      navigate(`/academy/lesson/${s}`);
    },
  };

  if (loading) {
    return (
      <AppLayout>
        <div
          className="flex overflow-hidden -mx-4 -my-4 sm:-mx-6 sm:-my-6"
          style={{ height: 'calc(100vh - 3.5rem)' }}
        >
          {/* Sidebar skeleton */}
          <div className="hidden lg:flex w-64 flex-col border-r border-border/50 p-4 space-y-2 bg-muted/10">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div key={i} className="h-6 bg-muted/30 rounded animate-pulse" />
            ))}
          </div>
          {/* Content skeleton */}
          <div className="flex-1 overflow-y-auto p-8 space-y-4 max-w-3xl mx-auto w-full">
            <div className="h-8 w-64 bg-muted/50 rounded animate-pulse" />
            <div className="h-4 w-48 bg-muted/30 rounded animate-pulse" />
            <div className="h-px bg-muted/20 my-4" />
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-muted/20 rounded animate-pulse" />
            ))}
          </div>
        </div>
      </AppLayout>
    );
  }

  if (error || !lesson || !tier) {
    return (
      <AppLayout title="Academy">
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <BookOpen className="h-12 w-12 mb-4 text-muted-foreground/20" />
          <p className="text-sm text-muted-foreground">{error || "Lesson not found."}</p>
          <Button className="mt-4" onClick={() => navigate("/academy")}>
            Back to Academy
          </Button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div
        className="flex overflow-hidden -mx-4 -my-4 sm:-mx-6 sm:-my-6"
        style={{ height: 'calc(100vh - 3.5rem)' }}
      >
        {/* ─── Desktop Left Sidebar ─── */}
        <aside className="hidden lg:flex w-64 xl:w-72 flex-col border-r border-border/50 overflow-y-auto bg-muted/10 flex-shrink-0">
          <div className="p-3 border-b border-border/40 flex-shrink-0">
            <button
              className="flex items-center gap-2 text-sm font-medium text-foreground/80 hover:text-foreground transition-colors"
              onClick={() => navigate("/academy")}
            >
              <GraduationCap className="h-4 w-4 text-primary" />
              Academy
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <LessonSidebar {...sidebarProps} />
          </div>
        </aside>

        {/* ─── Main Content ─── */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 sm:px-8 py-8 space-y-8">
            {/* Mobile top bar */}
            <div className="flex items-center gap-3 lg:hidden">
              <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
                <SheetTrigger asChild>
                  <Button variant="outline" size="icon" className="h-8 w-8 flex-shrink-0" aria-label="Open lesson menu">
                    <Menu className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-72 p-0 overflow-y-auto">
                  <div className="p-3 border-b border-border/40">
                    <button
                      className="flex items-center gap-2 text-sm font-medium text-foreground/80"
                      onClick={() => {
                        setMobileSidebarOpen(false);
                        navigate("/academy");
                      }}
                    >
                      <GraduationCap className="h-4 w-4 text-primary" />
                      Academy
                    </button>
                  </div>
                  <LessonSidebar {...sidebarProps} />
                </SheetContent>
              </Sheet>
              <span className="text-sm text-muted-foreground/60 truncate">{lesson.title}</span>
            </div>

            {/* Lesson header */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline" className="text-xs text-muted-foreground/60 border-border/50">
                  {tier.name}
                </Badge>
                {progress.find((p) => p.lesson_id === lesson.id)?.status === 'completed' && (
                  <Badge
                    variant="outline"
                    className="text-xs bg-success/10 text-success border-success/20 gap-1"
                  >
                    <CheckCircle className="h-3 w-3" />
                    Completed
                  </Badge>
                )}
              </div>
              <h1 className="text-2xl sm:text-3xl font-semibold text-foreground">{lesson.title}</h1>
              {lesson.short_summary && (
                <p className="text-sm text-muted-foreground/70 mt-2">{lesson.short_summary}</p>
              )}
              <div className="flex items-center gap-3 mt-3">
                <span className="text-xs text-muted-foreground/50">
                  ~{lesson.estimated_minutes} min read
                </span>
              </div>
            </div>

            <Separator />

            {/* Lesson blocks */}
            <div className="space-y-2">
              {blocks.length === 0 ? (
                <div className="rounded-lg border border-border/30 bg-muted/10 p-8 text-center">
                  <BookOpen className="h-10 w-10 mx-auto mb-3 text-muted-foreground/20" />
                  <p className="text-sm text-muted-foreground/60">Content coming soon.</p>
                  <p className="text-xs text-muted-foreground/40 mt-1">
                    Check back later for the full lesson.
                  </p>
                </div>
              ) : (
                blocks.map((block) => <LessonBlockRenderer key={block.id} block={block} />)
              )}
            </div>

            {/* Quiz */}
            {quiz && questions.length > 0 && (
              <>
                <Separator />
                <AcademyQuiz
                  quiz={quiz}
                  questions={questions}
                  options={options}
                  lessonId={lesson.id}
                  previousAttempt={bestAttempt}
                  onPassed={handleQuizPassed}
                />
              </>
            )}

            {/* Bottom padding */}
            <div className="h-16" />
          </div>
        </main>

        {/* ─── AI Tutor Panel (desktop only — gated by isDesktopXl to avoid duplicate mount) ─── */}
        {tutorOpen && isDesktopXl && (
          <aside className="xl:flex w-80 2xl:w-96 flex-col flex-shrink-0">
            <AcademyTutor
              lesson={lesson}
              tier={tier}
              lessonContent={lessonContent}
              onClose={() => setTutorOpen(false)}
            />
          </aside>
        )}
      </div>

      {/* ─── AI Tutor FAB / Mobile Sheet ─── */}
      {!tutorOpen && (
        <Button
          className="fixed bottom-6 right-6 rounded-full shadow-lg gap-2 z-20"
          aria-label="Ask AI Tutor"
          onClick={() => setTutorOpen(true)}
        >
          <Bot className="h-4 w-4" />
          <span className="hidden sm:inline" aria-hidden="true">Ask AI Tutor</span>
        </Button>
      )}

      {/* Mobile Tutor Sheet — only mounted below xl breakpoint to prevent overlay on desktop */}
      {!isDesktopXl && (
        <Sheet open={tutorOpen} onOpenChange={setTutorOpen}>
          <SheetContent side="right" className="w-full sm:w-96 p-0 flex flex-col">
            <AcademyTutor
              lesson={lesson}
              tier={tier}
              lessonContent={lessonContent}
              onClose={() => setTutorOpen(false)}
            />
          </SheetContent>
        </Sheet>
      )}
    </AppLayout>
  );
}
