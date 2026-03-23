import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { formatDistanceToNow, isToday, isYesterday, parseISO } from "date-fns";
import { Clock3, History, Plus } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { ChatInterface } from "@/components/advisor/ChatInterface";
import { SuggestedTopics } from "@/components/advisor/SuggestedTopics";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useChat, useChats, useCreateChat, useSendChatMessage } from "@/hooks/use-data";
import { AppLayout } from "@/components/layout/AppLayout";

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
  const { data: chats = [], isLoading: chatsLoading } = useChats();
  const createChatMutation = useCreateChat();
  const sendMessageMutation = useSendChatMessage();

  const [currentChatId, setCurrentChatId] = useState<string | null>(chatFromUrl);
  const { data: currentChat, isLoading: chatLoading } = useChat(currentChatId);

  const [showTopics, setShowTopics] = useState(true);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [streamingResponseContent, setStreamingResponseContent] = useState<string | null>(null);
  const [composerValue, setComposerValue] = useState("");
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
    if (currentChat && currentChat.messageCount === 0) {
      setShowTopics(true);
    } else if (currentChat && currentChat.messageCount > 0) {
      setShowTopics(false);
    }
  }, [currentChat]);

  const handleSendMessage = async (content: string): Promise<boolean> => {
    const trimmedContent = content.trim();

    if (!trimmedContent) return false;
    if (!isAuthenticated || !userId) {
      console.error("User not authenticated");
      return false;
    }

    setPendingMessage(trimmedContent);
    setShowTopics(false);

    try {
      let chatId = currentChatId;
      let isFirstMessage = false;

      if (!chatId) {
        const newChat = await createChatMutation.mutateAsync("New Chat");
        chatId = newChat.id;
        isNewChatRef.current = false;
        setCurrentChatId(chatId);
        isFirstMessage = true;
      } else if (currentChat?.messageCount === 0) {
        isFirstMessage = true;
      }

      const result = await sendMessageMutation.mutateAsync({
        chatId,
        message: trimmedContent,
        isFirstMessage,
      });

      if (result?.response) {
        setStreamingResponseContent(result.response);
      }

      setPendingMessage(null);
      return true;
    } catch (error) {
      console.error("Error sending message:", error);
      setPendingMessage(null);
      return false;
    }
  };

  const handleComposerSubmit = async () => {
    const didSend = await handleSendMessage(composerValue);
    if (didSend) {
      setComposerValue("");
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
    setComposerValue("");
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
  };

  const messages = currentChat?.messages || [];
  const chatMessages = messages.map((msg, index) => {
    const isLastAssistant = msg.role === "assistant" && index === messages.length - 1;
    const shouldStream = isLastAssistant && streamingResponseContent !== null && msg.content === streamingResponseContent;

    return {
      role: msg.role as "user" | "assistant",
      content: msg.content,
      isStreaming: shouldStream,
    };
  });

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

  useEffect(() => {
    if (pendingMessage && chatMessages.some((msg) => msg.role === "user" && msg.content === pendingMessage)) {
      setPendingMessage(null);
    }
  }, [pendingMessage, chatMessages]);

  if (displayMessages.length === 0) {
    displayMessages = [
      {
        role: "assistant" as const,
        content: getWelcomeMessage(userProfile?.first_name, userProfile?.experience_level),
      },
    ];
  }

  const isLoading = chatsLoading || chatLoading || sendMessageMutation.isPending || createChatMutation.isPending;
  const isThinking = sendMessageMutation.isPending;
  const isStarterState = showTopics && displayMessages.length <= 1;
  const experienceLevel = userProfile?.experience_level as ExperienceLevel;
  const quickPrompts = getQuickPrompts(experienceLevel);
  const experienceLevelLabel = getExperienceLevelLabel(experienceLevel);
  const latestChat = chats[0];
  const chatHeaderTitle = currentChat?.title || "Conversation";
  const chatHeaderDescription = currentChat?.updated_at
    ? `Updated ${formatActivityTime(currentChat.updated_at)}`
    : "Ask follow-ups and keep the thread going.";

  return (
    <AppLayout title="Advisor">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col overflow-hidden">
        {isStarterState ? (
          <div className="flex flex-1 items-center overflow-y-auto px-4 py-8 sm:px-6">
            <div className="mx-auto w-full max-w-3xl">
              <div className="text-center">
                <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
                  {getStarterHeading(userProfile?.first_name)}
                </h1>
                <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
                  Ask about markets, portfolio decisions, or financial planning. IRIS uses your profile and The Eye context when it is available.
                </p>
                <div className="mt-4 flex justify-center">
                  <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/70 px-3 py-1.5 text-xs text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary/70" />
                    <span>Personalized for</span>
                    <span className="font-medium text-foreground">{experienceLevelLabel}</span>
                  </div>
                </div>
              </div>

              <div className="mt-8">
                <AdvisorComposer
                  textareaRef={composerRef}
                  value={composerValue}
                  onChange={setComposerValue}
                  onSubmit={() => void handleComposerSubmit()}
                  disabled={isLoading}
                  placeholder="Ask anything..."
                  helperText="Enter to send. Shift+Enter for a new line."
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
                  experienceLevel={userProfile?.experience_level}
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

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-6">
              <ChatInterface
                messages={displayMessages}
                isThinking={isThinking}
                onStreamingComplete={() => setStreamingResponseContent(null)}
              />
            </div>

              <div className="border-t border-border/60 px-4 py-4 sm:px-6">
                <div className="mx-auto max-w-3xl">
                  <AdvisorComposer
                    textareaRef={composerRef}
                    value={composerValue}
                    onChange={setComposerValue}
                    onSubmit={() => void handleComposerSubmit()}
                  disabled={isLoading}
                  placeholder="Ask a follow-up..."
                  helperText="Enter to send. Shift+Enter for a new line."
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
}

const AdvisorComposer = ({
  textareaRef,
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder,
  helperText,
}: AdvisorComposerProps) => {
  return (
    <div className="rounded-[30px] border border-border/60 bg-card/95 px-5 py-4 shadow-[0_20px_50px_-44px_rgba(15,23,42,0.5)]">
      <Textarea
        ref={textareaRef}
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
