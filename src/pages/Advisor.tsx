import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { ChatInterface } from "@/components/advisor/ChatInterface";
import { SuggestedTopics } from "@/components/advisor/SuggestedTopics";
import { useChats, useChat, useCreateChat, useSendChatMessage } from "@/hooks/use-data";
import { useAuth } from "@/hooks/use-auth";

const Advisor = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const chatFromUrl = searchParams.get('chat');
  
  const { userId, isAuthenticated, userProfile } = useAuth();
  const { data: chats = [], isLoading: chatsLoading } = useChats();
  const createChatMutation = useCreateChat();
  const sendMessageMutation = useSendChatMessage();
  
  // Track the current active chat
  const [currentChatId, setCurrentChatId] = useState<string | null>(chatFromUrl);
  const { data: currentChat, isLoading: chatLoading } = useChat(currentChatId);
  
  const [showTopics, setShowTopics] = useState(true);

  // Handle chat from URL param
  useEffect(() => {
    if (chatFromUrl && chatFromUrl !== currentChatId) {
      setCurrentChatId(chatFromUrl);
      setShowTopics(false);
      // Clear the URL param after using it
      setSearchParams({});
    }
  }, [chatFromUrl, currentChatId, setSearchParams]);

  // On load, set the most recent chat as current (or null for new chat)
  useEffect(() => {
    if (!chatsLoading && chats.length > 0 && !currentChatId && !chatFromUrl) {
      // Use the most recent chat
      setCurrentChatId(chats[0].id);
      setShowTopics(false);
    }
  }, [chats, chatsLoading, currentChatId, chatFromUrl]);

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

    try {
      let chatId = currentChatId;
      let isFirstMessage = false;

      // Create a new chat if we don't have one
      if (!chatId) {
        const newChat = await createChatMutation.mutateAsync('New Chat');
        chatId = newChat.id;
        setCurrentChatId(chatId);
        isFirstMessage = true;
      } else if (currentChat?.messageCount === 0) {
        isFirstMessage = true;
      }

      setShowTopics(false);

      await sendMessageMutation.mutateAsync({ 
        chatId, 
        message: content,
        isFirstMessage,
      });
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

  const handleTopicSelect = (topic: string) => {
    handleSendMessage(topic);
  };

  const handleNewChat = async () => {
    if (!userId) return;
    
    try {
      const newChat = await createChatMutation.mutateAsync('New Chat');
      setCurrentChatId(newChat.id);
      setShowTopics(true);
    } catch (error) {
      console.error('Error creating new chat:', error);
    }
  };

  // Convert database messages to component format
  const messages = currentChat?.messages || [];
  const chatMessages = messages.map(msg => ({
    role: msg.role as "user" | "assistant",
    content: msg.content,
  }));

  // If no messages yet, show welcome message in UI
  const displayMessages = chatMessages.length === 0 
    ? [{
        role: "assistant" as const,
        content: getWelcomeMessage(userProfile?.first_name, userProfile?.experience_level),
      }]
    : chatMessages;

  const isLoading = chatsLoading || chatLoading || sendMessageMutation.isPending || createChatMutation.isPending;

  return (
    <AppLayout title="AI Financial Advisor">
      <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-4xl w-full flex-col">
        {showTopics && displayMessages.length <= 1 && (
          <SuggestedTopics onSelectTopic={handleTopicSelect} />
        )}
        <ChatInterface
          messages={displayMessages}
          onSendMessage={handleSendMessage}
          onNewChat={handleNewChat}
          isLoading={isLoading}
          chatTitle={currentChat?.title}
        />
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
