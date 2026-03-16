import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Bot, Send, Loader2, User, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import {
  academyApi,
  injectTemplateVars,
  type ChatMessage,
  type ChatSession,
  type Lesson,
  type Tier,
  type PromptTemplate,
} from "@/services/academy-api";

interface AcademyTutorProps {
  lesson: Lesson;
  tier: Tier;
  lessonContent: string;
  onClose: () => void;
}

export function AcademyTutor({ lesson, tier, lessonContent, onClose }: AcademyTutorProps) {
  const { userId } = useAuth();
  const [session, setSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingSession, setLoadingSession] = useState(true);
  const [starterPrompts, setStarterPrompts] = useState<PromptTemplate[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const latestInitReqRef = useRef(0);

  const initSession = useCallback(async () => {
    if (!userId) {
      // Reset state when user is not authenticated to avoid stale data
      // and a stuck loading indicator.
      ++latestInitReqRef.current; // invalidate any in-flight requests
      setLoadingSession(false);
      setSession(null);
      setMessages([]);
      setStarterPrompts([]);
      return;
    }
    const reqId = ++latestInitReqRef.current;
    try {
      setLoadingSession(true);
      const [sess, prompts] = await Promise.all([
        academyApi.getChatSession(userId, lesson.id),
        academyApi.getLessonPromptTemplates(lesson.id).catch(() => [] as PromptTemplate[]),
      ]);
      const msgs = await academyApi.getChatMessages(sess.id);
      if (reqId !== latestInitReqRef.current) return;
      setSession(sess);
      setMessages(msgs);
      setStarterPrompts(prompts);
    } catch (err) {
      if (reqId !== latestInitReqRef.current) return;
      console.error("Failed to init tutor session:", err);
      setSession(null);
      setMessages([]);
      setStarterPrompts([]);
    } finally {
      if (reqId === latestInitReqRef.current) {
        setLoadingSession(false);
      }
    }
  }, [userId, lesson.id]);

  useEffect(() => {
    initSession();
  }, [userId, lesson.id, initSession]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  function scrollToBottom() {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }

  async function buildSystemPrompt(): Promise<string> {
    try {
      const template = await academyApi.getPromptTemplate('lesson_explainer');
      if (template) {
        return injectTemplateVars(template.template_text, {
          lesson_title: lesson.title,
          tier_name: tier.name,
          lesson_content: lessonContent.slice(0, 3000),
        });
      }
    } catch {
      // Fall back to default
    }
    return `You are an AI tutor helping a student learn about "${lesson.title}" from the ${tier.name} tier. Use the following lesson content as context:\n\n${lessonContent.slice(0, 2000)}\n\nBe helpful, clear, and encouraging. Answer questions about the lesson content and help the student understand the concepts.`;
  }

  async function sendMessage() {
    if (!input.trim() || sending || !userId || !session) return;

    const userText = input.trim();
    // Snapshot history before any state updates so the slice window is accurate
    const historySnapshot = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-10)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content_md }));

    setInput('');
    setSending(true);

    // Optimistically show user message
    const tempUserMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      session_id: session.id,
      sender: 'user',
      role: 'user',
      content_md: userText,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    try {
      // Save user message to DB
      const savedUserMsg = await academyApi.saveChatMessage(session.id, 'user', 'user', userText);
      setMessages((prev) => prev.map((m) => (m.id === tempUserMsg.id ? savedUserMsg : m)));

      // Build conversation for AI using the pre-send snapshot + new message
      const systemPrompt = await buildSystemPrompt();

      const conversationHistory = [...historySnapshot, { role: 'user' as const, content: userText }];

      // Call AI backend
      const pythonBackendUrl = import.meta.env.VITE_PYTHON_API_URL;
      let aiResponse = "I'm sorry, the AI service is currently unavailable.";

      if (pythonBackendUrl) {
        const { data: { session: authSession } } = await supabase.auth.getSession();
        const accessToken = authSession?.access_token;

        if (accessToken) {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 20_000);
          try {
            const res = await fetch(`${pythonBackendUrl}/api/chat`, {
              method: 'POST',
              signal: controller.signal,
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
              },
              body: JSON.stringify({
                messages: [
                  { role: 'system', content: systemPrompt },
                  ...conversationHistory,
                ],
                max_tokens: 1000,
              }),
            });
            if (res.ok) {
              const data = await res.json();
              aiResponse = data.response || aiResponse;
            }
          } catch (fetchErr) {
            if (fetchErr instanceof DOMException && fetchErr.name === 'AbortError') {
              aiResponse = "The request timed out. Please try again.";
            } else {
              throw fetchErr;
            }
          } finally {
            clearTimeout(timeoutId);
          }
        }
      }

      // Save AI response to DB
      const savedAiMsg = await academyApi.saveChatMessage(
        session.id,
        'assistant',
        'assistant',
        aiResponse,
      );
      setMessages((prev) => [...prev, savedAiMsg]);
    } catch (err) {
      console.error("Failed to send message:", err);
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id));
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div className="flex flex-col h-full bg-background border-l border-border/50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-muted/20 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
            <Bot className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium">AI Tutor</p>
            <p className="text-xs text-muted-foreground/60 truncate max-w-[150px]">
              {lesson.title}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Close tutor panel" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4" ref={scrollRef}>
        {loadingSession ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/40" />
          </div>
        ) : messages.length === 0 ? (
          <div className="py-8 text-center">
            <Bot className="h-10 w-10 mx-auto mb-3 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground/60">
              Ask me anything about this lesson!
            </p>
            <p className="text-xs text-muted-foreground/40 mt-1">
              I can explain concepts, give examples, and help you understand.
            </p>
            {starterPrompts.length > 0 && (
              <div className="mt-4 space-y-1.5">
                <p className="text-xs text-muted-foreground/50 uppercase tracking-wide font-medium">
                  Try asking
                </p>
                {starterPrompts.map((pt) => (
                  <button
                    key={pt.id}
                    className="block w-full text-left text-xs px-3 py-2 rounded-lg border border-border/40 hover:border-primary/30 hover:bg-primary/5 transition-colors text-muted-foreground/70 hover:text-foreground"
                    onClick={() => {
                      setInput(injectTemplateVars(pt.template_text, {
                        lesson_title: lesson.title,
                        tier_name: tier.name,
                        lesson_content: lessonContent.slice(0, 3000),
                      }));
                      textareaRef.current?.focus();
                    }}
                  >
                    {pt.key.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex gap-2",
                msg.role === 'user' ? "flex-row-reverse" : "flex-row",
              )}
            >
              <div
                className={cn(
                  "h-6 w-6 rounded-full flex-shrink-0 flex items-center justify-center mt-0.5",
                  msg.role === 'user' ? "bg-primary/10" : "bg-muted/40",
                )}
              >
                {msg.role === 'user' ? (
                  <User className="h-3.5 w-3.5 text-primary" />
                ) : (
                  <Bot className="h-3.5 w-3.5 text-muted-foreground/60" />
                )}
              </div>
              <div
                className={cn(
                  "rounded-xl px-3 py-2 text-sm max-w-[85%]",
                  msg.role === 'user'
                    ? "bg-primary/10 text-foreground"
                    : "bg-muted/40 text-foreground",
                )}
              >
                <p className="whitespace-pre-wrap leading-relaxed">{msg.content_md}</p>
              </div>
            </div>
          ))
        )}
        {sending && (
          <div className="flex gap-2">
            <div className="h-6 w-6 rounded-full bg-muted/40 flex-shrink-0 flex items-center justify-center mt-0.5">
              <Bot className="h-3.5 w-3.5 text-muted-foreground/60" />
            </div>
            <div className="rounded-xl px-3 py-2 bg-muted/40">
              <div className="flex gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce" />
              </div>
            </div>
          </div>
        )}
      </div>

      <Separator />

      {/* Input */}
      <div className="flex-shrink-0 p-3">
        <div className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            placeholder="Ask about this lesson..."
            className="text-sm resize-none min-h-[60px] max-h-[120px] bg-background/50"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sending || loadingSession || session === null}
          />
          <Button
            size="icon"
            className="h-9 w-9 flex-shrink-0"
            aria-label="Send message"
            disabled={!input.trim() || sending || loadingSession || session === null}
            onClick={sendMessage}
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground/40 mt-1.5 text-center">
          Press Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
