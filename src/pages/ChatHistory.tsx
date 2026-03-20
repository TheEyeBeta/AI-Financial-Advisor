import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useChats, useDeleteChat, useUpdateChatTitle } from "@/hooks/use-data";
import { format, parseISO, isToday, isYesterday, isThisWeek } from "date-fns";
import { MessageSquare, Trash2, Pencil, Check, X, Plus, ChevronRight, Clock } from "lucide-react";
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
import type { ChatWithMessages } from "@/types/database";
import { cn } from "@/lib/utils";

const ChatHistory = () => {
  const navigate = useNavigate();
  const { data: chats = [], isLoading } = useChats();
  const deleteChatMutation = useDeleteChat();
  const updateTitleMutation = useUpdateChatTitle();
  
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const handleDeleteChat = async (chatId: string) => {
    try {
      await deleteChatMutation.mutateAsync(chatId);
    } catch (error) {
      console.error('Error deleting chat:', error);
    }
  };

  const handleStartEdit = (chat: ChatWithMessages, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingChatId(chat.id);
    setEditTitle(chat.title);
  };

  const handleSaveTitle = async (chatId: string) => {
    if (!editTitle.trim()) return;
    
    try {
      await updateTitleMutation.mutateAsync({ chatId, title: editTitle.trim() });
      setEditingChatId(null);
    } catch (error) {
      console.error('Error updating title:', error);
    }
  };

  const handleCancelEdit = () => {
    setEditingChatId(null);
    setEditTitle("");
  };

  const handleOpenChat = (chatId: string) => {
    navigate(`/advisor?chat=${chatId}`);
  };

  const getDateLabel = (dateStr: string): string => {
    const date = parseISO(dateStr);
    if (isToday(date)) return 'Today';
    if (isYesterday(date)) return 'Yesterday';
    if (isThisWeek(date)) return format(date, 'EEEE');
    return format(date, 'MMM d');
  };

  // Group chats by date
  const groupedChats = chats.reduce((groups, chat) => {
    const label = getDateLabel(chat.updated_at);
    if (!groups[label]) groups[label] = [];
    groups[label].push(chat);
    return groups;
  }, {} as Record<string, ChatWithMessages[]>);

  if (isLoading) {
    return (
      <AppLayout title="Chat History">
        <div className="flex items-center justify-center h-64">
          <div className="flex items-center gap-2 text-muted-foreground">
            <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">Loading...</span>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Chat History">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 animate-in fade-in duration-300">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Chats</h1>
            <p className="text-sm text-muted-foreground/70">
              {chats.length} conversation{chats.length !== 1 ? 's' : ''}
            </p>
          </div>
          <Button 
            onClick={() => navigate('/advisor?new=1')} 
            size="sm" 
            className="gap-1.5 rounded-full px-4"
          >
            <Plus className="h-4 w-4" />
            New
          </Button>
        </div>

        {/* Empty state */}
        {chats.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 animate-in fade-in duration-300">
            <div className="p-4 rounded-2xl bg-muted/50 mb-4">
              <MessageSquare className="h-10 w-10 text-muted-foreground/50" />
            </div>
            <h3 className="text-lg font-medium mb-1">No conversations yet</h3>
            <p className="text-sm text-muted-foreground/70 text-center mb-6 max-w-xs">
              Start chatting with your AI advisor to see your history here
            </p>
            <Button onClick={() => navigate('/advisor?new=1')} className="rounded-full px-6">
              Start a conversation
            </Button>
          </div>
        ) : (
          /* Chat list grouped by date */
          <div className="space-y-6">
            {Object.entries(groupedChats).map(([dateLabel, dateChats], groupIndex) => (
              <div 
                key={dateLabel} 
                className="animate-in fade-in duration-300"
                style={{ animationDelay: `${groupIndex * 50}ms` }}
              >
                {/* Date label */}
                <div className="flex items-center gap-2 mb-2 px-1">
                  <Clock className="h-3 w-3 text-muted-foreground/50" />
                  <span className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wide">
                    {dateLabel}
                  </span>
                </div>
                
                {/* Chats for this date */}
                <div className="space-y-1">
                  {dateChats.map((chat, index) => (
                    <div
                      key={chat.id}
                      className={cn(
                        "group relative flex items-center gap-3 px-3 py-2.5 rounded-xl",
                        "hover:bg-muted/50 cursor-pointer transition-all duration-150",
                        "animate-in fade-in slide-in-from-left-2"
                      )}
                      style={{ animationDelay: `${(groupIndex * 50) + (index * 30)}ms` }}
                      onClick={() => handleOpenChat(chat.id)}
                    >
                      {/* Chat icon */}
                      <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                        <MessageSquare className="h-4 w-4 text-primary" />
                      </div>
                      
                      {/* Chat content */}
                      <div className="flex-1 min-w-0">
                        {editingChatId === chat.id ? (
                          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                            <Input
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              className="h-7 text-sm bg-background"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveTitle(chat.id);
                                if (e.key === 'Escape') handleCancelEdit();
                              }}
                            />
                            <Button 
                              size="icon" 
                              variant="ghost" 
                              className="h-7 w-7 shrink-0"
                              onClick={() => handleSaveTitle(chat.id)}
                            >
                              <Check className="h-3.5 w-3.5 text-green-600" />
                            </Button>
                            <Button 
                              size="icon" 
                              variant="ghost" 
                              className="h-7 w-7 shrink-0"
                              onClick={handleCancelEdit}
                            >
                              <X className="h-3.5 w-3.5 text-red-500" />
                            </Button>
                          </div>
                        ) : (
                          <>
                            <h3 className="font-medium text-sm truncate pr-2">
                              {chat.title}
                            </h3>
                            {chat.lastMessage && (
                              <p className="text-xs text-muted-foreground/60 truncate mt-0.5">
                                {chat.lastMessage.content.substring(0, 60)}
                                {chat.lastMessage.content.length > 60 ? '...' : ''}
                              </p>
                            )}
                          </>
                        )}
                      </div>
                      
                      {/* Message count */}
                      {editingChatId !== chat.id && (
                        <span className="text-[10px] text-muted-foreground/50 shrink-0">
                          {chat.messageCount}
                        </span>
                      )}
                      
                      {/* Actions - visible on hover */}
                      {editingChatId !== chat.id && (
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            onClick={(e) => handleStartEdit(chat, e)}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Trash2 className="h-3 w-3" />
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
                                  onClick={() => handleDeleteChat(chat.id)}
                                  className="h-9 bg-destructive hover:bg-destructive/90"
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                          <ChevronRight className="h-4 w-4 text-muted-foreground/30 ml-1" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default ChatHistory;
