import type { ReactElement } from 'react';
import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
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
