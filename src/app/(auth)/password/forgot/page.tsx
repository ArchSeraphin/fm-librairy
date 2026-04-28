import type { Metadata } from 'next';
import { ForgotForm } from './forgot-form';

export const metadata: Metadata = {
  title: 'Mot de passe oublié — BiblioShare',
};

export default function ForgotPasswordPage() {
  return <ForgotForm />;
}
