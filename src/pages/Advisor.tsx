import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { formatDistanceToNow, isToday, isYesterday, parseISO } from "date-fns";
import { Clock3, History, Info, Plus, X } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { ChatInterface } from "@/components/advisor/ChatInterface";
import { SuggestedTopics } from "@/components/advisor/SuggestedTopics";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "@/hooks/use-toast";
import { useChat, useChats, useCreateChat, useSendChatMessage, useIntelligenceDigests, useOpenPositions } from "@/hooks/use-data";
import { stockSnapshotsApi } from "@/services/stock-snapshots-api";
import type { IntelligenceDigest } from "@/types/database";
import { AppLayout } from "@/components/layout/AppLayout";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getErrorMessage } from "@/lib/error";
import { AnalyticsEvents } from "@/services/analytics";

const QUICK_PROMPTS = {
  beginner: [
    "Build me a simple starter portfolio.",
    "Explain the market in plain English.",
    "Show me how to start investing safely.",
  ],
  intermediate: [
    "Review my portfolio risk.",
    "Summarize what matters in the market right now.",
    "Help me think through rebalancing.",
  ],
  advanced: [
    "Pressure-test my thesis on a position.",
    "Walk through current market regime signals.",
    "Stress-test my portfolio under a macro shock.",
  ],
  default: [
    "Summarize the market setup.",
    "Help me think through a decision.",
    "Explain a finance topic clearly.",
  ],
} as const;

type ExperienceLevel = "beginner" | "intermediate" | "advanced" | null | undefined;

const Advisor = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const chatFromUrl = searchParams.get("chat");
  const isExplicitNewChat = searchParams.get("new") === "1";

  const { userId, isAuthenticated, userProfile } = useAuth();
  const { data: chats = [], isLoading: chatsLoading, error: chatsError } = useChats();
  const createChatMutation = useCreateChat();
  const sendMessageMutation = useSendChatMessage();
  const { digests, markAsRead } = useIntelligenceDigests();
  const { data: openPositions = [] } = useOpenPositions();

  const [currentChatId, setCurrentChatId] = useState<string | null>(chatFromUrl);
  const { data: currentChat, isLoading: chatLoading, error: chatError } = useChat(currentChatId);

  const [showTopics, setShowTopics] = useState(true);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [streamingResponseContent, setStreamingResponseContent] = useState<string | null>(null);
  const [hasReceivedFirstChunk, setHasReceivedFirstChunk] = useState(false);
  const [composerValue, setComposerValue] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const isNewChatRef = useRef(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) return;

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [composerValue]);

  useEffect(() => {
    const handleInitialMessage = async () => {
      const state = location.state as { initialMessage?: string } | null;
      if (state?.initialMessage && isAuthenticated && userId) {
        await handleSendMessage(state.initialMessage);
        window.history.replaceState({ ...window.history.state, state: null }, "");
      }
    };

    if (isAuthenticated && userId) {
      handleInitialMessage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, isAuthenticated, userId]);

  useEffect(() => {
    if (chatFromUrl && chatFromUrl !== currentChatId) {
      isNewChatRef.current = false;
      setCurrentChatId(chatFromUrl);
      setShowTopics(false);
      setSearchParams({});
      return;
    }

    if (isExplicitNewChat) {
      resetWorkspace(true);
      setSearchParams({});
    }
  }, [chatFromUrl, currentChatId, isExplicitNewChat, setSearchParams]);

  useEffect(() => {
    if (pendingMessage || sendMessageMutation.isPending || streamingResponseContent !== null) {
      return;
    }
    if (currentChat && currentChat.messageCount === 0) {
      setShowTopics(true);
    } else if (currentChat && currentChat.messageCount > 0) {
      setShowTopics(false);
    }
  }, [currentChat, pendingMessage, sendMessageMutation.isPending, streamingResponseContent]);

  // Pre-warm the stock cache on page load so the first chat response is faster
  useEffect(() => {
    if (!isAuthenticated) return;
    stockSnapshotsApi.initializeCache().catch(() => {
      // Cache warm-up is best-effort; errors are non-fatal
    });
  }, [isAuthenticated]);

  const handleSendMessage = async (content: string): Promise<boolean> => {
    const trimmedContent = content.trim();
    let chatId = currentChatId;
    let isFirstMessage = false;
    let streamedResponse = "";
    let receivedChunk = false;

    if (!trimmedContent) return false;
    if (!isAuthenticated || !userId) {
      console.error("User not authenticated");
      const message = "Sign in again before sending a message.";
      setSendError(message);
      toast({
        title: "Unable to send message",
        description: message,
        variant: "destructive",
      });
      return false;
    }

    setSendError(null);
    setPendingMessage(trimmedContent);
    setShowTopics(false);
    setStreamingResponseContent("");
    setHasReceivedFirstChunk(false);

    try {
      if (!chatId) {
        const newChat = await createChatMutation.mutateAsync("New Chat");
        chatId = newChat.id;
        isNewChatRef.current = false;
        setCurrentChatId(chatId);
        isFirstMessage = true;
      } else if (currentChat?.messageCount === 0) {
        isFirstMessage = true;
      }

      AnalyticsEvents.chatSent(chatId, {
        is_first_message: isFirstMessage,
        message_length: trimmedContent.length,
      });

      const result = await sendMessageMutation.mutateAsync({
        chatId,
        message: trimmedContent,
        isFirstMessage,
        onChunk: (chunk) => {
          receivedChunk = true;
          streamedResponse += chunk;
          setHasReceivedFirstChunk(true);
          setStreamingResponseContent((previous) => (previous ?? "") + chunk);
        },
      });

      if (result?.response) {
        AnalyticsEvents.chatResponseReceived(chatId, {
          is_first_message: isFirstMessage,
          response_length: result.response.length,
        });
        setStreamingResponseContent(result.response);
        setHasReceivedFirstChunk(result.response.length > 0);
      }

      setPendingMessage(null);
      return true;
    } catch (error) {
      console.error("Error sending message:", error);
      const message = getErrorMessage(error) || "Your message could not be sent. Please try again.";
      AnalyticsEvents.chatResponseFailed({
        chat_id: chatId,
        is_first_message: isFirstMessage,
        message_length: trimmedContent.length,
        error: message,
      });
      setSendError(message);
      toast({
        title: "Unable to send message",
        description: message,
        variant: "destructive",
      });
      setPendingMessage(null);
      if (receivedChunk && streamedResponse.length > 0) {
        setStreamingResponseContent(streamedResponse);
        setHasReceivedFirstChunk(true);
      } else {
        setStreamingResponseContent(null);
        setHasReceivedFirstChunk(false);
      }
      return false;
    }
  };

  const handleComposerSubmit = async () => {
    const currentValue = composerValue;
    setComposerValue("");
    const didSend = await handleSendMessage(currentValue);
    if (!didSend) {
      setComposerValue(currentValue);
    }
  };

  const handleTopicSelect = async (topic: string) => {
    setComposerValue(topic);
    await handleSendMessage(topic);
    setComposerValue("");
  };

  const resetWorkspace = (explicitNewChat = false) => {
    isNewChatRef.current = explicitNewChat;
    setCurrentChatId(null);
    setShowTopics(true);
    setPendingMessage(null);
    setStreamingResponseContent(null);
    setHasReceivedFirstChunk(false);
    setComposerValue("");
    setSendError(null);
  };

  const handleNewChat = () => {
    resetWorkspace(true);
  };

  const handleOpenLatest = () => {
    if (!chats[0]) return;
    isNewChatRef.current = false;
    setCurrentChatId(chats[0].id);
    setShowTopics(false);
    setPendingMessage(null);
    setStreamingResponseContent(null);
    setHasReceivedFirstChunk(false);
  };

  const messages = currentChat?.messages || [];
  const chatMessages: Array<{ role: "user" | "assistant"; content: string; isStreaming?: boolean }> = messages.map((msg) => ({
    role: msg.role as "user" | "assistant",
    content: msg.content,
  }));

  let displayMessages = chatMessages;
  if (pendingMessage) {
    const isMessageSaved = chatMessages.some((msg) => msg.role === "user" && msg.content === pendingMessage);

    if (!isMessageSaved) {
      displayMessages = [
        ...chatMessages,
        {
          role: "user" as const,
          content: pendingMessage,
        },
      ];
    }
  }

  const hasPersistedStreamingMessage = streamingResponseContent !== null
    && chatMessages.some((msg) => msg.role === "assistant" && msg.content === streamingResponseContent);

  if (streamingResponseContent !== null && hasReceivedFirstChunk && !hasPersistedStreamingMessage) {
    displayMessages = [
      ...displayMessages,
      {
        role: "assistant" as const,
        content: streamingResponseContent,
        isStreaming: sendMessageMutation.isPending,
      },
    ];
  }

  useEffect(() => {
    if (pendingMessage && chatMessages.some((msg) => msg.role === "user" && msg.content === pendingMessage)) {
      setPendingMessage(null);
    }
  }, [pendingMessage, chatMessages]);

  useEffect(() => {
    if (streamingResponseContent !== null && hasPersistedStreamingMessage) {
      setStreamingResponseContent(null);
      setHasReceivedFirstChunk(false);
    }
  }, [hasPersistedStreamingMessage, streamingResponseContent]);

  if (displayMessages.length === 0) {
    displayMessages = [
      {
        role: "assistant" as const,
        content: getWelcomeMessage(userProfile?.first_name, userProfile?.experience_level),
      },
    ];
  }

  const isLoading = chatsLoading || chatLoading || sendMessageMutation.isPending || createChatMutation.isPending;
  const isThinking = sendMessageMutation.isPending && !hasReceivedFirstChunk;
  const isStarterState = showTopics && displayMessages.length <= 1;
  const experienceLevel = userProfile?.experience_level as ExperienceLevel;
  const quickPrompts = getQuickPrompts(experienceLevel);
  // Derive knowledgeTier for question weighting (1=beginner, 2=intermediate, 3=advanced)
  const knowledgeTier = experienceLevel === "advanced" ? 3 : experienceLevel === "intermediate" ? 2 : 1;
  // User has Meridian context if they have at least one open trading position
  const hasMeridianData = openPositions.length > 0;
  const experienceLevelLabel = getExperienceLevelLabel(experienceLevel);
  const latestChat = chats[0];
  const chatHeaderTitle = currentChat?.title || "Conversation";
  const chatHeaderDescription = currentChat?.updated_at
    ? `Updated ${formatActivityTime(currentChat.updated_at)}`
    : "Ask follow-ups and keep the thread going.";
  const fetchError = chatsError ?? chatError;

  return (
    <AppLayout title="Advisor">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col overflow-hidden">
        {isStarterState ? (
          <div className="flex flex-1 items-center overflow-y-auto px-4 py-8 sm:px-6">
            <div className="mx-auto w-full max-w-3xl">
              {fetchError && (
                <div className="mb-4 rounded-2xl border border-border/60 bg-card/70 px-4 py-3 text-sm text-muted-foreground">
                  Conversation history is temporarily unavailable. You can still start a new chat.
                </div>
              )}
              {sendError && (
                <div className="mb-4 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  {sendError}
                </div>
              )}
              <div className="text-center">
                <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
                  {getStarterHeading(userProfile?.first_name)}
                </h1>
                <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                  Ask about markets, portfolio decisions, or financial planning. IRIS provides educational analysis and uses your profile and The Eye context when they are available.
                </p>
                <div className="mt-4 flex justify-center">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="inline-flex cursor-default items-center gap-2 rounded-full border border-border/60 bg-card/70 px-3 py-1.5 text-xs text-muted-foreground">
                          <span className="h-1.5 w-1.5 rounded-full bg-primary/70" />
                          <span>Level: <span className="font-medium text-foreground">{experienceLevelLabel}</span> (profile setting)</span>
                          <Info className="h-3 w-3 text-muted-foreground/50" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[220px] text-center text-xs">
                        This reflects the experience level set in your profile, not your Academy progress.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              </div>

              <AdvisorDisclosure className="mt-8" />

              <div className="mt-6">
                <DigestStrip
                  digest={digests[0] ?? null}
                  onDismiss={(id) => void markAsRead(id)}
                  onExpand={(headline) => {
                    setComposerValue(`Tell me more about: ${headline}`);
                    composerRef.current?.focus();
                  }}
                />
                <AdvisorComposer
                  textareaRef={composerRef}
                  value={composerValue}
                  onChange={setComposerValue}
                  onSubmit={() => void handleComposerSubmit()}
                  disabled={isLoading}
                  placeholder="Ask anything..."
                  helperText="Enter to send. Shift+Enter for a new line."
                  ariaLabel="Ask IRIS a finance question"
                />
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                {latestChat && (
                  <Button
                    variant="ghost"
                    onClick={handleOpenLatest}
                    className="rounded-full px-4 text-muted-foreground"
                  >
                    <Clock3 className="h-4 w-4" />
                    Continue latest
                  </Button>
                )}
                <Button
                  variant="ghost"
                  onClick={() => navigate("/chat-history")}
                  className="rounded-full px-4 text-muted-foreground"
                >
                  <History className="h-4 w-4" />
                  History
                </Button>
              </div>

              <div className="mt-8 flex flex-wrap justify-center gap-2">
                {quickPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => setComposerValue(prompt)}
                    className="rounded-full border border-border/60 bg-card px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-border hover:text-foreground"
                  >
                    {prompt}
                  </button>
                ))}
              </div>

              <div className="mt-8">
                <SuggestedTopics
                  onSelectTopic={handleTopicSelect}
                  hasMeridianData={hasMeridianData}
                  knowledgeTier={knowledgeTier}
                />
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4 px-4 pb-4 pt-4 sm:px-6">
              <div className="min-w-0">
                <h1 className="truncate text-lg font-medium text-foreground">
                  {chatHeaderTitle}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {chatHeaderDescription}
                </p>
              </div>

              <div className="flex shrink-0 gap-2">
                <Button
                  variant="ghost"
                  onClick={() => navigate("/chat-history")}
                  className="rounded-full px-3 text-muted-foreground"
                >
                  <History className="h-4 w-4" />
                  History
                </Button>
                <Button onClick={handleNewChat} className="rounded-full px-4">
                  <Plus className="h-4 w-4" />
                  New
                </Button>
              </div>
            </div>

            {(fetchError || sendError) && (
              <div className="px-4 pb-3 sm:px-6">
                <div className="rounded-2xl border border-border/60 bg-card/70 px-4 py-3 text-sm text-muted-foreground">
                  {sendError || "Conversation history is temporarily unavailable. You can still start a new chat."}
                </div>
              </div>
            )}

            <div className="px-4 pb-3 sm:px-6">
              <AdvisorDisclosure />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-6">
              <ChatInterface
                messages={displayMessages}
                isThinking={isThinking}
              />
            </div>

              <div className="border-t border-border/60 px-4 py-4 sm:px-6">
                <div className="mx-auto max-w-3xl">
                  <DigestStrip
                    digest={digests[0] ?? null}
                    onDismiss={(id) => void markAsRead(id)}
                    onExpand={(headline) => {
                      setComposerValue(`Tell me more about: ${headline}`);
                      composerRef.current?.focus();
                    }}
                  />
                  <AdvisorComposer
                    textareaRef={composerRef}
                    value={composerValue}
                    onChange={setComposerValue}
                    onSubmit={() => void handleComposerSubmit()}
                  disabled={isLoading}
                  placeholder="Ask a follow-up..."
                  helperText="Enter to send. Shift+Enter for a new line."
                  ariaLabel="Ask IRIS a follow-up finance question"
                />
              </div>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
};

interface AdvisorComposerProps {
  textareaRef: RefObject<HTMLTextAreaElement>;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  placeholder: string;
  helperText: string;
  ariaLabel: string;
}

const AdvisorComposer = ({
  textareaRef,
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder,
  helperText,
  ariaLabel,
}: AdvisorComposerProps) => {
  return (
    <div className="rounded-[30px] border border-border/60 bg-card/95 px-5 py-4 shadow-[0_20px_50px_-44px_rgba(15,23,42,0.5)]">
      <Textarea
        ref={textareaRef}
        aria-label={ariaLabel}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSubmit();
          }
        }}
        placeholder={placeholder}
        className="min-h-[80px] max-h-[200px] resize-none border-0 bg-transparent px-0 py-0 text-base leading-7 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
      />

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/50 pt-3">
        <span className="text-xs text-muted-foreground">
          {helperText}
        </span>
        <Button
          onClick={onSubmit}
          disabled={disabled || value.trim().length === 0}
          className="rounded-full px-5"
        >
          Send
        </Button>
      </div>
    </div>
  );
};

/**
 * Subtle notification strip that surfaces one unread intelligence digest.
 * Renders nothing when digest is null — no empty DOM container.
 *
 * - Clicking the strip body pre-populates the chat input (no auto-send).
 * - Clicking X dismisses the digest and surfaces the next one immediately
 *   via the optimistic cache update in useIntelligenceDigests.
 */
function DigestStrip({
  digest,
  onDismiss,
  onExpand,
}: {
  digest: IntelligenceDigest | null;
  onDismiss: (id: string) => void;
  onExpand: (headline: string) => void;
}) {
  if (!digest) return null;

  const headline = digest.headline ?? "New intelligence update";

  return (
    <div className="mb-3 flex items-center gap-3 rounded-2xl border border-border/60 bg-card/70 px-4 py-2.5 text-sm transition-colors hover:border-border/80 hover:bg-card">
      <button
        type="button"
        onClick={() => onExpand(headline)}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        aria-label="Ask IRIS about this update"
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
        <span className="truncate text-foreground/80">{headline}</span>
      </button>
      <button
        type="button"
        onClick={() => onDismiss(digest.id)}
        className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function AdvisorDisclosure({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded-2xl border border-border/60 bg-card/70 px-4 py-3 text-left text-xs leading-5 text-muted-foreground ${className}`.trim()}>
      Educational analysis only. IRIS can explain frameworks, scenarios, and risk trade-offs, but it does not know your full financial picture and should not be treated as personalised investment advice.
    </div>
  );
}

function getQuickPrompts(experienceLevel: ExperienceLevel) {
  if (experienceLevel === "beginner") return QUICK_PROMPTS.beginner;
  if (experienceLevel === "intermediate") return QUICK_PROMPTS.intermediate;
  if (experienceLevel === "advanced") return QUICK_PROMPTS.advanced;
  return QUICK_PROMPTS.default;
}

function getExperienceLevelLabel(experienceLevel: ExperienceLevel) {
  if (experienceLevel === "beginner") return "Beginner";
  if (experienceLevel === "intermediate") return "Intermediate";
  if (experienceLevel === "advanced") return "Advanced";
  return "General";
}

function getStarterHeading(firstName?: string | null) {
  const hour = new Date().getHours();
  const period = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  return firstName ? `Good ${period}, ${firstName}` : "What do you want to figure out?";
}

function formatActivityTime(dateStr: string) {
  const date = parseISO(dateStr);
  if (isToday(date)) return "today";
  if (isYesterday(date)) return "yesterday";
  return formatDistanceToNow(date, { addSuffix: true });
}

function getWelcomeMessage(
  firstName?: string | null,
  experienceLevel?: "beginner" | "intermediate" | "advanced" | null,
): string {
  const greeting = firstName ? `Hello ${firstName}.` : "Hello.";

  switch (experienceLevel) {
    case "beginner":
      return `${greeting} I can help you understand investing basics, build a first portfolio, and make market news easier to follow.`;
    case "intermediate":
      return `${greeting} I can help you think through allocation, risk, rebalancing, and what matters most in the current market.`;
    case "advanced":
      return `${greeting} I can help with higher-signal market analysis, thesis checks, and portfolio stress-testing.`;
    default:
      return `${greeting} Ask about markets, portfolio decisions, long-term planning, or finance concepts.`;
  }
}

export default Advisor;
