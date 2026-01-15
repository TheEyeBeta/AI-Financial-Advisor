import { useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { ChatInterface } from "@/components/advisor/ChatInterface";
import { SuggestedTopics } from "@/components/advisor/SuggestedTopics";
import { useChatMessages, useSendChatMessage } from "@/hooks/use-data";
import { useAuth } from "@/hooks/use-auth";
import { chatApi } from "@/services/api";
import type { ChatMessage } from "@/types/database";

const Advisor = () => {
  const { userId, isAuthenticated } = useAuth();
  const { data: messages = [], isLoading } = useChatMessages();
  const sendMessageMutation = useSendChatMessage();

  // Initialize with welcome message if no messages exist
  useEffect(() => {
    const initializeChat = async () => {
      if (isAuthenticated && userId && messages.length === 0 && !isLoading) {
        const welcomeMessage: ChatMessage = {
          id: 'welcome',
          user_id: userId,
          role: 'assistant',
          content: "Hello! I'm your AI Financial Advisor. I'm here to help you learn about investing, trading strategies, market concepts, and personal finance. What would you like to explore today?",
          created_at: new Date().toISOString(),
        };
        
        try {
          await chatApi.addMessage(userId, 'assistant', welcomeMessage.content);
        } catch (error) {
          console.error('Error initializing chat:', error);
        }
      }
    };

    initializeChat();
  }, [isAuthenticated, userId, messages.length, isLoading]);

  const handleSendMessage = async (content: string) => {
    if (!isAuthenticated) {
      console.error('User not authenticated');
      return;
    }

    try {
      await sendMessageMutation.mutateAsync({ message: content });
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

  const handleTopicSelect = (topic: string) => {
    handleSendMessage(topic);
  };

  // Convert database messages to component format
  const chatMessages = messages.map(msg => ({
    role: msg.role as "user" | "assistant",
    content: msg.content,
  }));

  // If no messages yet, show welcome message in UI
  const displayMessages = chatMessages.length === 0 
    ? [{
        role: "assistant" as const,
        content: "Hello! I'm your AI Financial Advisor. I'm here to help you learn about investing, trading strategies, market concepts, and personal finance. What would you like to explore today?",
      }]
    : chatMessages;

  return (
    <AppLayout title="AI Financial Advisor">
      <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-4xl w-full flex-col">
        {displayMessages.length === 1 && (
          <SuggestedTopics onSelectTopic={handleTopicSelect} />
        )}
        <ChatInterface
          messages={displayMessages}
          onSendMessage={handleSendMessage}
          isLoading={sendMessageMutation.isPending}
        />
      </div>
    </AppLayout>
  );
};

export default Advisor;
