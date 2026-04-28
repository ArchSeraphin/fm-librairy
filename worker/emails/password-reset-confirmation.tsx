// FR-only for Phase 1B. Email i18n via next-intl is deferred to Phase 2;
// to localize, thread `getTranslations` outputs as props from the caller.
import * as React from 'react';
import { Heading, Text } from '@react-email/components';
import { EmailLayout } from './_layout.js';

export interface PasswordResetConfirmationProps {
  userDisplayName: string;
  occurredAt: Date;
}

const PasswordResetConfirmationEmail: React.FC<PasswordResetConfirmationProps> = ({
  userDisplayName,
  occurredAt,
}) => {
  const occurredFr = occurredAt.toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <EmailLayout preview="Votre mot de passe a été modifié">
      <Heading className="text-xl font-semibold m-0">Mot de passe modifié</Heading>
      <Text className="mt-4">Bonjour {userDisplayName},</Text>
      <Text className="mt-2">
        Votre mot de passe BiblioShare a été modifié le {occurredFr}. Toutes vos sessions actives
        ont été déconnectées par sécurité.
      </Text>
      <Text className="mt-4 font-semibold">
        Si ce n'était pas vous, contactez immédiatement l'administrateur de votre bibliothèque.
      </Text>
    </EmailLayout>
  );
};

export default PasswordResetConfirmationEmail;
