'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  uploadBookFile,
  type UploadResult,
} from '@/app/library/[slug]/books/[bookId]/upload/actions';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

interface Props {
  slug: string;
  bookId: string;
}

const ACCEPT =
  '.epub,.pdf,.txt,.docx,application/epub+zip,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const ERROR_MSG: Record<NonNullable<Extract<UploadResult, { ok: false }>['error']>, string> = {
  UNAUTHORIZED: 'Vous n’avez pas le droit d’uploader dans cette bibliothèque.',
  INVALID_INPUT: 'Champs manquants.',
  INVALID_MIME: 'Format non supporté. Acceptés : EPUB, PDF, TXT, DOCX.',
  OVERSIZE: 'Fichier trop volumineux (max 100 Mo).',
  DUPLICATE: 'Ce fichier existe déjà dans cette bibliothèque.',
  FORMAT_TAKEN: 'Ce livre a déjà un fichier de ce format. Demandez à un admin de le supprimer.',
  RATE_LIMITED: 'Trop d’uploads récents. Réessayez dans une minute.',
  INTERNAL_ERROR: 'Erreur serveur. Réessayez ou contactez un admin.',
};

export function BookFileUpload({ slug, bookId }: Props) {
  const [pending, startTransition] = useTransition();
  const [filename, setFilename] = useState<string | null>(null);
  const router = useRouter();
  const { toast } = useToast();

  return (
    <form
      action={(formData) => {
        formData.set('slug', slug);
        formData.set('bookId', bookId);
        startTransition(async () => {
          const r = await uploadBookFile(formData);
          if (r.ok) {
            toast({
              title: 'Upload reçu',
              description: 'Le fichier est en cours d’analyse.',
            });
            router.refresh();
          } else {
            toast({
              title: 'Échec de l’upload',
              description: ERROR_MSG[r.error],
              variant: 'destructive',
            });
          }
        });
      }}
      className="flex flex-col gap-3 rounded-md border border-dashed p-4"
    >
      <label className="flex flex-col gap-2 text-sm">
        <span className="font-medium">Ajouter un fichier</span>
        <input
          type="file"
          name="file"
          accept={ACCEPT}
          required
          onChange={(e) => setFilename(e.target.files?.[0]?.name ?? null)}
          disabled={pending}
        />
      </label>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {filename ?? 'EPUB / PDF / TXT / DOCX — 100 Mo max'}
        </span>
        <Button type="submit" disabled={pending || !filename}>
          {pending ? 'Envoi…' : 'Envoyer'}
        </Button>
      </div>
    </form>
  );
}
