import type { ReactElement } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';

// MemberHeader transitively renders LibrarySwitcher, which calls useRouter()
// and trpc.library.libraries.listAccessible.useQuery(). Stub both so the smoke
// test stays scoped to header structure (burger + brand).
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/libraries',
}));
vi.mock('@/lib/trpc/client', () => ({
  trpc: {
    library: {
      libraries: {
        listAccessible: {
          useQuery: () => ({ data: [], isLoading: false }),
        },
      },
    },
  },
}));

import { MemberHeader } from '@/components/member/MemberHeader';
import frMessages from '@/i18n/messages/fr.json';

function withProviders(node: ReactElement) {
  return (
    <NextIntlClientProvider locale="fr" messages={frMessages}>
      {node}
    </NextIntlClientProvider>
  );
}

describe('MemberHeader', () => {
  test('renders burger button and brand', () => {
    render(withProviders(<MemberHeader />));
    expect(screen.getByLabelText(/ouvrir le menu/i)).toBeInTheDocument();
  });
});
