import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useChats, useDeleteChat, useUpdateChatTitle } from "@/hooks/use-data";
import { format, parseISO, isToday, isYesterday, isThisWeek } from "date-fns";
import { MessageSquare, Trash2, ArrowRight, Calendar, Pencil, Check, X } from "lucide-react";
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

const ChatHistory = () => {
  const navigate = useNavigate();
  const { data: chats = [], isLoading } = useChats();
  const deleteChatMutation = useDeleteChat();
  const updateTitleMutation = useUpdateChatTitle();
  
  const [expandedChatId, setExpandedChatId] = useState<string | null>(null);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const handleDeleteChat = async (chatId: string) => {
    try {
      await deleteChatMutation.mutateAsync(chatId);
      if (expandedChatId === chatId) {
        setExpandedChatId(null);
      }
    } catch (error) {
      console.error('Error deleting chat:', error);
    }
  };

  const handleStartEdit = (chat: ChatWithMessages) => {
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
    // Navigate to advisor with the chat ID
    navigate(`/advisor?chat=${chatId}`);
  };

  const getDateLabel = (dateStr: string): string => {
    const date = parseISO(dateStr);
    if (isToday(date)) return 'Today';
    if (isYesterday(date)) return 'Yesterday';
    if (isThisWeek(date)) return format(date, 'EEEE');
    return format(date, 'MMM d, yyyy');
  };

  if (isLoading) {
    return (
      <AppLayout title="Chat History">
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Loading chat history...</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Chat History">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Chat History</h1>
            <p className="text-muted-foreground">
              {chats.length} conversation{chats.length !== 1 ? 's' : ''}
            </p>
          </div>
          <Button onClick={() => navigate('/advisor')} className="gap-2">
            <MessageSquare className="h-4 w-4" />
            New Chat
          </Button>
        </div>

        {/* Empty state */}
        {chats.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <MessageSquare className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No chat history yet</h3>
              <p className="text-muted-foreground text-center mb-4">
                Start a conversation with your Financial Advisor to see your history here.
              </p>
              <Button onClick={() => navigate('/advisor')}>
                Start Chatting
              </Button>
            </CardContent>
          </Card>
        ) : (
          /* Chat list */
          <div className="space-y-3">
            {chats.map((chat) => (
              <Card 
                key={chat.id}
                className={`transition-all hover:shadow-md ${
                  expandedChatId === chat.id ? 'ring-2 ring-primary' : ''
                }`}
              >
                <CardContent className="p-4">
                  {/* Chat header */}
                  <div className="flex items-start justify-between gap-4">
                    <div 
                      className="flex-1 cursor-pointer"
                      onClick={() => setExpandedChatId(expandedChatId === chat.id ? null : chat.id)}
                    >
                      {editingChatId === chat.id ? (
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <Input
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            className="h-8 text-sm"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveTitle(chat.id);
                              if (e.key === 'Escape') handleCancelEdit();
                            }}
                          />
                          <Button 
                            size="icon" 
                            variant="ghost" 
                            className="h-8 w-8"
                            onClick={() => handleSaveTitle(chat.id)}
                          >
                            <Check className="h-4 w-4 text-green-600" />
                          </Button>
                          <Button 
                            size="icon" 
                            variant="ghost" 
                            className="h-8 w-8"
                            onClick={handleCancelEdit}
                          >
                            <X className="h-4 w-4 text-red-600" />
                          </Button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold">{chat.title}</h3>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6 opacity-0 group-hover:opacity-100"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleStartEdit(chat);
                              }}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                          </div>
                          <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {getDateLabel(chat.updated_at)}
                            </span>
                            <span>{chat.messageCount} messages</span>
                          </div>
                          {chat.lastMessage && (
                            <p className="text-sm text-muted-foreground mt-2 line-clamp-2">
                              {chat.lastMessage.role === 'user' ? 'You: ' : 'AI: '}
                              {chat.lastMessage.content.substring(0, 100)}
                              {chat.lastMessage.content.length > 100 ? '...' : ''}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                    
                    {/* Actions */}
                    {editingChatId !== chat.id && (
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartEdit(chat);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete chat?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete "{chat.title}" and all {chat.messageCount} messages. This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDeleteChat(chat.id)}>
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    )}
                  </div>
                  
                  {/* Expanded view */}
                  {expandedChatId === chat.id && (
                    <div className="mt-4 border-t pt-4">
                      <ScrollArea className="h-64">
                        <div className="space-y-3 pr-4">
                          {chat.messages.map((msg) => (
                            <div
                              key={msg.id}
                              className={`flex gap-3 ${
                                msg.role === 'user' ? 'flex-row-reverse' : ''
                              }`}
                            >
                              <div
                                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                                  msg.role === 'user'
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-muted'
                                }`}
                              >
                                <p className="line-clamp-4">{msg.content}</p>
                                <p className="text-xs opacity-70 mt-1">
                                  {format(parseISO(msg.created_at), 'h:mm a')}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                      <div className="mt-4 flex justify-end">
                        <Button 
                          size="sm" 
                          onClick={() => handleOpenChat(chat.id)}
                          className="gap-2"
                        >
                          Continue this chat
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
};

export default ChatHistory;
