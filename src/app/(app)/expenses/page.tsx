'use client';

import React, { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
} from 'recharts';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PlusIcon, Trash2Icon, DownloadIcon, TrendingUpIcon, TrendingDownIcon, BarChart2Icon, TagIcon, PencilIcon } from 'lucide-react';
import { toast } from 'sonner';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExpenseCategory {
  id: string;
  name: string;
  type: string;
  color: string | null;
  icon: string | null;
}

interface ExpenseTransaction {
  id: string;
  type: string;
  amount: string;
  description: string;
  date: string;
  merchant: string | null;
  notes: string | null;
  categoryId: string | null;
  importedFrom: string | null;
  createdAt: string;
}

interface TransactionsResponse {
  data: ExpenseTransaction[];
  total: number;
  page: number;
  limit: number;
}

interface MonthlyData {
  period: string;
  income: number;
  expense: number;
  net: number;
}

interface CategoryData {
  categoryId: string | null;
  categoryName: string;
  type: string;
  total: number;
}

interface ReportResponse {
  totalIncome: number;
  totalExpense: number;
  netPL: number;
  data: MonthlyData[] | CategoryData[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildParams(obj: Record<string, string | number | undefined | null>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  return p;
}

function formatCurrency(amount: number | string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    typeof amount === 'string' ? parseFloat(amount) : amount
  );
}

const PIE_COLORS = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#84cc16',
];

// ─── Add Transaction Dialog ───────────────────────────────────────────────────

interface AddTransactionDialogProps {
  categories: ExpenseCategory[];
  onSuccess: () => void;
}

function AddTransactionDialog({ categories, onSuccess }: AddTransactionDialogProps) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<'income' | 'expense'>('expense');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [categoryId, setCategoryId] = useState('');
  const [merchant, setMerchant] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  const filteredCategories = categories.filter((c) => c.type === type);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !description || !date) {
      toast.error('Amount, description, and date are required');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          amount,
          description,
          date,
          categoryId: categoryId || undefined,
          merchant: merchant || undefined,
          notes: notes || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'Failed to create transaction');
      }
      toast.success('Transaction added');
      setOpen(false);
      setAmount('');
      setDescription('');
      setDate(format(new Date(), 'yyyy-MM-dd'));
      setCategoryId('');
      setMerchant('');
      setNotes('');
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create transaction');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <PlusIcon />
        Add Transaction
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Transaction</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Type toggle */}
          <div className="flex gap-2">
            <Button
              type="button"
              variant={type === 'expense' ? 'default' : 'outline'}
              size="sm"
              className="flex-1"
              onClick={() => { setType('expense'); setCategoryId(''); }}
            >
              Expense
            </Button>
            <Button
              type="button"
              variant={type === 'income' ? 'default' : 'outline'}
              size="sm"
              className="flex-1"
              onClick={() => { setType('income'); setCategoryId(''); }}
            >
              Income
            </Button>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tx-amount">Amount</Label>
            <Input
              id="tx-amount"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tx-description">Description</Label>
            <Input
              id="tx-description"
              placeholder="Transaction description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tx-date">Date</Label>
            <Input
              id="tx-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tx-category">Category</Label>
            <Select value={categoryId} onValueChange={(v) => setCategoryId(v ?? '')}>
              <SelectTrigger id="tx-category" className="w-full">
                <SelectValue placeholder="Select category...">
                  {(v: string | null) => filteredCategories.find(c => c.id === v)?.name ?? null}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {filteredCategories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id} label={cat.name}>
                    <span
                      className="inline-block size-2.5 rounded-full mr-1.5"
                      style={{ backgroundColor: cat.color ?? '#10b981' }}
                    />
                    {cat.name}
                  </SelectItem>
                ))}
                {filteredCategories.length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">No categories yet</div>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tx-merchant">Merchant (optional)</Label>
            <Input
              id="tx-merchant"
              placeholder="Merchant name"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tx-notes">Notes (optional)</Label>
            <Textarea
              id="tx-notes"
              placeholder="Additional notes..."
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? 'Adding...' : 'Add Transaction'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit Transaction Dialog ──────────────────────────────────────────────────

interface EditTransactionDialogProps {
  transaction: ExpenseTransaction;
  categories: ExpenseCategory[];
  onSuccess: () => void;
}

function EditTransactionDialog({ transaction, categories, onSuccess }: EditTransactionDialogProps) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<'income' | 'expense'>(transaction.type as 'income' | 'expense');
  const [amount, setAmount] = useState(transaction.amount);
  const [description, setDescription] = useState(transaction.description);
  const [date, setDate] = useState(transaction.date.split('T')[0]);
  const [categoryId, setCategoryId] = useState(transaction.categoryId ?? '');
  const [merchant, setMerchant] = useState(transaction.merchant ?? '');
  const [notes, setNotes] = useState(transaction.notes ?? '');
  const [loading, setLoading] = useState(false);

  const handleOpenChange = (o: boolean) => {
    if (o) {
      setType(transaction.type as 'income' | 'expense');
      setAmount(transaction.amount);
      setDescription(transaction.description);
      setDate(transaction.date.split('T')[0]);
      setCategoryId(transaction.categoryId ?? '');
      setMerchant(transaction.merchant ?? '');
      setNotes(transaction.notes ?? '');
    }
    setOpen(o);
  };

  const filteredCategories = categories.filter((c) => c.type === type);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !description || !date) {
      toast.error('Amount, description, and date are required');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/expenses/${transaction.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          amount,
          description,
          date,
          categoryId: categoryId || null,
          merchant: merchant || null,
          notes: notes || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'Failed to update transaction');
      }
      toast.success('Transaction updated');
      setOpen(false);
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update transaction');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground" />}>
        <PencilIcon className="size-3.5" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Transaction</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex gap-2">
            <Button
              type="button"
              variant={type === 'expense' ? 'default' : 'outline'}
              size="sm"
              className="flex-1"
              onClick={() => { setType('expense'); setCategoryId(''); }}
            >
              Expense
            </Button>
            <Button
              type="button"
              variant={type === 'income' ? 'default' : 'outline'}
              size="sm"
              className="flex-1"
              onClick={() => { setType('income'); setCategoryId(''); }}
            >
              Income
            </Button>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-tx-amount">Amount</Label>
            <Input
              id="edit-tx-amount"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-tx-description">Description</Label>
            <Input
              id="edit-tx-description"
              placeholder="Transaction description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-tx-date">Date</Label>
            <Input
              id="edit-tx-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-tx-category">Category</Label>
            <Select value={categoryId} onValueChange={(v) => setCategoryId(v ?? '')}>
              <SelectTrigger id="edit-tx-category" className="w-full">
                <SelectValue placeholder="Select category...">
                  {(v: string | null) => filteredCategories.find(c => c.id === v)?.name ?? null}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {filteredCategories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id} label={cat.name}>
                    <span
                      className="inline-block size-2.5 rounded-full mr-1.5"
                      style={{ backgroundColor: cat.color ?? '#10b981' }}
                    />
                    {cat.name}
                  </SelectItem>
                ))}
                {filteredCategories.length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">No categories yet</div>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-tx-merchant">Merchant (optional)</Label>
            <Input
              id="edit-tx-merchant"
              placeholder="Merchant name"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-tx-notes">Notes (optional)</Label>
            <Textarea
              id="edit-tx-notes"
              placeholder="Additional notes..."
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Manage Expense Categories Dialog ────────────────────────────────────────

function ManageExpenseCategoriesDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<'expense' | 'income'>('expense');
  const [color, setColor] = useState('#6366f1');
  const [loading, setLoading] = useState(false);

  const { data: categories = [], refetch } = useQuery<ExpenseCategory[]>({
    queryKey: ['expense-categories'],
    queryFn: async () => {
      const res = await fetch('/api/expenses/categories');
      if (!res.ok) throw new Error('Failed to fetch categories');
      return res.json();
    },
  });

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/api/expenses/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), type, color }),
      });
      if (!res.ok) throw new Error('Failed to create category');
      setName('');
      setColor('#6366f1');
      toast.success('Category added');
      refetch();
      onSuccess();
    } catch {
      toast.error('Failed to add category');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/expenses/categories/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete category');
      toast.success('Category deleted');
      refetch();
      onSuccess();
    } catch {
      toast.error('Failed to delete category');
    }
  };

  const expenseCategories = categories.filter((c) => c.type === 'expense');
  const incomeCategories = categories.filter((c) => c.type === 'income');

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <TagIcon className="mr-2 h-4 w-4" />
        Categories
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage Categories</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <form onSubmit={handleAdd} className="flex gap-2">
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-9 w-9 rounded border cursor-pointer shrink-0"
            />
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Category name"
              className="flex-1"
            />
            <Select value={type} onValueChange={(v) => setType((v ?? 'expense') as 'expense' | 'income')}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="expense">Expense</SelectItem>
                <SelectItem value="income">Income</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" disabled={!name.trim() || loading}>Add</Button>
          </form>

          <div className="space-y-3 max-h-64 overflow-y-auto">
            {expenseCategories.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Expense</p>
                {expenseCategories.map((cat) => (
                  <div key={cat.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent">
                    <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: cat.color ?? '#6366f1' }} />
                    <span className="flex-1 text-sm">{cat.name}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => handleDelete(cat.id)}>
                      <Trash2Icon className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {incomeCategories.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Income</p>
                {incomeCategories.map((cat) => (
                  <div key={cat.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent">
                    <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: cat.color ?? '#10b981' }} />
                    <span className="flex-1 text-sm">{cat.name}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => handleDelete(cat.id)}>
                      <Trash2Icon className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {categories.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No categories yet</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Transactions Tab ─────────────────────────────────────────────────────────

interface TransactionsTabProps {
  categories: ExpenseCategory[];
}

function TransactionsTab({ categories }: TransactionsTabProps) {
  const qc = useQueryClient();
  const [filterType, setFilterType] = useState('');
  const [filterCategoryId, setFilterCategoryId] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [page, setPage] = useState(1);
  const limit = 50;

  const params = buildParams({
    type: filterType,
    categoryId: filterCategoryId,
    from: filterFrom,
    to: filterTo,
    page,
    limit,
  });

  const { data, isLoading, isError } = useQuery<TransactionsResponse>({
    queryKey: ['expenses', 'list', filterType, filterCategoryId, filterFrom, filterTo, page],
    queryFn: async () => {
      const res = await fetch(`/api/expenses?${params}`);
      if (!res.ok) throw new Error('Failed to load transactions');
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/expenses/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete transaction');
    },
    onSuccess: () => {
      toast.success('Transaction deleted');
      qc.invalidateQueries({ queryKey: ['expenses'] });
    },
    onError: () => toast.error('Failed to delete transaction'),
  });

  const handleExport = async () => {
    try {
      const exportParams = buildParams({
        type: filterType,
        categoryId: filterCategoryId,
        from: filterFrom,
        to: filterTo,
      });
      const response = await fetch(`/api/expenses/export?${exportParams}`);
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'expenses.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to export CSV');
    }
  };

  const categoryMap = new Map(categories.map((c) => [c.id, c]));

  const totalPages = data ? Math.ceil(data.total / limit) : 1;

  return (
    <div className="flex flex-col gap-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={filterType} onValueChange={(v) => { setFilterType((v ?? '') === 'all' ? '' : (v ?? '')); setPage(1); }}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="income">Income</SelectItem>
            <SelectItem value="expense">Expense</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterCategoryId} onValueChange={(v) => { setFilterCategoryId((v ?? '') === 'all' ? '' : (v ?? '')); setPage(1); }}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All categories">
              {(v: string | null) => !v ? 'All categories' : categories.find(c => c.id === v)?.name ?? 'All categories'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat.id} value={cat.id} label={cat.name}>
                {cat.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">From</Label>
          <Input
            type="date"
            className="h-8 w-36 text-sm"
            value={filterFrom}
            onChange={(e) => { setFilterFrom(e.target.value); setPage(1); }}
          />
        </div>

        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">To</Label>
          <Input
            type="date"
            className="h-8 w-36 text-sm"
            value={filterTo}
            onChange={(e) => { setFilterTo(e.target.value); setPage(1); }}
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}>
            <DownloadIcon />
            Export CSV
          </Button>
          <AddTransactionDialog
            categories={categories}
            onSuccess={() => qc.invalidateQueries({ queryKey: ['expenses'] })}
          />
        </div>
      </div>

      {/* Transaction list */}
      {isLoading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
          Loading transactions...
        </div>
      )}
      {isError && (
        <div className="flex items-center justify-center py-12 text-destructive text-sm">
          Failed to load transactions.
        </div>
      )}
      {!isLoading && !isError && (
        <>
          {(!data?.data || data.data.length === 0) ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
              <BarChart2Icon className="size-10 opacity-30" />
              <p className="text-sm">No transactions found. Add your first one!</p>
            </div>
          ) : (
            <div className="rounded-xl border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Date</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Description</th>
                    <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden md:table-cell">Category</th>
                    <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">Amount</th>
                    <th className="px-4 py-2.5 w-20" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.data.map((tx) => {
                    const cat = tx.categoryId ? categoryMap.get(tx.categoryId) : undefined;
                    const isIncome = tx.type === 'income';
                    return (
                      <tr key={tx.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                          {format(new Date(tx.date), 'MMM d, yyyy')}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium leading-tight">{tx.description}</div>
                          {tx.merchant && (
                            <div className="text-xs text-muted-foreground mt-0.5">{tx.merchant}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          {cat ? (
                            <Badge
                              variant="outline"
                              className="gap-1.5"
                              style={{ borderColor: cat.color ?? undefined, color: cat.color ?? undefined }}
                            >
                              <span
                                className="inline-block size-2 rounded-full"
                                style={{ backgroundColor: cat.color ?? '#10b981' }}
                              />
                              {cat.name}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className={`px-4 py-3 text-right font-semibold tabular-nums ${isIncome ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                          {isIncome ? '+' : '-'}{formatCurrency(tx.amount)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <EditTransactionDialog
                              transaction={tx}
                              categories={categories}
                              onSuccess={() => qc.invalidateQueries({ queryKey: ['expenses'] })}
                            />
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => deleteMutation.mutate(tx.id)}
                              disabled={deleteMutation.isPending}
                            >
                              <Trash2Icon className="size-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {data && data.total > limit && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Showing {(page - 1) * limit + 1}–{Math.min(page * limit, data.total)} of {data.total}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── P&L Report Tab ───────────────────────────────────────────────────────────

function PLReportTab() {
  const currentYear = new Date().getFullYear();
  const [from, setFrom] = useState(`${currentYear}-01-01`);
  const [to, setTo] = useState(`${currentYear}-12-31`);

  const monthParams = buildParams({ from, to, groupBy: 'month' });
  const catParams = buildParams({ from, to, groupBy: 'category' });

  const { data: monthData, isLoading: monthLoading } = useQuery<ReportResponse>({
    queryKey: ['expenses', 'report', 'month', from, to],
    queryFn: async () => {
      const res = await fetch(`/api/expenses/reports?${monthParams}`);
      if (!res.ok) throw new Error('Failed to load report');
      return res.json();
    },
  });

  const { data: catData, isLoading: catLoading } = useQuery<ReportResponse>({
    queryKey: ['expenses', 'report', 'category', from, to],
    queryFn: async () => {
      const res = await fetch(`/api/expenses/reports?${catParams}`);
      if (!res.ok) throw new Error('Failed to load report');
      return res.json();
    },
  });

  const netPL = monthData?.netPL ?? 0;
  const isPositive = netPL >= 0;

  const expensePieData = catData
    ? (catData.data as CategoryData[]).filter((d) => d.type === 'expense')
    : [];

  return (
    <div className="flex flex-col gap-6">
      {/* Date range */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">From</Label>
          <Input
            type="date"
            className="h-8 w-36 text-sm"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">To</Label>
          <Input
            type="date"
            className="h-8 w-36 text-sm"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </div>

      {/* Summary cards */}
      {monthLoading ? (
        <div className="text-sm text-muted-foreground">Loading report...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="p-4 flex flex-col gap-1">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <TrendingUpIcon className="size-4 text-emerald-500" />
                Total Income
              </div>
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                {formatCurrency(monthData?.totalIncome ?? 0)}
              </div>
            </Card>
            <Card className="p-4 flex flex-col gap-1">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <TrendingDownIcon className="size-4 text-red-500" />
                Total Expenses
              </div>
              <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                {formatCurrency(monthData?.totalExpense ?? 0)}
              </div>
            </Card>
            <Card className="p-4 flex flex-col gap-1">
              <div className="text-sm text-muted-foreground">Net P&L</div>
              <div className={`text-2xl font-bold ${isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                {isPositive ? '+' : ''}{formatCurrency(netPL)}
              </div>
            </Card>
          </div>

          {/* Monthly bar chart */}
          {monthData && monthData.data.length > 0 && (
            <Card className="p-4">
              <h3 className="text-sm font-medium mb-4">Monthly Income vs Expenses</h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={monthData.data as MonthlyData[]} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                  <XAxis
                    dataKey="period"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v: string) => {
                      const [yr, mo] = v.split('-');
                      return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(mo, 10) - 1]} ${yr.slice(2)}`;
                    }}
                  />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => `$${v.toLocaleString()}`} />
                  <Tooltip
                    formatter={(value: unknown, name: unknown) => [formatCurrency(Number(value)), String(name) === 'income' ? 'Income' : 'Expense']}
                    labelFormatter={(label: unknown) => `Month: ${label}`}
                  />
                  <Legend formatter={(value: string) => value === 'income' ? 'Income' : 'Expense'} />
                  <Bar dataKey="income" fill="#10b981" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="expense" fill="#ef4444" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}

          {/* Expense breakdown pie chart */}
          {!catLoading && expensePieData.length > 0 && (
            <Card className="p-4">
              <h3 className="text-sm font-medium mb-4">Expense Breakdown by Category</h3>
              <div className="flex flex-col md:flex-row items-center gap-6">
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={expensePieData}
                      dataKey="total"
                      nameKey="categoryName"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={({ name, percent }: { name?: string; percent?: number }) =>
                        `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`
                      }
                      labelLine={false}
                    >
                      {expensePieData.map((_, index) => (
                        <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: unknown) => formatCurrency(Number(value))} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap md:flex-col gap-2 min-w-fit">
                  {expensePieData.map((entry, index) => (
                    <div key={entry.categoryId ?? entry.categoryName} className="flex items-center gap-2 text-sm">
                      <span
                        className="inline-block size-3 rounded-full shrink-0"
                        style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}
                      />
                      <span className="text-muted-foreground">{entry.categoryName}</span>
                      <span className="font-medium ml-auto">{formatCurrency(entry.total)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          )}

          {monthData && monthData.data.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
              <BarChart2Icon className="size-10 opacity-30" />
              <p className="text-sm">No data for this period. Add some transactions first.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ExpensesPage() {
  const qc = useQueryClient();
  const { data: categories = [], isLoading: catsLoading } = useQuery<ExpenseCategory[]>({
    queryKey: ['expenses', 'categories'],
    queryFn: async () => {
      const res = await fetch('/api/expenses/categories');
      if (!res.ok) throw new Error('Failed to load categories');
      return res.json();
    },
  });

  const refetchCategories = useCallback(
    () => qc.invalidateQueries({ queryKey: ['expenses', 'categories'] }),
    [qc]
  );

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Expenses</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Track income, expenses, and view P&L reports</p>
        </div>
        <ManageExpenseCategoriesDialog onSuccess={refetchCategories} />
      </div>

      <Tabs defaultValue="transactions">
        <TabsList>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="report">P&L Report</TabsTrigger>
        </TabsList>

        <TabsContent value="transactions" className="mt-4">
          {catsLoading ? (
            <div className="text-sm text-muted-foreground py-8 text-center">Loading...</div>
          ) : (
            <TransactionsTab categories={categories} />
          )}
        </TabsContent>

        <TabsContent value="report" className="mt-4">
          <PLReportTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
