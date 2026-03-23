import { useEffect, useRef, useState } from "react";
import { Bot, User } from "lucide-react";

import { cn } from "@/lib/utils";

interface Message {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
}

interface ChatInterfaceProps {
  messages: Message[];
  isThinking?: boolean;
  onStreamingComplete?: () => void;
}

function formatMessage(content: string): React.ReactNode {
  const cleaned = content
    .replace(/^["']|["']$/g, "")
    .replace(/â€¢|Ã¢â‚¬Â¢/g, "-")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/(\d+\.\s[^\n]+)\n\n+(?=\d+\.\s)/g, "$1\n")
    .replace(/([-\u2022*]\s[^\n]+)\n\n+(?=[-\u2022*]\s)/g, "$1\n");

  const paragraphs = cleaned.split(/\n\n+/);

  return paragraphs.map((paragraph, paragraphIndex) => {
    const trimmed = paragraph.trim();
    if (!trimmed) return null;

    if (/^\d+\.\s/.test(trimmed)) {
      const items = trimmed.split(/\n(?=\d+\.\s)/);
      return (
        <ol key={paragraphIndex} className="my-3 ml-5 list-decimal space-y-1.5">
          {items.map((item, itemIndex) => (
            <li key={itemIndex} className="pl-1 text-sm leading-7 text-foreground/90">
              {formatInlineText(item.replace(/^\d+\.\s*/, ""), `ol-${paragraphIndex}-${itemIndex}`)}
            </li>
          ))}
        </ol>
      );
    }

    if (/^[-\u2022*]\s/.test(trimmed)) {
      const items = trimmed.split(/\n(?=[-\u2022*]\s)/);
      return (
        <ul key={paragraphIndex} className="my-3 ml-5 list-disc space-y-1.5">
          {items.map((item, itemIndex) => (
            <li key={itemIndex} className="pl-1 text-sm leading-7 text-foreground/90">
              {formatInlineText(item.replace(/^[-\u2022*]\s*/, ""), `ul-${paragraphIndex}-${itemIndex}`)}
            </li>
          ))}
        </ul>
      );
    }

    return (
      <p key={paragraphIndex} className="my-2 text-sm leading-7 text-foreground/90 first:mt-0 last:mb-0">
        {formatInlineText(trimmed, `p-${paragraphIndex}`)}
      </p>
    );
  });
}

function formatInlineText(text: string, keyPrefix: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);

  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;

    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={key} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }

    if (part.startsWith("*") && part.endsWith("*") && !part.startsWith("**")) {
      return (
        <em key={key} className="italic">
          {part.slice(1, -1)}
        </em>
      );
    }

    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={key} className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
          {part.slice(1, -1)}
        </code>
      );
    }

    return renderLinkedText(part, key);
  });
}

function renderLinkedText(text: string, keyPrefix: string) {
  const urlPattern = /(https?:\/\/[^\s]+)/g;
  const chunks = text.split(urlPattern);

  return chunks.map((chunk, index) => {
    const key = `${keyPrefix}-chunk-${index}`;
    if (!/^https?:\/\//.test(chunk)) {
      return <span key={key}>{chunk}</span>;
    }

    const match = chunk.match(/^(https?:\/\/[^\s]+?)([.,!?;:]*)$/);
    const href = match?.[1] ?? chunk;
    const trailing = match?.[2] ?? "";

    return (
      <span key={key}>
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-primary underline decoration-primary/30 underline-offset-4 transition-colors hover:text-primary/80"
        >
          {href}
        </a>
        {trailing}
      </span>
    );
  });
}

function ThinkingText() {
  const [dots, setDots] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((value) => (value + 1) % 4);
    }, 400);

    return () => clearInterval(interval);
  }, []);

  return <span className="text-sm text-muted-foreground">Thinking{".".repeat(dots)}</span>;
}

function StreamingMessage({ content, onComplete }: { content: string; onComplete?: () => void }) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    setDisplayed("");
    setDone(false);
    let index = 0;

    const interval = setInterval(() => {
      if (index < content.length) {
        const chunkSize = Math.floor(Math.random() * 3) + 1;
        const nextIndex = Math.min(index + chunkSize, content.length);
        setDisplayed(content.slice(0, nextIndex));
        index = nextIndex;
      } else {
        setDone(true);
        onComplete?.();
        clearInterval(interval);
      }
    }, 15);

    return () => clearInterval(interval);
  }, [content, onComplete]);

  if (done) {
    return <div>{formatMessage(content)}</div>;
  }

  return (
    <div>
      {formatMessage(displayed)}
      <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-primary/70 align-text-bottom" />
    </div>
  );
}

export function ChatInterface({ messages, isThinking = false, onStreamingComplete }: ChatInterfaceProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="space-y-6">
        {messages.map((message, index) => {
          const isUser = message.role === "user";

          return (
            <div
              key={index}
              className={cn(
                "flex gap-3 animate-in fade-in duration-200",
                isUser ? "justify-end" : "justify-start",
              )}
            >
              {!isUser && (
                <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Bot className="h-4 w-4" />
                </div>
              )}

              <div
                className={cn(
                  "max-w-[85%] rounded-[24px] px-4 py-3",
                  isUser
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/45 text-foreground",
                )}
              >
                {isUser ? (
                  <p className="text-sm leading-7">{message.content}</p>
                ) : message.isStreaming ? (
                  <StreamingMessage content={message.content} onComplete={onStreamingComplete} />
                ) : (
                  <div>{formatMessage(message.content)}</div>
                )}
              </div>

              {isUser && (
                <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <User className="h-4 w-4" />
                </div>
              )}
            </div>
          );
        })}

        {isThinking && (
          <div className="flex gap-3 animate-in fade-in duration-200">
            <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Bot className="h-4 w-4 animate-pulse" />
            </div>
            <div className="rounded-[24px] bg-muted/45 px-4 py-3">
              <ThinkingText />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
