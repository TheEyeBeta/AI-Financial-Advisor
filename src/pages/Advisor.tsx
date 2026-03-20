import { useEffect, useState, useRef } from "react";
import { useSearchParams, useLocation } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { ChatInterface } from "@/components/advisor/ChatInterface";
import { SuggestedTopics } from "@/components/advisor/SuggestedTopics";
import { useChats, useChat, useCreateChat, useSendChatMessage } from "@/hooks/use-data";
import { useAuth } from "@/hooks/use-auth";

const Advisor = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const chatFromUrl = searchParams.get('chat');
  const isExplicitNewChat = searchParams.get('new') === '1';
  
  const { userId, isAuthenticated, userProfile } = useAuth();
  const { data: chats = [], isLoading: chatsLoading } = useChats();
  const createChatMutation = useCreateChat();
  const sendMessageMutation = useSendChatMessage();
  
  // Track the current active chat
  const [currentChatId, setCurrentChatId] = useState<string | null>(chatFromUrl);
  const { data: currentChat, isLoading: chatLoading } = useChat(currentChatId);
  
  const [showTopics, setShowTopics] = useState(true);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  // Track the message count before sending to identify the new AI response for streaming
  const prevMessageCountRef = useRef<number>(0);
  const [streamingResponseContent, setStreamingResponseContent] = useState<string | null>(null);
  // Track when user explicitly wants a new chat (prevents auto-loading most recent chat)
  const isNewChatRef = useRef<boolean>(false);
  
  // Handle initial message from navigation state (e.g., from learning topics)
  useEffect(() => {
    const handleInitialMessage = async () => {
      // Check if there's an initial message in location state
      const state = location.state as { initialMessage?: string } | null;
      if (state?.initialMessage && isAuthenticated && userId) {
        const message = state.initialMessage;
        // Send the message
        await handleSendMessage(message);
        // Clear the state to avoid re-triggering on re-render
        window.history.replaceState({ ...window.history.state, state: null }, '');
      }
    };
    
    if (isAuthenticated && userId) {
      handleInitialMessage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, isAuthenticated, userId]);

  // Handle chat/new intent from URL params
  useEffect(() => {
    if (chatFromUrl && chatFromUrl !== currentChatId) {
      isNewChatRef.current = false;
      setCurrentChatId(chatFromUrl);
      setShowTopics(false);
      // Clear the URL params after using them
      setSearchParams({});
      return;
    }

    if (isExplicitNewChat) {
      isNewChatRef.current = true;
      setCurrentChatId(null);
      setShowTopics(true);
      setPendingMessage(null);
      setStreamingResponseContent(null);
      // Clear the URL params after using them
      setSearchParams({});
    }
  }, [chatFromUrl, currentChatId, isExplicitNewChat, setSearchParams]);

  // On load, set the most recent chat as current (or null for new chat)
  useEffect(() => {
    if (!chatsLoading && chats.length > 0 && !currentChatId && !chatFromUrl && !isExplicitNewChat && !isNewChatRef.current) {
      // Use the most recent chat
      setCurrentChatId(chats[0].id);
      setShowTopics(false);
    }
  }, [chats, chatsLoading, currentChatId, chatFromUrl, isExplicitNewChat]);

  // Show topics when starting fresh
  useEffect(() => {
    if (currentChat && currentChat.messageCount === 0) {
      setShowTopics(true);
    } else if (currentChat && currentChat.messageCount > 0) {
      setShowTopics(false);
    }
  }, [currentChat]);

  const handleSendMessage = async (content: string) => {
    if (!isAuthenticated || !userId) {
      console.error('User not authenticated');
      return;
    }

    // Show user message immediately (optimistic update)
    setPendingMessage(content);
    setShowTopics(false);
    // Remember current count so we can identify the new AI response
    prevMessageCountRef.current = (currentChat?.messages?.length ?? 0);

    try {
      let chatId = currentChatId;
      let isFirstMessage = false;

      // Create a new chat if we don't have one
      if (!chatId) {
        const newChat = await createChatMutation.mutateAsync('New Chat');
        chatId = newChat.id;
        isNewChatRef.current = false;
        setCurrentChatId(chatId);
        isFirstMessage = true;
      } else if (currentChat?.messageCount === 0) {
        isFirstMessage = true;
      }

      const result = await sendMessageMutation.mutateAsync({
        chatId,
        message: content,
        isFirstMessage,
      });

      // Flag the AI response for streaming typewriter effect
      if (result?.response) {
        setStreamingResponseContent(result.response);
      }

      // Clear pending message after mutation completes
      setPendingMessage(null);
    } catch (error) {
      console.error('Error sending message:', error);
      // Clear pending message on error so user can retry
      setPendingMessage(null);
    }
  };

  const handleTopicSelect = (topic: string) => {
    handleSendMessage(topic);
  };

  const handleNewChat = () => {
    isNewChatRef.current = true;
    setCurrentChatId(null);
    setShowTopics(true);
    setPendingMessage(null);
    setStreamingResponseContent(null);
  };

  // Convert database messages to component format
  const messages = currentChat?.messages || [];
  const chatMessages = messages.map((msg, index) => {
    // Flag the last assistant message as streaming if it matches the streaming content
    const isLastAssistant = msg.role === 'assistant' && index === messages.length - 1;
    const shouldStream = isLastAssistant && streamingResponseContent !== null && msg.content === streamingResponseContent;

    return {
      role: msg.role as "user" | "assistant",
      content: msg.content,
      isStreaming: shouldStream,
    };
  });

  // Add pending message if it exists and hasn't been saved yet
  let displayMessages = chatMessages;
  if (pendingMessage) {
    // Check if the pending message is already in the chat (meaning it was saved)
    const isMessageSaved = chatMessages.some(
      msg => msg.role === 'user' && msg.content === pendingMessage
    );
    
    if (!isMessageSaved) {
      // Add pending message optimistically
      displayMessages = [
        ...chatMessages,
        {
          role: "user" as const,
          content: pendingMessage,
        }
      ];
    }
  }
  
  // Clear pending message when it appears in the chat (useEffect to avoid stale closure)
  useEffect(() => {
    if (pendingMessage && chatMessages.some(
      msg => msg.role === 'user' && msg.content === pendingMessage
    )) {
      setPendingMessage(null);
    }
  }, [pendingMessage, chatMessages]);

  // If no messages yet, show welcome message in UI
  if (displayMessages.length === 0) {
    displayMessages = [{
      role: "assistant" as const,
      content: getWelcomeMessage(userProfile?.first_name, userProfile?.experience_level),
    }];
  }

  const isLoading = chatsLoading || chatLoading || sendMessageMutation.isPending || createChatMutation.isPending;
  // Only show "Thinking..." when waiting for an AI response, not during initial loads
  const isThinking = sendMessageMutation.isPending;

  return (
    <AppLayout title="AI Financial Advisor">
      <div className="mx-auto flex h-[calc(100dvh-4rem)] max-w-4xl w-full flex-col">
        {/* Scrollable content area */}
        <div className="flex-1 overflow-y-auto px-4 pb-4 scrollbar-subtle">
          {/* Suggested Topics */}
          {showTopics && displayMessages.length <= 1 && (
            <SuggestedTopics 
              onSelectTopic={handleTopicSelect} 
              experienceLevel={userProfile?.experience_level}
            />
          )}
          
          {/* Chat Messages */}
          <ChatInterface
            messages={displayMessages}
            onNewChat={handleNewChat}
            isLoading={isLoading}
            isThinking={isThinking}
            chatTitle={currentChat?.title}
            onStreamingComplete={() => setStreamingResponseContent(null)}
          />
        </div>
        
        {/* Input pinned to bottom */}
        <div className="px-4 pb-1 pt-0.5">
          <div className="max-w-3xl mx-auto relative">
            <input
              type="text"
              placeholder={userProfile?.first_name ? `Message...` : "Ask anything..."}
              className="w-full h-11 pl-3 pr-12 rounded-lg border border-border/50 bg-muted/20 text-sm placeholder:text-muted-foreground/40 focus:bg-background focus:border-primary/40 focus:outline-none transition-all duration-200 disabled:opacity-50"
              disabled={isLoading}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  const input = e.currentTarget;
                  if (input.value.trim()) {
                    handleSendMessage(input.value.trim());
                    input.value = '';
                  }
                }
              }}
              id="chat-input"
            />
            <button 
              type="button"
              disabled={isLoading}
              onClick={() => {
                const input = document.getElementById('chat-input') as HTMLInputElement;
                if (input?.value.trim()) {
                  handleSendMessage(input.value.trim());
                  input.value = '';
                }
              }}
              className="absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9 rounded-md bg-primary/80 hover:bg-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center text-primary-foreground"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>
            </button>
          </div>
          <p className="text-xs text-muted-foreground/50 text-center mt-1">
            Test mode only · AI responses can include financial suggestions and are not professional financial advice
          </p>
        </div>
      </div>
    </AppLayout>
  );
};

function getWelcomeMessage(
  firstName?: string | null,
  experienceLevel?: 'beginner' | 'intermediate' | 'advanced' | null
): string {
  const greeting = firstName ? `Hello ${firstName}!` : "Hello!";
  
  switch (experienceLevel) {
    case 'beginner':
      return `${greeting} I'm your AI Financial Teacher, and I'm here to help you start your financial journey! 🎓

I'll explain everything in simple terms and make sure you understand each concept before moving forward. Here's what I can help you with:

• **Getting Started** - What is investing? How does the stock market work?
• **Basic Concepts** - Stocks, bonds, ETFs, and how they differ
• **Building Your First Portfolio** - Simple strategies to get started
• **Saving for the Future** - Retirement accounts, compound interest basics
• **Understanding Risk** - How to protect your money while growing it

Don't worry if something seems confusing - just ask me to explain it differently! What would you like to learn about first?`;

    case 'intermediate':
      return `${greeting} I'm your AI Financial Advisor, ready to help you take your investing knowledge to the next level! 📈

I'll assume you know the basics and dive into more nuanced strategies and concepts. Here's how I can help:

• **Advanced Portfolio Strategies** - Sector analysis, rebalancing, tax optimization
• **Options & Derivatives** - Understanding options basics and when to use them
• **Market Dynamics** - Technical analysis, market cycles, economic indicators
• **Risk Management** - Hedging strategies, position sizing, stop losses
• **Performance Analysis** - Evaluating your trades and improving your strategy

What area would you like to explore or improve?`;

    case 'advanced':
      return `${greeting} I'm your AI Financial Advisor, here to engage in sophisticated financial discussions! 💼

I'll discuss complex strategies and advanced concepts with you. Here's what we can dive into:

• **Advanced Strategies** - Derivatives, arbitrage, quantitative analysis, algorithmic trading
• **Market Microstructure** - Order flow, liquidity, execution strategies
• **Portfolio Optimization** - Modern portfolio theory, factor investing, risk parity
• **Macro Analysis** - Economic indicators, central bank policy, global markets
• **Performance Metrics** - Sharpe ratio, Sortino ratio, alpha generation, risk-adjusted returns

What complex topic or strategy would you like to analyze?`;

    default:
      return `${greeting} I'm your AI Financial Advisor. I can help you learn about:

• **Investing basics** - stocks, bonds, ETFs, mutual funds
• **Portfolio building** - diversification and asset allocation
• **Retirement planning** - 401(k), IRA, compound interest
• **Risk management** - protecting your investments
• **Market analysis** - understanding trends and indicators

What would you like to explore today?`;
  }
}

export default Advisor;
