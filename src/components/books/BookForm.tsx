'use client';

import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';

const formSchema = z.object({
  title: z.string().min(1).max(500),
  authorsCsv: z.string().min(1).max(2000),
  isbn10: z
    .string()
    .regex(/^\d{9}[\dX]$/, 'ISBN10 invalide')
    .or(z.literal(''))
    .optional(),
  isbn13: z
    .string()
    .regex(/^\d{13}$/, 'ISBN13 invalide')
    .or(z.literal(''))
    .optional(),
  publisher: z.string().max(200).optional(),
  publishedYear: z
    .string()
    .regex(/^\d{4}$/, 'Année invalide')
    .or(z.literal(''))
    .optional(),
  language: z.string().max(8).optional(),
  description: z.string().max(10_000).optional(),
  coverPath: z
    .string()
    .url('URL invalide')
    .startsWith('https://', 'URL HTTPS uniquement')
    .or(z.literal(''))
    .optional(),
});

export type BookFormValues = z.infer<typeof formSchema>;

export interface BookFormPayload {
  title: string;
  authors: string[];
  isbn10?: string | null;
  isbn13?: string | null;
  publisher?: string | null;
  publishedYear?: number | null;
  language?: string | null;
  description?: string | null;
  coverPath?: string | null;
}

export function BookForm({
  defaultValues,
  onSubmit,
  submitLabel,
  isSubmitting,
}: {
  defaultValues?: Partial<BookFormValues>;
  onSubmit: (payload: BookFormPayload) => void;
  submitLabel: string;
  isSubmitting: boolean;
}) {
  const t = useTranslations('books.form');
  const form = useForm<BookFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: '',
      authorsCsv: '',
      isbn10: '',
      isbn13: '',
      publisher: '',
      publishedYear: '',
      language: '',
      description: '',
      coverPath: '',
      ...defaultValues,
    },
  });

  const submit = form.handleSubmit((values) => {
    const payload: BookFormPayload = {
      title: values.title,
      authors: values.authorsCsv.split(',').map((s) => s.trim()).filter(Boolean),
      isbn10: values.isbn10 || null,
      isbn13: values.isbn13 || null,
      publisher: values.publisher || null,
      publishedYear: values.publishedYear ? Number(values.publishedYear) : null,
      language: values.language || null,
      description: values.description || null,
      coverPath: values.coverPath || null,
    };
    onSubmit(payload);
  });

  return (
    <Form {...form}>
      <form onSubmit={submit} className="space-y-6">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('title')}</FormLabel>
              <FormControl>
                <Input maxLength={500} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="authorsCsv"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('authors')}</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormDescription>{t('authorsHelp')}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="isbn10"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('isbn10')}</FormLabel>
                <FormControl>
                  <Input maxLength={10} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="isbn13"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('isbn13')}</FormLabel>
                <FormControl>
                  <Input maxLength={13} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="publisher"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('publisher')}</FormLabel>
                <FormControl>
                  <Input maxLength={200} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="publishedYear"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('year')}</FormLabel>
                <FormControl>
                  <Input maxLength={4} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="language"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('language')}</FormLabel>
              <FormControl>
                <Input maxLength={8} placeholder="fr, en, es, …" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="coverPath"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('coverUrl')}</FormLabel>
              <FormControl>
                <Input type="url" placeholder="https://…" {...field} />
              </FormControl>
              <FormDescription>{t('coverHelp')}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('description')}</FormLabel>
              <FormControl>
                <textarea
                  className="flex min-h-[120px] w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1"
                  maxLength={10_000}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={isSubmitting}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
