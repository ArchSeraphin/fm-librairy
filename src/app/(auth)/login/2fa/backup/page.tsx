import type { Metadata } from 'next';
import { BackupCodeForm } from '@/components/auth/BackupCodeForm';

export const metadata: Metadata = {
  title: 'Code de récupération — BiblioShare',
  robots: { index: false, follow: false },
};

export default function BackupCodePage() {
  return <BackupCodeForm />;
}
