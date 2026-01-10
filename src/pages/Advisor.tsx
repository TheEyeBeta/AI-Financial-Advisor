import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { ChatInterface } from "@/components/advisor/ChatInterface";
import { SuggestedTopics } from "@/components/advisor/SuggestedTopics";

const Advisor = () => {
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([
    {
      role: "assistant",
      content: "Hello! I'm your AI Financial Advisor. I'm here to help you learn about investing, trading strategies, market concepts, and personal finance. What would you like to explore today?",
    },
  ]);

  const handleSendMessage = (content: string) => {
    setMessages((prev) => [...prev, { role: "user", content }]);
    
    // Simulate AI response
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: getSimulatedResponse(content),
        },
      ]);
    }, 1000);
  };

  const handleTopicSelect = (topic: string) => {
    handleSendMessage(topic);
  };

  return (
    <AppLayout title="AI Financial Advisor">
      <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-4xl flex-col">
        {messages.length === 1 && (
          <SuggestedTopics onSelectTopic={handleTopicSelect} />
        )}
        <ChatInterface
          messages={messages}
          onSendMessage={handleSendMessage}
        />
      </div>
    </AppLayout>
  );
};

function getSimulatedResponse(question: string): string {
  const responses: Record<string, string> = {
    default: "That's a great question! As your AI financial educator, I'd be happy to explain this concept. In finance, understanding the fundamentals is key to making informed decisions. Would you like me to break this down further or explore a related topic?",
  };
  
  const lowerQuestion = question.toLowerCase();
  
  if (lowerQuestion.includes("options")) {
    return "Options are financial derivatives that give buyers the right, but not the obligation, to buy or sell an underlying asset at a specified price before a certain date. There are two main types: **Call options** (right to buy) and **Put options** (right to sell). They're used for hedging, speculation, and generating income. Would you like to learn about specific options strategies?";
  }
  
  if (lowerQuestion.includes("dollar-cost averaging") || lowerQuestion.includes("dca")) {
    return "Dollar-cost averaging (DCA) is an investment strategy where you invest a fixed amount at regular intervals, regardless of market conditions. This approach helps reduce the impact of volatility and removes the emotional aspect of trying to 'time the market.' For example, investing $500 monthly into an index fund means you buy more shares when prices are low and fewer when they're high.";
  }
  
  if (lowerQuestion.includes("etf")) {
    return "An ETF (Exchange-Traded Fund) is a basket of securities that trades on an exchange like a stock. ETFs can contain stocks, bonds, commodities, or a mix. They offer diversification, lower fees than mutual funds, and tax efficiency. Popular examples include SPY (S&P 500), QQQ (Nasdaq 100), and VTI (Total Stock Market). Would you like to compare ETFs vs mutual funds?";
  }
  
  if (lowerQuestion.includes("risk")) {
    return "Understanding risk is fundamental to investing. Key concepts include: **Market Risk** (overall market declines), **Credit Risk** (default on debt), **Liquidity Risk** (inability to sell quickly), and **Inflation Risk** (purchasing power erosion). Risk tolerance varies by individual and should align with your investment timeline and goals. How would you like to assess your risk profile?";
  }
  
  return responses.default;
}

export default Advisor;
