'use client';

import { toast } from 'sonner';

/** Shows a success toast with an "Undo" action, reusing the generic chat undo endpoint
 * (POST /api/chat/undo/:id) since recordUndo/applyUndo aren't chat-specific. */
export function undoableDelete(summary: string, undoId?: string, undoExpiresAt?: string) {
  if (!undoId) {
    toast.success(summary);
    return;
  }
  toast.success(summary, {
    action: {
      label: 'Undo',
      onClick: () => {
        fetch(`/api/chat/undo/${undoId}`, { method: 'POST' })
          .then((r) => r.json())
          .then((data) => toast.success(data.summary ?? 'Undone'))
          .catch(() => toast.error('Undo failed'));
      },
    },
    duration: Math.max(1000, new Date(undoExpiresAt ?? 0).getTime() - Date.now()),
  });
}
