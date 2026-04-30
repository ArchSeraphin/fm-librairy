import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import frMessages from '@/i18n/messages/fr.json';

vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    library: {
      libraries: {
        listAccessible: {
          useQuery: () => ({
            data: [
              { id: 'cl1', name: 'Lib One', slug: 'lib-one' },
              { id: 'cl2', name: 'Lib Two', slug: 'lib-two' },
            ],
            isLoading: false,
          }),
        },
      },
    },
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { LibrarySwitcher } from '@/components/member/LibrarySwitcher';

describe('LibrarySwitcher', () => {
  test('renders current library name when slug provided', () => {
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <LibrarySwitcher currentSlug="lib-two" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole('combobox')).toHaveTextContent(/lib two/i);
  });
});
