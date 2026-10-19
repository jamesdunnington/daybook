'use client';

import { useEffect, useRef } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import type { PartialBlock } from '@blocknote/core';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/core/style.css';
import '@blocknote/shadcn/style.css';

async function uploadImage(file: File): Promise<string> {
  const body = new FormData();
  body.append('file', file);
  const res = await fetch('/api/power-tab/upload', { method: 'POST', body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Upload failed');
  return data.url;
}

export function BlockEditor({
  pageId,
  initialContent,
  onSave,
}: {
  /** Remounts the editor when switching pages (BlockNote only reads initialContent once). */
  pageId: string;
  initialContent: PartialBlock[];
  onSave: (blocks: unknown[]) => void;
}) {
  const editor = useCreateBlockNote({
    initialContent: initialContent.length ? initialContent : undefined,
    // Enables the "Upload" tab on image blocks, drag-and-drop, and pasting
    // clipboard images (e.g. screen snips).
    uploadFile: uploadImage,
  });

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSaveRef = useRef(onSave);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    const unsubscribe = editor.onChange(() => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        onSaveRef.current(editor.document);
      }, 1000);
    });
    return () => {
      unsubscribe();
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [editor]);

  return (
    <div className="rounded-lg border bg-background">
      <BlockNoteView key={pageId} editor={editor} />
    </div>
  );
}
