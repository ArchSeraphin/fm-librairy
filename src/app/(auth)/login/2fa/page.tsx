import type { Metadata } from 'next';
import { TwoFactorChallenge } from '@/components/auth/TwoFactorChallenge';

export const metadata: Metadata = {
  title: 'Vérification — BiblioShare',
  robots: { index: false, follow: false },
};

export default function TwoFactorChallengePage() {
  return <TwoFactorChallenge />;
}
