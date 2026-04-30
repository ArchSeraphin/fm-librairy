'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { MoreHorizontal, Pencil, Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ArchiveBookDialog } from '@/components/books/ArchiveBookDialog';
import { UnarchiveBookDialog } from '@/components/books/UnarchiveBookDialog';
import { DeleteBookDialog } from '@/components/books/DeleteBookDialog';

export function BookActionsMenu({
  slug,
  book,
  isGlobalAdmin,
}: {
  slug: string;
  book: any;
  isGlobalAdmin: boolean;
}) {
  const t = useTranslations('books.actions');
  const [open, setOpen] = useState<null | 'archive' | 'unarchive' | 'delete'>(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label={t('open')}>
            <MoreHorizontal className="h-4 w-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/library/${slug}/books/${book.id}/edit`}>
              <Pencil className="mr-2 h-4 w-4" aria-hidden /> {t('edit')}
            </Link>
          </DropdownMenuItem>
          {book.archivedAt ? (
            <DropdownMenuItem onClick={() => setOpen('unarchive')}>
              <ArchiveRestore className="mr-2 h-4 w-4" aria-hidden /> {t('unarchive')}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => setOpen('archive')}>
              <Archive className="mr-2 h-4 w-4" aria-hidden /> {t('archive')}
            </DropdownMenuItem>
          )}
          {isGlobalAdmin && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setOpen('delete')}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" aria-hidden /> {t('delete')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {open === 'archive' && (
        <ArchiveBookDialog slug={slug} bookId={book.id} onClose={() => setOpen(null)} />
      )}
      {open === 'unarchive' && (
        <UnarchiveBookDialog slug={slug} bookId={book.id} onClose={() => setOpen(null)} />
      )}
      {open === 'delete' && (
        <DeleteBookDialog slug={slug} bookId={book.id} onClose={() => setOpen(null)} />
      )}
    </>
  );
}
