import type { Metadata } from 'next';
import { RecoveryCodesDisplay } from '@/components/auth/RecoveryCodesDisplay';

export const metadata: Metadata = {
  title: 'Codes de récupération — BiblioShare',
  robots: { index: false, follow: false },
};

export default function RecoveryCodesPage() {
  return <RecoveryCodesDisplay />;
}
