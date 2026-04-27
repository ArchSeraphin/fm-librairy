import type { Metadata } from 'next';
import { TwoFactorSetup } from '@/components/auth/TwoFactorSetup';

export const metadata: Metadata = {
  title: 'Activer la 2FA — BiblioShare',
  robots: { index: false, follow: false },
};

export default function TwoFactorSetupPage() {
  return <TwoFactorSetup />;
}
