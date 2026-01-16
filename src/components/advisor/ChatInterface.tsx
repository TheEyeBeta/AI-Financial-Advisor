import { useState, useRef, useEffect } from "react";
import { Send, Bot, User, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ChatInterfaceProps {
  messages: Message[];
  onSendMessage: (content: string) => void;
  onNewChat?: () => void;
  isLoading?: boolean;
  chatTitle?: string;
}

// Format AI response with better readability
function formatMessage(content: string): React.ReactNode {
  // First, normalize line breaks - join numbered/bullet items that are separated by double newlines
  let normalized = content
    // Join numbered list items separated by blank lines
    .replace(/(\d+\.\s[^\n]+)\n\n+(?=\d+\.\s)/g, '$1\n')
    // Join bullet list items separated by blank lines  
    .replace(/([-•*]\s[^\n]+)\n\n+(?=[-•*]\s)/g, '$1\n');

  // Split content into paragraphs
  const paragraphs = normalized.split(/\n\n+/);
  
  return paragraphs.map((para, pIndex) => {
    // Check if it's a numbered list
    if (/^\d+\.\s/.test(para)) {
      const items = para.split(/\n(?=\d+\.\s)/);
      return (
        <ol key={pIndex} className="list-decimal list-outside space-y-1 my-2 ml-5">
          {items.map((item, iIndex) => (
            <li key={iIndex} className="text-sm leading-relaxed">
              {formatInlineText(item.replace(/^\d+\.\s*/, ''))}
            </li>
          ))}
        </ol>
      );
    }
    
    // Check if it's a bullet list
    if (/^[-•*]\s/.test(para)) {
      const items = para.split(/\n(?=[-•*]\s)/);
      return (
        <ul key={pIndex} className="list-disc list-outside space-y-1 my-2 ml-5">
          {items.map((item, iIndex) => (
            <li key={iIndex} className="text-sm leading-relaxed">
              {formatInlineText(item.replace(/^[-•*]\s*/, ''))}
            </li>
          ))}
        </ul>
      );
    }
    
    // Regular paragraph
    return (
      <p key={pIndex} className="text-sm leading-relaxed my-2 first:mt-0 last:mb-0">
        {formatInlineText(para)}
      </p>
    );
  });
}

// Format inline text (bold, italic, etc.)
function formatInlineText(text: string): React.ReactNode {
  // Handle **bold** text
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index} className="font-semibold">{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

export function ChatInterface({ messages, onSendMessage, onNewChat, isLoading = false, chatTitle }: ChatInterfaceProps) {
  const [input, setInput] = useState("");
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      onSendMessage(input.trim());
      setInput("");
    }
  };

  return (
    <div className="flex flex-1 flex-col rounded-xl border bg-card shadow-sm">
      {/* Header with chat title and New Chat button */}
      {onNewChat && messages.length > 1 && (
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="font-medium text-sm">
            {chatTitle || 'New Chat'}
          </span>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={onNewChat}
            className="gap-2"
          >
            <Plus className="h-4 w-4" />
            New Chat
          </Button>
        </div>
      )}
      
      <ScrollArea className="flex-1 p-4" ref={scrollAreaRef}>
        <div className="space-y-4">
          {messages.map((message, index) => (
            <div
              key={index}
              className={cn(
                "flex gap-3",
                message.role === "user" ? "flex-row-reverse" : "flex-row"
              )}
            >
              <div
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                  message.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                )}
              >
                {message.role === "user" ? (
                  <User className="h-4 w-4" />
                ) : (
                  <Bot className="h-4 w-4 text-primary" />
                )}
              </div>
              <div
                className={cn(
                  "max-w-[80%] rounded-2xl px-4 py-3",
                  message.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"
                )}
              >
                {message.role === "assistant" ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    {formatMessage(message.content)}
                  </div>
                ) : (
                  <p className="text-sm leading-relaxed">
                    {message.content}
                  </p>
                )}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                <Bot className="h-4 w-4 text-primary animate-pulse" />
              </div>
              <div className="max-w-[80%] rounded-2xl bg-muted px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <span className="h-2 w-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="h-2 w-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="h-2 w-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-sm text-muted-foreground">Thinking...</span>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 border-t p-4"
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about investing, markets, or financial concepts..."
          className="flex-1"
        />
        <Button type="submit" size="icon" disabled={!input.trim() || isLoading}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
