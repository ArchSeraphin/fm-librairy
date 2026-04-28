import * as React from 'react';
import { Button, Heading, Text } from '@react-email/components';
import { EmailLayout } from './_layout';

export interface PasswordResetProps {
  resetUrl: string;
  expiresAt: Date;
}

const PasswordResetEmail: React.FC<PasswordResetProps> = ({ resetUrl, expiresAt }) => {
  const expiresFr = expiresAt.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <EmailLayout preview="Réinitialisation de votre mot de passe">
      <Heading className="text-xl font-semibold m-0">Réinitialisation de mot de passe</Heading>
      <Text className="mt-4">
        Vous avez demandé la réinitialisation de votre mot de passe. Cliquez sur le bouton
        ci-dessous pour en choisir un nouveau. Le lien expire à {expiresFr} (1 heure).
      </Text>
      <Button
        href={resetUrl}
        className="mt-6 bg-slate-900 text-white px-5 py-3 rounded-md font-medium"
      >
        Choisir un nouveau mot de passe
      </Button>
      <Text className="mt-6 text-sm text-slate-600">
        Si vous n'avez pas demandé cette réinitialisation, ignorez cet email — votre mot de passe
        actuel reste valide.
      </Text>
      <Text className="mt-4 text-xs text-slate-500 break-all">{resetUrl}</Text>
    </EmailLayout>
  );
};

export default PasswordResetEmail;
