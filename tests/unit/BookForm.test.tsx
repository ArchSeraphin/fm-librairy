import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import frMessages from '@/i18n/messages/fr.json';
import { BookForm } from '@/components/books/BookForm';

describe('BookForm', () => {
  test('submits payload with normalized authors when title + authors filled', async () => {
    const onSubmit = vi.fn();
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <BookForm onSubmit={onSubmit} submitLabel="Créer" isSubmitting={false} />
      </NextIntlClientProvider>,
    );
    fireEvent.change(screen.getByLabelText(/titre/i), { target: { value: 'Le Petit Prince' } });
    fireEvent.change(screen.getByLabelText(/auteurs/i), { target: { value: 'Saint-Exupéry' } });
    fireEvent.click(screen.getByRole('button', { name: /créer/i }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Le Petit Prince', authors: ['Saint-Exupéry'] }),
      );
    });
  });
});
