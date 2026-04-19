import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format, isThisWeek, isToday, isYesterday, parseISO } from "date-fns";
import { Check, ChevronRight, Clock, MessageSquare, Pencil, Plus, Trash2, X } from "lucide-react";

import { AppLayout } from "@/components/layout/AppLayout";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useChats, useDeleteChat, useUpdateChatTitle } from "@/hooks/use-data";
import type { ChatWithMessages } from "@/types/database";
import { cn } from "@/lib/utils";

function getDateLabel(dateStr: string): string {
  const date = parseISO(dateStr);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  if (isThisWeek(date)) return format(date, "EEEE");
  return format(date, "MMM d");
}

function formatUpdatedAt(dateStr: string): string {
  const date = parseISO(dateStr);
  if (isToday(date)) return `Today at ${format(date, "h:mm a")}`;
  if (isYesterday(date)) return `Yesterday at ${format(date, "h:mm a")}`;
  return format(date, "MMM d, yyyy 'at' h:mm a");
}

function getPreviewText(chat: ChatWithMessages): string {
  if (!chat.lastMessage?.content) {
    return "No messages in this thread yet.";
  }

  const normalized = chat.lastMessage.content.replace(/\s+/g, " ").trim();
  if (normalized.length <= 110) {
    return normalized;
  }

  return `${normalized.slice(0, 107)}...`;
}

const ChatHistory = () => {
  const navigate = useNavigate();
  const { data: chats = [], isLoading, error } = useChats();
  const deleteChatMutation = useDeleteChat();
  const updateTitleMutation = useUpdateChatTitle();

  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const groupedChats = useMemo(() => {
    return chats.reduce((groups, chat) => {
      const label = getDateLabel(chat.updated_at);
      if (!groups[label]) groups[label] = [];
      groups[label].push(chat);
      return groups;
    }, {} as Record<string, ChatWithMessages[]>);
  }, [chats]);

  const totalMessages = useMemo(
    () => chats.reduce((sum, chat) => sum + chat.messageCount, 0),
    [chats],
  );

  const recentActivity = chats[0]?.updated_at ? formatUpdatedAt(chats[0].updated_at) : "No recent activity";

  const handleDeleteChat = async (chatId: string) => {
    try {
      await deleteChatMutation.mutateAsync(chatId);
    } catch (error) {
      console.error("Error deleting chat:", error);
    }
  };

  const handleStartEdit = (chat: ChatWithMessages, event: React.MouseEvent) => {
    event.stopPropagation();
    setEditingChatId(chat.id);
    setEditTitle(chat.title);
  };

  const handleSaveTitle = async (chatId: string) => {
    if (!editTitle.trim()) return;

    try {
      await updateTitleMutation.mutateAsync({ chatId, title: editTitle.trim() });
      setEditingChatId(null);
      setEditTitle("");
    } catch (error) {
      console.error("Error updating title:", error);
    }
  };

  const handleCancelEdit = () => {
    setEditingChatId(null);
    setEditTitle("");
  };

  const handleOpenChat = (chatId: string) => {
    navigate(`/advisor?chat=${chatId}`);
  };

  const handleChatKeyDown = (event: React.KeyboardEvent<HTMLElement>, chatId: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleOpenChat(chatId);
    }
  };

  if (isLoading) {
    return (
      <AppLayout title="Chat History">
        <div className="mx-auto max-w-5xl space-y-6">
          <Card className="rounded-[24px] border-border/60 bg-card/95 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.28)]">
            <CardContent className="space-y-5 p-6">
              <div className="space-y-3">
                <div className="h-5 w-28 rounded-full bg-muted/70" />
                <div className="h-10 w-full max-w-sm rounded-2xl bg-muted/70" />
                <div className="h-4 w-full max-w-xl rounded-full bg-muted/60" />
              </div>
              <div className="flex gap-2">
                <div className="h-10 w-36 rounded-full bg-muted/60" />
                <div className="h-10 w-40 rounded-full bg-muted/50" />
              </div>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3].map((item) => (
                  <div key={item} className="h-9 w-32 rounded-full bg-muted/50" />
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            {[1, 2, 3].map((group) => (
              <Card key={group} className="rounded-[22px] border-border/60 bg-card/85">
                <CardContent className="space-y-3 p-3">
                  <div className="h-4 w-24 rounded-full bg-muted/60" />
                  {[1, 2].map((row) => (
                    <div key={row} className="rounded-[18px] border border-border/60 bg-background/70 p-4">
                      <div className="h-5 w-1/3 rounded-full bg-muted/60" />
                      <div className="mt-3 h-4 w-full rounded-full bg-muted/50" />
                      <div className="mt-2 h-4 w-2/3 rounded-full bg-muted/40" />
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Chat History">
      <div className="mx-auto max-w-5xl space-y-6">
        <section className="rounded-[24px] border border-border/60 bg-card/95 p-6 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.28)] animate-in fade-in duration-300">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-muted/50 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                <MessageSquare className="h-3.5 w-3.5" />
                Chat History
              </div>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                  Keep your advisor threads tidy.
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                  Reopen recent conversations, rename threads, and keep the archive easy to scan.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {chats[0] && (
                <Button
                  variant="outline"
                  onClick={() => handleOpenChat(chats[0].id)}
                  className="h-10 rounded-full px-4"
                >
                  <Clock className="h-4 w-4" />
                  Continue latest
                </Button>
              )}
              <Button
                onClick={() => navigate("/advisor?new=1")}
                className="h-10 rounded-full px-4"
              >
                <Plus className="h-4 w-4" />
                New conversation
              </Button>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2 text-sm">
            <div className="rounded-full border border-border/70 bg-muted/40 px-3 py-2 text-muted-foreground">
              <span className="font-semibold text-foreground">{chats.length}</span> conversations
            </div>
            <div className="rounded-full border border-border/70 bg-muted/40 px-3 py-2 text-muted-foreground">
              <span className="font-semibold text-foreground">{totalMessages}</span> messages
            </div>
            <div className="rounded-full border border-border/70 bg-muted/40 px-3 py-2 text-muted-foreground">
              <span className="font-semibold text-foreground">{recentActivity}</span>
            </div>
          </div>
        </section>

        {error ? (
          <Card className="overflow-hidden rounded-[28px] border-border/60 bg-card/95 shadow-[0_24px_60px_-48px_rgba(15,23,42,0.7)] animate-in fade-in duration-300">
            <CardContent className="py-16 text-center">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[20px] bg-muted">
                <MessageSquare className="h-8 w-8 text-muted-foreground" />
              </div>
              <h2 className="text-xl font-semibold text-foreground">History unavailable</h2>
              <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
                Conversation history is temporarily unavailable. Start a new chat while we refresh the archive.
              </p>
            </CardContent>
          </Card>
        ) : chats.length === 0 ? (
          <Card className="overflow-hidden rounded-[28px] border-border/60 bg-card/95 shadow-[0_24px_60px_-48px_rgba(15,23,42,0.7)] animate-in fade-in duration-300">
            <CardContent className="py-16 text-center">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[20px] bg-primary/10">
                <MessageSquare className="h-8 w-8 text-primary" />
              </div>
              <h2 className="text-xl font-semibold text-foreground">No conversations yet</h2>
              <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
                Start talking with your AI advisor and your conversation archive will build itself here.
              </p>
              <Button onClick={() => navigate("/advisor?new=1")} className="mt-6 rounded-full px-6">
                Start a conversation
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {Object.entries(groupedChats).map(([dateLabel, dateChats], groupIndex) => (
              <section
                key={dateLabel}
                className="animate-in fade-in duration-300"
                style={{ animationDelay: `${groupIndex * 45}ms` }}
              >
                <div className="mb-2 flex items-center gap-2 px-1">
                  <div className="h-px flex-1 bg-border/70" />
                  <span className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                    {dateLabel}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {dateChats.length}
                  </span>
                </div>

                <div className="space-y-2">
                  {dateChats.map((chat, index) => (
                    <article
                      key={chat.id}
                      role="button"
                      tabIndex={0}
                      className={cn(
                        "group rounded-[18px] border border-border/60 bg-card/85 p-4 transition-all duration-200 hover:border-primary/20 hover:bg-card",
                        "animate-in fade-in slide-in-from-bottom-2",
                      )}
                      style={{ animationDelay: `${(groupIndex * 45) + (index * 30)}ms` }}
                      onClick={() => handleOpenChat(chat.id)}
                      onKeyDown={(event) => handleChatKeyDown(event, chat.id)}
                    >
                      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                        <div className="flex min-w-0 flex-1 items-start gap-3">
                          <div className="rounded-[16px] bg-primary/10 p-3 shrink-0">
                            <MessageSquare className="h-4 w-4 text-primary" />
                          </div>
 
                          <div className="min-w-0 flex-1">
                            {editingChatId === chat.id ? (
                              <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
                                <Input
                                  value={editTitle}
                                  onChange={(event) => setEditTitle(event.target.value)}
                                  className="h-9 bg-background"
                                  autoFocus
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") handleSaveTitle(chat.id);
                                    if (event.key === "Escape") handleCancelEdit();
                                  }}
                                />
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-9 w-9 shrink-0"
                                  onClick={() => handleSaveTitle(chat.id)}
                                >
                                  <Check className="h-4 w-4 text-emerald-600" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-9 w-9 shrink-0"
                                  onClick={handleCancelEdit}
                                >
                                  <X className="h-4 w-4 text-red-500" />
                                </Button>
                              </div>
                            ) : (
                              <>
                                <div className="flex flex-wrap items-center gap-2">
                                  <h3 className="max-w-full truncate text-base font-semibold text-foreground">
                                    {chat.title}
                                  </h3>
                                  <span className="rounded-full border border-border/70 bg-muted/50 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                                    {chat.messageCount} message{chat.messageCount !== 1 ? "s" : ""}
                                  </span>
                                </div>
                                <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
                                  {getPreviewText(chat)}
                                </p>
                                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                                  <span>{formatUpdatedAt(chat.updated_at)}</span>
                                </div>
                              </>
                            )}
                          </div>
                        </div>

                        {editingChatId !== chat.id && (
                          <div className="flex items-center gap-1 self-end md:self-center md:opacity-0 md:transition-opacity md:group-hover:opacity-100">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-9 w-9 text-muted-foreground hover:text-foreground"
                              onClick={(event) => handleStartEdit(chat, event)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>

                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-9 w-9 text-muted-foreground hover:text-destructive"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent className="max-w-sm">
                                <AlertDialogHeader>
                                  <AlertDialogTitle className="text-base">Delete conversation?</AlertDialogTitle>
                                  <AlertDialogDescription className="text-sm">
                                    "{chat.title}" and all {chat.messageCount} messages will be permanently deleted.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel className="h-9">Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteChat(chat.id);
                                    }}
                                    disabled={deleteChatMutation.isPending}
                                    className="h-9 bg-destructive hover:bg-destructive/90"
                                  >
                                    {deleteChatMutation.isPending ? 'Deleting...' : 'Delete'}
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>

                            <div className="ml-1 flex h-9 w-9 items-center justify-center rounded-full border border-border/70 bg-background/70 text-muted-foreground transition-colors group-hover:text-foreground">
                              <ChevronRight className="h-4 w-4" />
                            </div>
                          </div>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default ChatHistory;
