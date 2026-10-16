'use client';

import { useEffect, useRef } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import type { PartialBlock } from '@blocknote/core';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/core/style.css';
import '@blocknote/shadcn/style.css';

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
