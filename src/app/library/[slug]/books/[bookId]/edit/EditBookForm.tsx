'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { trpc } from '@/lib/trpc/client';
import { useToast } from '@/hooks/use-toast';
import { BookForm, type BookFormPayload } from '@/components/books/BookForm';

export function EditBookForm({ slug, book }: { slug: string; book: any }) {
  const t = useTranslations('books.edit');
  const router = useRouter();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const update = trpc.library.books.update.useMutation({
    onSuccess: () => {
      toast({ title: t('successToast') });
      utils.library.books.list.invalidate();
      utils.library.books.get.invalidate();
      router.push(`/library/${slug}/books/${book.id}`);
    },
    onError: (err) => {
      if (err.data?.code === 'CONFLICT') {
        toast({
          title: t('conflictTitle'),
          description: t('conflictDescription'),
          variant: 'destructive',
        });
      } else {
        toast({ title: t('errorToast'), description: err.message, variant: 'destructive' });
      }
    },
  });

  return (
    <BookForm
      defaultValues={{
        title: book.title,
        authorsCsv: book.authors.join(', '),
        isbn10: book.isbn10 ?? '',
        isbn13: book.isbn13 ?? '',
        publisher: book.publisher ?? '',
        publishedYear: book.publishedYear ? String(book.publishedYear) : '',
        language: book.language ?? '',
        description: book.description ?? '',
        coverPath: book.coverPath ?? '',
      }}
      onSubmit={(payload: BookFormPayload) =>
        update.mutate({
          slug,
          id: book.id,
          expectedUpdatedAt: book.updatedAt,
          patch: payload,
        })
      }
      submitLabel={t('submit')}
      isSubmitting={update.isPending}
    />
  );
}
