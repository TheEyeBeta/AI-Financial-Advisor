import { useRef, useEffect } from "react";
import { Bot, User, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ChatInterfaceProps {
  messages: Message[];
  onNewChat?: () => void;
  isLoading?: boolean;
  chatTitle?: string;
}

// Format AI response with better readability
function formatMessage(content: string): React.ReactNode {
  // First, normalize line breaks - join numbered/bullet items that are separated by double newlines
  const normalized = content
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
        <ol key={pIndex} className="list-decimal list-outside space-y-2 my-3 ml-6">
          {items.map((item, iIndex) => (
            <li key={iIndex} className="text-sm leading-relaxed text-foreground/90">
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
        <ul key={pIndex} className="list-disc list-outside space-y-2 my-3 ml-6">
          {items.map((item, iIndex) => (
            <li key={iIndex} className="text-sm leading-relaxed text-foreground/90">
              {formatInlineText(item.replace(/^[-•*]\s*/, ''))}
            </li>
          ))}
        </ul>
      );
    }
    
    // Regular paragraph
    return (
      <p key={pIndex} className="text-sm leading-relaxed my-3 first:mt-0 last:mb-0 text-foreground/90">
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

export function ChatInterface({ messages, onNewChat, isLoading = false, chatTitle }: ChatInterfaceProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  return (
    <div className="flex flex-col">
      {/* Compact header */}
      {onNewChat && messages.length > 1 && (
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="font-medium text-sm text-foreground">
              {chatTitle || 'New Chat'}
            </span>
          </div>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={onNewChat}
            className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            New
          </Button>
        </div>
      )}
      
      <div className="space-y-4">
        {messages.map((message, index) => (
          <div
            key={index}
            className={cn(
              "flex gap-3 animate-in fade-in duration-200",
              message.role === "user" ? "flex-row-reverse" : "flex-row"
            )}
          >
            {/* Compact Avatar */}
            <div
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
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
            
            {/* Clean Message Bubble */}
            <div
              className={cn(
                "max-w-[80%] rounded-2xl px-4 py-2.5",
                message.role === "user"
                  ? "bg-primary text-primary-foreground rounded-br-sm"
                  : "bg-muted/50 text-foreground rounded-bl-sm"
              )}
            >
              {message.role === "assistant" ? (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  {formatMessage(message.content)}
                </div>
              ) : (
                <p className="text-sm">
                  {message.content}
                </p>
              )}
            </div>
          </div>
        ))}
        
        {isLoading && (
          <div className="flex gap-3 animate-in fade-in duration-200">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
              <Bot className="h-4 w-4 text-primary animate-pulse" />
            </div>
            <div className="rounded-2xl rounded-bl-sm bg-muted/50 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <span className="h-2 w-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="h-2 w-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="h-2 w-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
