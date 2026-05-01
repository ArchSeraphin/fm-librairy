'use client';

import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { BookOpen, Package, Archive } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BookActionsMenu } from './BookActionsMenu';
import { BookFileUpload } from '@/components/books/BookFileUpload';
import { ScanStatusBadge } from '@/components/books/ScanStatusBadge';
import { MetadataSourceBadge } from '@/components/books/MetadataSourceBadge';
import { MetadataFetchStatusBadge } from '@/components/books/MetadataFetchStatusBadge';
import type { Book, BookFile } from '@prisma/client';

export function BookDetail({
  slug,
  book,
  isAdmin,
  isGlobalAdmin,
  files,
  canUpload,
}: {
  slug: string;
  book: Book;
  isAdmin: boolean;
  isGlobalAdmin: boolean;
  files: BookFile[];
  canUpload: boolean;
}) {
  const t = useTranslations('books.detail');
  return (
    <article className="grid gap-8 lg:grid-cols-[280px_1fr]">
      <div>
        {book.coverPath ? (
          <Image
            src={`/api/covers/${book.id}`}
            alt={t('coverAlt', { title: book.title })}
            width={280}
            height={420}
            className="aspect-[2/3] w-full rounded-lg object-cover shadow"
            unoptimized={false}
          />
        ) : (
          <div className="flex aspect-[2/3] items-center justify-center rounded-lg bg-muted">
            <BookOpen className="h-12 w-12 text-muted-foreground" aria-hidden />
          </div>
        )}
      </div>
      <div className="space-y-4">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{book.title}</h1>
            <p className="text-sm text-muted-foreground">{book.authors.join(', ')}</p>
          </div>
          {isAdmin && <BookActionsMenu slug={slug} book={book} isGlobalAdmin={isGlobalAdmin} />}
        </header>
        <div className="flex flex-wrap gap-2">
          {book.archivedAt && (
            <Badge variant="outline">
              <Archive className="mr-1 h-3 w-3" aria-hidden />
              {t('archived')}
            </Badge>
          )}
          {book.hasDigital && (
            <Badge variant="secondary">
              <BookOpen className="mr-1 h-3 w-3" aria-hidden />
              {t('digital')}
            </Badge>
          )}
          {book.hasPhysical && (
            <Badge variant="secondary">
              <Package className="mr-1 h-3 w-3" aria-hidden />
              {t('physical')}
            </Badge>
          )}
          {book.metadataFetchStatus === 'PENDING' && <MetadataFetchStatusBadge status="PENDING" />}
        </div>
        <Card>
          <CardContent className="space-y-3 py-5">
            {book.publisher && <Row k={t('publisher')} v={book.publisher} />}
            {book.publishedYear && <Row k={t('year')} v={String(book.publishedYear)} />}
            {book.language && <Row k={t('language')} v={book.language} />}
            {book.isbn13 && <Row k="ISBN-13" v={book.isbn13} />}
            {book.isbn10 && <Row k="ISBN-10" v={book.isbn10} />}
          </CardContent>
        </Card>
        <MetadataSourceBadge
          slug={slug}
          bookId={book.id}
          source={book.metadataSource}
          fetchedAt={book.metadataFetchedAt}
          canRefresh={isAdmin}
          isPending={book.metadataFetchStatus === 'PENDING'}
        />
        {book.description && (
          <section>
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
              {t('descriptionLabel')}
            </h2>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">{book.description}</p>
          </section>
        )}
        <section className="mt-8 space-y-3">
          <h2 className="text-lg font-semibold">Fichier</h2>
          {files.length === 0 ? (
            canUpload ? (
              <BookFileUpload slug={slug} bookId={book.id} />
            ) : (
              <p className="text-sm text-muted-foreground">Aucun fichier disponible.</p>
            )
          ) : (
            files.map((f) => (
              <div key={f.id} className="flex items-center justify-between rounded-md border p-3">
                <div className="flex items-center gap-3">
                  <ScanStatusBadge status={f.scanStatus} />
                  <span className="text-sm">
                    {f.format} · {(Number(f.fileSizeBytes) / 1024 / 1024).toFixed(2)} MB
                  </span>
                </div>
              </div>
            ))
          )}
        </section>
      </div>
    </article>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 text-sm">
      <dt className="text-muted-foreground">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
