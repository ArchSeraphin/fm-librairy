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
            data: [{ id: 'cl1', name: 'Mon Salon', slug: 'mon-salon' }],
            isLoading: false,
          }),
        },
      },
    },
  },
}));

import { LibrariesGrid } from '@/app/libraries/LibrariesGrid';

describe('LibrariesGrid', () => {
  test('renders one card per accessible library', () => {
    render(
      <NextIntlClientProvider locale="fr" messages={frMessages}>
        <LibrariesGrid />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('Mon Salon')).toBeInTheDocument();
  });
});
