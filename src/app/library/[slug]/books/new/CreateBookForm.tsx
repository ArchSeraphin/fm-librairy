'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { trpc } from '@/lib/trpc/client';
import { useToast } from '@/hooks/use-toast';
import { BookForm, type BookFormPayload } from '@/components/books/BookForm';

export function CreateBookForm({ slug }: { slug: string }) {
  const t = useTranslations('books.new');
  const router = useRouter();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const create = trpc.library.books.create.useMutation({
    onSuccess: (book) => {
      toast({ title: t('successToast') });
      utils.library.books.list.invalidate();
      router.push(`/library/${slug}/books/${book.id}`);
    },
    onError: (err) => toast({ title: t('errorToast'), description: err.message, variant: 'destructive' }),
  });

  function handleSubmit(payload: BookFormPayload) {
    create.mutate({
      slug,
      title: payload.title,
      authors: payload.authors,
      isbn10: payload.isbn10 ?? undefined,
      isbn13: payload.isbn13 ?? undefined,
      publisher: payload.publisher ?? undefined,
      publishedYear: payload.publishedYear ?? undefined,
      language: payload.language ?? undefined,
      description: payload.description ?? undefined,
      coverPath: payload.coverPath ?? undefined,
    });
  }

  return (
    <BookForm
      onSubmit={handleSubmit}
      submitLabel={t('submit')}
      isSubmitting={create.isPending}
    />
  );
}
