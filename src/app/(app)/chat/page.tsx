'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Send, Paperclip, Plus, Trash2, MessageSquare, Bot, User, ChevronLeft, X, RotateCcw, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ModelPicker } from '@/components/chat/model-picker';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Conversation {
  id: string;
  title: string;
  model: string;
  updatedAt: string;
}

interface MessageAttachment {
  filename: string;
  type: 'csv' | 'xlsx' | 'image';
  url?: string;
}

interface ToolCallEntry {
  name: string;
  summary: string;
  undoId?: string;
  undoExpiresAt?: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
  attachments?: MessageAttachment[];
  toolCalls?: ToolCallEntry[];
}

interface PendingImage {
  uploadId: string;
  filename: string;
  storedFilename: string;
  mimeType: string;
  url: string;
}

interface ConversationDetail {
  id: string;
  title: string;
  model: string;
  messages: Message[];
}

interface ImportPreviewData {
  importBatchId: string;
  totalRows: number;
  previewRows: Array<{
    date?: string;
    type?: string;
    amount?: number | string;
    description?: string;
    [key: string]: unknown;
  }>;
  transactions: unknown[];
  warnings: string[];
  fileName: string;
}

// ─── API helpers ───────────────────────────────────────────────────────────────

async function fetchConversations(): Promise<Conversation[]> {
  const res = await fetch('/api/chat');
  if (!res.ok) throw new Error('Failed to fetch conversations');
  return res.json();
}

async function createConversation(title: string): Promise<Conversation> {
  // No model is sent here on purpose — the server defaults new conversations to the
  // user's actual preferred model from Settings (see /api/chat POST).
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error('Failed to create conversation');
  return res.json();
}

async function deleteConversation(id: string): Promise<void> {
  const res = await fetch(`/api/chat/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete conversation');
}

async function fetchConversationDetail(id: string): Promise<ConversationDetail> {
  const res = await fetch(`/api/chat/${id}`);
  if (!res.ok) throw new Error('Failed to fetch conversation');
  return res.json();
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

interface SidebarProps {
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

function Sidebar({ conversations, selectedId, onSelect, onNew, onDelete }: SidebarProps) {
  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-r bg-muted/30">
      <div className="flex items-center justify-between border-b px-3 py-3">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <MessageSquare className="size-4" />
          Chats
        </span>
        <Button size="icon-sm" variant="ghost" onClick={onNew} title="New chat">
          <Plus />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {conversations.length === 0 && (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">No conversations yet</p>
        )}
        {conversations.map((conv) => (
          <ConversationItem
            key={conv.id}
            conv={conv}
            isSelected={conv.id === selectedId}
            onSelect={() => onSelect(conv.id)}
            onDelete={() => onDelete(conv.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ConversationItem({
  conv,
  isSelected,
  onSelect,
  onDelete,
}: {
  conv: Conversation;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className={`group relative flex cursor-pointer items-center gap-2 rounded-md mx-1 px-2 py-2 text-sm transition-colors ${
        isSelected
          ? 'bg-primary/10 text-primary font-medium'
          : 'hover:bg-muted text-foreground/80'
      }`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onSelect}
    >
      <MessageSquare className="size-3.5 shrink-0 opacity-60" />
      <span className="flex-1 truncate text-xs">{conv.title}</span>
      {(hovered || isSelected) && (
        <button
          className="shrink-0 rounded p-0.5 opacity-60 hover:bg-destructive/10 hover:text-destructive hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete conversation"
        >
          <Trash2 className="size-3" />
        </button>
      )}
    </div>
  );
}

// ─── Message bubble ────────────────────────────────────────────────────────────

function ToolCallLog({ calls, onUndo }: { calls: ToolCallEntry[]; onUndo: (id: string) => void }) {
  const [undone, setUndone] = useState<Set<string>>(new Set());

  return (
    <ul className="mt-2 space-y-1 border-t border-border/50 pt-2">
      {calls.map((call, i) => {
        const canUndo = call.undoId && !undone.has(call.undoId) && call.undoExpiresAt && new Date(call.undoExpiresAt) > new Date();
        return (
          <li key={i} className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="truncate">✓ {call.summary}</span>
            {canUndo && (
              <button
                type="button"
                className="shrink-0 flex items-center gap-1 rounded px-1.5 py-0.5 text-primary hover:bg-primary/10"
                onClick={() => {
                  onUndo(call.undoId!);
                  setUndone((prev) => new Set(prev).add(call.undoId!));
                }}
              >
                <RotateCcw className="size-3" />
                Undo
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function MessageBubble({ message, onUndo }: { message: Message; onUndo: (id: string) => void }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div
        className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs ${
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground border border-border'
        }`}
      >
        {isUser ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
      </div>

      <div
        className={`max-w-[75%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
          isUser
            ? 'bg-primary text-primary-foreground rounded-tr-sm'
            : 'bg-muted text-foreground rounded-tl-sm border border-border/50'
        }`}
      >
        {message.attachments?.some((a) => a.type === 'image') && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {message.attachments
              .filter((a) => a.type === 'image' && a.url)
              .map((a, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={a.url} alt={a.filename} className="h-24 w-24 rounded-lg border border-border/50 object-cover" />
              ))}
          </div>
        )}
        {message.content && <p className="whitespace-pre-wrap break-words">{message.content}</p>}
        {!isUser && message.toolCalls?.length ? <ToolCallLog calls={message.toolCalls} onUndo={onUndo} /> : null}
      </div>
    </div>
  );
}

// ─── Streaming dot indicator ───────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex gap-2.5">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground">
        <Bot className="size-3.5" />
      </div>
      <div className="flex items-center gap-1 rounded-xl rounded-tl-sm border border-border/50 bg-muted px-3 py-2.5">
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
        <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
      </div>
    </div>
  );
}

// ─── Import preview dialog ──────────────────────────────────────────────────────

function ImportPreviewDialog({
  data,
  onConfirm,
  onCancel,
  isConfirming,
}: {
  data: ImportPreviewData;
  onConfirm: () => void;
  onCancel: () => void;
  isConfirming: boolean;
}) {
  const previewCols = ['date', 'type', 'amount', 'description'];

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import Transactions</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">{data.fileName}</span>
            <Badge variant="secondary">{data.totalRows} rows</Badge>
          </div>

          {data.warnings.length > 0 && (
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-800 dark:border-yellow-900/50 dark:bg-yellow-950/30 dark:text-yellow-300">
              <p className="mb-1 font-medium">Warnings</p>
              <ul className="list-inside list-disc space-y-0.5">
                {data.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="overflow-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  {previewCols.map((col) => (
                    <th key={col} className="px-3 py-2 text-left font-medium capitalize text-muted-foreground">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.previewRows.map((row, i) => (
                  <tr key={i} className="border-t">
                    {previewCols.map((col) => (
                      <td key={col} className="px-3 py-1.5 text-foreground/80">
                        {row[col] != null ? String(row[col]) : '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-muted-foreground">
            Showing {data.previewRows.length} of {data.totalRows} rows. All {data.totalRows} transactions will be imported.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isConfirming}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={isConfirming}>
            {isConfirming ? 'Importing…' : `Import ${data.totalRows} transactions`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function ChatPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreviewData | null>(null);
  const [convDetail, setConvDetail] = useState<ConversationDetail | null>(null);
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);

  // Conversation list
  const { data: conversations = [] } = useQuery<Conversation[]>({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
  });

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  // Load conversation detail when selection changes
  useEffect(() => {
    if (!selectedConvId) {
      setMessages([]);
      setConvDetail(null);
      return;
    }
    fetchConversationDetail(selectedConvId)
      .then((detail) => {
        setConvDetail(detail);
        setMessages(detail.messages);
      })
      .catch(() => toast.error('Failed to load conversation'));
  }, [selectedConvId]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleNewChat = useCallback(async () => {
    try {
      const conv = await createConversation('New conversation');
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      setSelectedConvId(conv.id);
    } catch {
      toast.error('Failed to create conversation');
    }
  }, [queryClient]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteConversation(id);
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      if (selectedConvId === id) {
        setSelectedConvId(null);
        setMessages([]);
        setConvDetail(null);
      }
    } catch {
      toast.error('Failed to delete conversation');
    }
  }, [queryClient, selectedConvId]);

  const handleSend = useCallback(async () => {
    const content = input.trim();
    if ((!content && !pendingImage) || isStreaming || !selectedConvId) return;

    setInput('');
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    const imageToSend = pendingImage;
    setPendingImage(null);

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content,
      attachments: imageToSend
        ? [{ filename: imageToSend.filename, type: 'image', url: imageToSend.url }]
        : undefined,
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsStreaming(true);

    try {
      const response = await fetch(`/api/chat/${selectedConvId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, images: imageToSend ? [imageToSend] : undefined }),
      });

      if (!response.ok) {
        throw new Error(`Request failed: ${response.statusText}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let assistantMsg = '';
      let toolCalls: ToolCallEntry[] | undefined;

      setMessages((prev) => [...prev, { id: 'streaming', role: 'assistant', content: '' }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.daybook_meta) {
              toolCalls = data.daybook_meta.toolCalls;
              continue;
            }
            const delta = data.choices?.[0]?.delta?.content ?? '';
            if (delta) {
              assistantMsg += delta;
              setMessages((prev) =>
                prev.map((m) => (m.id === 'streaming' ? { ...m, content: assistantMsg } : m))
              );
            }
          } catch {
            // ignore malformed SSE lines
          }
        }
      }

      // Replace streaming placeholder with final id (+ any tool call log)
      setMessages((prev) =>
        prev.map((m) => (m.id === 'streaming' ? { ...m, id: Date.now().toString(), toolCalls } : m))
      );

      // Refetch to get persisted messages
      const detail = await fetchConversationDetail(selectedConvId);
      setConvDetail(detail);
      setMessages(detail.messages);
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send message');
      // Remove the streaming placeholder if error occurred
      setMessages((prev) => prev.filter((m) => m.id !== 'streaming'));
    } finally {
      setIsStreaming(false);
    }
  }, [input, pendingImage, isStreaming, selectedConvId, queryClient]);

  const handleUndo = useCallback(
    async (undoId: string) => {
      try {
        const res = await fetch(`/api/chat/undo/${undoId}`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Undo failed');
        toast.success(data.summary ?? 'Undone');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Undo failed');
      }
    },
    []
  );

  const handleModelChange = useCallback(
    async (model: string) => {
      if (!selectedConvId) return;
      try {
        const res = await fetch(`/api/chat/${selectedConvId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model }),
        });
        if (!res.ok) throw new Error('Failed to switch model');
        const updated = await res.json();
        setConvDetail((prev) => (prev ? { ...prev, model: updated.model } : prev));
        queryClient.invalidateQueries({ queryKey: ['conversations'] });
      } catch {
        toast.error('Failed to switch model');
      }
    },
    [selectedConvId, queryClient]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    // Auto-resize
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  };

  const handleFileButtonClick = () => {
    if (!selectedConvId) {
      toast.error('Select or create a conversation first');
      return;
    }
    fileInputRef.current?.click();
  };

  const uploadFile = useCallback(
    async (file: File) => {
      if (!selectedConvId) {
        toast.error('Select or create a conversation first');
        return;
      }

      const formData = new FormData();
      formData.append('file', file);

      setIsUploading(true);
      try {
        const res = await fetch(`/api/chat/${selectedConvId}/upload`, {
          method: 'POST',
          body: formData,
        });
        if (!res.ok) throw new Error('Upload failed');
        const data = await res.json();
        if (data.kind === 'image') {
          setPendingImage(data as PendingImage);
        } else {
          setImportPreview({ ...data, fileName: file.name });
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setIsUploading(false);
      }
    },
    [selectedConvId]
  );

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      // Reset input so same file can be re-uploaded
      e.target.value = '';
      await uploadFile(file);
    },
    [uploadFile]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const imageItem = Array.from(e.clipboardData.items).find((item) => item.type.startsWith('image/'));
      if (!imageItem) return; // let normal text paste through
      e.preventDefault();
      const file = imageItem.getAsFile();
      if (!file) return;
      // Screenshot tools hand the clipboard a blob named "image.png" — give it a real name.
      const ext = imageItem.type.split('/')[1] || 'png';
      const named = new File([file], file.name && file.name !== 'image.png' ? file.name : `pasted-screenshot.${ext}`, {
        type: imageItem.type,
      });
      uploadFile(named);
    },
    [uploadFile]
  );

  const handleConfirmImport = useCallback(async () => {
    if (!importPreview || !selectedConvId) return;
    setIsConfirming(true);
    try {
      const res = await fetch(`/api/chat/${selectedConvId}/confirm-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          importBatchId: importPreview.importBatchId,
          transactions: importPreview.transactions,
        }),
      });
      if (!res.ok) throw new Error('Import failed');
      const result = await res.json();
      setImportPreview(null);

      // Post summary message in chat
      const summary =
        result.summary ||
        `Successfully imported ${result.imported ?? importPreview.totalRows} transactions from ${importPreview.fileName}.`;

      const userMsg: Message = {
        id: Date.now().toString(),
        role: 'user',
        content: `[Imported file: ${importPreview.fileName}]`,
      };
      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: summary,
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      toast.success(`Imported ${result.imported ?? importPreview.totalRows} transactions`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setIsConfirming(false);
    }
  }, [importPreview, selectedConvId, queryClient]);

  // ── Render ────────────────────────────────────────────────────────────────

  const canSend = (input.trim().length > 0 || !!pendingImage) && !isStreaming && !!selectedConvId;
  const showEmptyState = conversations.length === 0;

  return (
    <div className="flex h-[calc(100vh-4rem)] md:h-full overflow-hidden">
      {/* Sidebar — desktop only */}
      <div className="hidden md:flex">
        <Sidebar
          conversations={conversations}
          selectedId={selectedConvId}
          onSelect={(id) => {
            if (id !== selectedConvId) {
              setMessages([]);
              setSelectedConvId(id);
            }
          }}
          onNew={handleNewChat}
          onDelete={handleDelete}
        />
      </div>

      {/* Mobile conversation list — shown when no conversation is selected */}
      <div className={`flex flex-1 flex-col overflow-hidden md:hidden ${selectedConvId ? 'hidden' : ''}`}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <MessageSquare className="size-4" />
            Chats
          </span>
          <Button size="icon-sm" variant="ghost" onClick={handleNewChat} title="New chat">
            <Plus />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 px-4 py-16 text-center">
              <div className="flex size-16 items-center justify-center rounded-full bg-muted">
                <MessageSquare className="size-8 text-muted-foreground" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Start a new chat</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Ask anything about your finances or upload a CSV to import transactions.
                </p>
              </div>
              <Button onClick={handleNewChat}>
                <Plus />
                New Chat
              </Button>
            </div>
          ) : (
            conversations.map((conv) => (
              <ConversationItem
                key={conv.id}
                conv={conv}
                isSelected={conv.id === selectedConvId}
                onSelect={() => {
                  setMessages([]);
                  setSelectedConvId(conv.id);
                }}
                onDelete={() => handleDelete(conv.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Main area — on mobile only shown when a conversation is active */}
      <div className={`flex flex-1 flex-col overflow-hidden ${!selectedConvId ? 'hidden md:flex' : ''}`}>
        {showEmptyState && !selectedConvId ? (
          // Empty state — no conversations at all
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <div className="flex size-16 items-center justify-center rounded-full bg-muted">
              <MessageSquare className="size-8 text-muted-foreground" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Start a new chat</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Ask anything about your finances or upload a CSV to import transactions.
              </p>
            </div>
            <Button onClick={handleNewChat}>
              <Plus />
              New Chat
            </Button>
          </div>
        ) : !selectedConvId ? (
          // Has conversations but none selected
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <MessageSquare className="size-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Select a conversation or start a new one</p>
            <Button variant="outline" size="sm" onClick={handleNewChat}>
              <Plus />
              New Chat
            </Button>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="flex items-center gap-3 border-b bg-background px-4 py-3">
              <Button
                className="md:hidden -ml-1 mr-0 shrink-0"
                size="icon-sm"
                variant="ghost"
                onClick={() => setSelectedConvId(null)}
              >
                <ChevronLeft />
              </Button>
              <Bot className="size-4 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <h1 className="truncate text-sm font-medium">
                  {convDetail?.title ?? 'Loading…'}
                </h1>
              </div>
              {convDetail?.model && (
                <ModelPicker value={convDetail.model} onChange={handleModelChange} className="h-7 text-xs" />
              )}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4">
              <div className="mx-auto max-w-3xl space-y-4">
                {messages.length === 0 && !isStreaming && (
                  <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                    <Bot className="size-10 text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">
                      Send a message to start the conversation
                    </p>
                  </div>
                )}

                {messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} onUndo={handleUndo} />
                ))}

                {isStreaming && messages[messages.length - 1]?.id !== 'streaming' && (
                  <TypingIndicator />
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Input area */}
            <div className="border-t bg-background px-4 py-3">
              <div className="mx-auto max-w-3xl">
                {pendingImage && (
                  <div className="mb-2 flex items-center gap-2 rounded-lg border border-border/50 bg-muted/50 px-2.5 py-1.5 text-xs">
                    <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">{pendingImage.filename}</span>
                    <button
                      type="button"
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={() => setPendingImage(null)}
                      title="Remove attachment"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                )}
                <div className="flex items-end gap-2 rounded-xl border bg-background px-3 py-2 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
                  {/* File upload */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xlsx,.jpg,.jpeg,.png,.webp,.heic,.heif"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  <button
                    type="button"
                    className="mb-0.5 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                    onClick={handleFileButtonClick}
                    disabled={isUploading || isStreaming}
                    title="Upload CSV, XLSX, or a photo (e.g. a bank statement)"
                  >
                    {isUploading ? (
                      <span className="flex size-4 items-center justify-center">
                        <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      </span>
                    ) : (
                      <Paperclip className="size-4" />
                    )}
                  </button>

                  {/* Text input */}
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={handleTextareaChange}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    placeholder="Message… (Enter to send, Shift+Enter for new line, paste a screenshot)"
                    rows={1}
                    disabled={isStreaming}
                    className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
                    style={{ maxHeight: '160px', overflowY: 'auto' }}
                  />

                  {/* Send button */}
                  <button
                    type="button"
                    className="mb-0.5 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed data-[active=true]:text-primary"
                    onClick={handleSend}
                    disabled={!canSend}
                    data-active={canSend}
                    title="Send message"
                  >
                    <Send className="size-4" />
                  </button>
                </div>
                <p className="mt-1.5 text-center text-[10px] text-muted-foreground/60">
                  AI can make mistakes. Review important information.
                </p>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Import preview dialog */}
      {importPreview && (
        <ImportPreviewDialog
          data={importPreview}
          onConfirm={handleConfirmImport}
          onCancel={() => setImportPreview(null)}
          isConfirming={isConfirming}
        />
      )}
    </div>
  );
}
