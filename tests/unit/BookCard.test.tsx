import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import frMessages from '@/i18n/messages/fr.json';
import { BookCard } from '@/components/books/BookCard';

const book = {
  id: 'cl1',
  title: 'Le Petit Prince',
  authors: ['Saint-Exupéry'],
  coverPath: 'https://example.com/c.jpg',
  hasDigital: true,
  hasPhysical: false,
  archivedAt: null,
};

describe('BookCard', () => {
  test('renders title, authors, and digital badge', () => {
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <BookCard slug="mon-salon" book={book} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('Le Petit Prince')).toBeInTheDocument();
    expect(screen.getByText(/saint-exupéry/i)).toBeInTheDocument();
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/library/mon-salon/books/cl1');
    expect(screen.getByText(/numérique/i)).toBeInTheDocument();
  });

  test('shows archive badge when archivedAt is set', () => {
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <BookCard slug="mon-salon" book={{ ...book, archivedAt: new Date() }} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(/archivé/i)).toBeInTheDocument();
  });
});
