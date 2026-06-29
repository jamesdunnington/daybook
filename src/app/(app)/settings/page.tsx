'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Copy, Plus, Trash2, Key } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface Settings {
  timezone: string;
  currency: string;
  preferredModel: string;
  emailNotifications: boolean;
  openrouterApiKey: string | null;
  telegramChatId: string | null;
}

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
}

const MODELS = [
  'openai/gpt-4o-mini',
  'openai/gpt-4o',
  'anthropic/claude-3.5-haiku',
  'anthropic/claude-3.5-sonnet',
  'google/gemini-flash-1.5',
  'meta-llama/llama-3.1-8b-instruct',
];

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const [apiKeyName, setApiKeyName] = useState('');
  const [newToken, setNewToken] = useState<string | null>(null);
  const [telegramCode, setTelegramCode] = useState('');
  const [openrouterKey, setOpenrouterKey] = useState('');

  const { data: settings, isLoading } = useQuery<Settings>({
    queryKey: ['settings'],
    queryFn: () => fetch('/api/settings').then((r) => r.json()),
  });

  const { data: apiKeys = [] } = useQuery<ApiKey[]>({
    queryKey: ['apiKeys'],
    queryFn: () => fetch('/api/keys').then((r) => r.json()),
  });

  const updateSettings = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Settings saved');
    },
    onError: () => toast.error('Failed to save settings'),
  });

  const createApiKey = useMutation({
    mutationFn: (name: string) =>
      fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      }).then((r) => r.json()),
    onSuccess: (data) => {
      setNewToken(data.token);
      queryClient.invalidateQueries({ queryKey: ['apiKeys'] });
    },
    onError: () => toast.error('Failed to create API key'),
  });

  const deleteApiKey = useMutation({
    mutationFn: (id: string) => fetch(`/api/keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apiKeys'] });
      toast.success('API key revoked');
    },
  });

  const linkTelegram = useMutation({
    mutationFn: (telegramLinkCode: string) =>
      fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramLinkCode }),
      }).then((r) => r.json()),
    onSuccess: (data) => {
      if (data.error) { toast.error(data.error); return; }
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      toast.success('Telegram account linked!');
      setTelegramCode('');
    },
  });

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* General */}
      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Timezone</Label>
              <Input
                defaultValue={settings?.timezone ?? 'UTC'}
                onBlur={(e) => updateSettings.mutate({ timezone: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Currency</Label>
              <Input
                defaultValue={settings?.currency ?? 'USD'}
                onBlur={(e) => updateSettings.mutate({ currency: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>AI Model</Label>
            <Select
              defaultValue={settings?.preferredModel ?? 'openai/gpt-4o-mini'}
              onValueChange={(v) => updateSettings.mutate({ preferredModel: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODELS.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Email Notifications</Label>
              <p className="text-sm text-muted-foreground">Receive daily digests and reminders</p>
            </div>
            <Switch
              checked={settings?.emailNotifications ?? true}
              onCheckedChange={(v) => updateSettings.mutate({ emailNotifications: v })}
            />
          </div>
        </CardContent>
      </Card>

      {/* OpenRouter API Key */}
      <Card>
        <CardHeader>
          <CardTitle>OpenRouter API Key</CardTitle>
          <CardDescription>Your personal key overrides the global key set by admin.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Current: {settings?.openrouterApiKey ?? 'Using global/env key'}
          </p>
          <div className="flex gap-2">
            <Input
              type="password"
              placeholder="sk-or-v1-..."
              value={openrouterKey}
              onChange={(e) => setOpenrouterKey(e.target.value)}
            />
            <Button
              onClick={() => {
                updateSettings.mutate({ openrouterApiKey: openrouterKey });
                setOpenrouterKey('');
              }}
            >
              Save
            </Button>
            <Button variant="outline" onClick={() => updateSettings.mutate({ openrouterApiKey: '' })}>
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Telegram */}
      <Card>
        <CardHeader>
          <CardTitle>Telegram Bot</CardTitle>
          <CardDescription>Link your Telegram account to receive notifications.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {settings?.telegramChatId ? (
            <p className="text-sm text-green-600">✓ Telegram account linked</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                1. Start a chat with the Daybook bot on Telegram and send /start<br />
                2. Enter the code you receive below
              </p>
              <div className="flex gap-2">
                <Input
                  placeholder="Enter link code (e.g. A1B2C3D4)"
                  value={telegramCode}
                  onChange={(e) => setTelegramCode(e.target.value.toUpperCase())}
                  maxLength={8}
                />
                <Button onClick={() => linkTelegram.mutate(telegramCode)} disabled={!telegramCode}>
                  Link
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* API Keys */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>API Keys</span>
            <Dialog>
              <DialogTrigger render={<Button size="sm" />}>
                <Plus className="mr-1 h-4 w-4" /> New Key
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Create API Key</DialogTitle></DialogHeader>
                {newToken ? (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Copy this key now — it will not be shown again.
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 rounded bg-muted p-2 text-xs break-all">{newToken}</code>
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => { navigator.clipboard.writeText(newToken); toast.success('Copied!'); }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                    <Button className="w-full" onClick={() => setNewToken(null)}>Done</Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <Label>Key Name</Label>
                      <Input
                        placeholder="e.g. Claude Desktop MCP"
                        value={apiKeyName}
                        onChange={(e) => setApiKeyName(e.target.value)}
                      />
                    </div>
                    <Button
                      className="w-full"
                      onClick={() => { createApiKey.mutate(apiKeyName); setApiKeyName(''); }}
                      disabled={!apiKeyName || createApiKey.isPending}
                    >
                      Create Key
                    </Button>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </CardTitle>
          <CardDescription>Use API keys to connect external tools like Claude Desktop MCP.</CardDescription>
        </CardHeader>
        <CardContent>
          {apiKeys.length === 0 ? (
            <p className="text-sm text-muted-foreground">No API keys yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Prefix</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {apiKeys.map((k) => (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium">{k.name}</TableCell>
                    <TableCell><code className="text-xs bg-muted px-1 rounded">dk_{k.keyPrefix}…</code></TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {k.lastUsedAt ? format(new Date(k.lastUsedAt), 'MMM d') : 'Never'}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => deleteApiKey.mutate(k.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
