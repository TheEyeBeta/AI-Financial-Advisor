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
        content: getWelcomeMessage(userProfile?.first_name),
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

function getWelcomeMessage(firstName?: string | null): string {
  const greeting = firstName ? `Hello ${firstName}!` : "Hello!";
  return `${greeting} I'm your AI Financial Advisor. I can help you learn about:

• **Investing basics** - stocks, bonds, ETFs, mutual funds
• **Portfolio building** - diversification and asset allocation
• **Retirement planning** - 401(k), IRA, compound interest
• **Risk management** - protecting your investments
• **Market analysis** - understanding trends and indicators

What would you like to explore today?`;
}

export default Advisor;
