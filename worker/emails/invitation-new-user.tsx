// DUPLICATED from src/emails/invitation-new-user.tsx — keep in sync. Phase 1B
// chose duplication over a shared workspace package; revisit in Phase 2+.
// FR-only for Phase 1B. Email i18n via next-intl is deferred to Phase 2;
// to localize, thread `getTranslations` outputs as props from the caller.
import * as React from 'react';
import { Button, Heading, Text } from '@react-email/components';
import { EmailLayout } from './_layout.js';

export interface InvitationNewUserProps {
  inviterName: string;
  libraryName?: string | null;
  signupUrl: string;
  expiresAt: Date;
}

const InvitationNewUserEmail: React.FC<InvitationNewUserProps> = ({
  inviterName,
  libraryName,
  signupUrl,
  expiresAt,
}) => {
  const target = libraryName ? `la bibliothèque ${libraryName}` : 'BiblioShare';
  const expiresFr = expiresAt.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <EmailLayout preview={`Vous êtes invité·e sur BiblioShare`}>
      <Heading className="m-0 text-xl font-semibold">Vous êtes invité·e</Heading>
      <Text className="mt-4">
        {inviterName} vous invite à rejoindre {target}.
      </Text>
      <Text className="mt-2">
        Créez votre compte en cliquant sur le bouton ci-dessous. Ce lien est valable jusqu'au{' '}
        {expiresFr}.
      </Text>
      <Button
        href={signupUrl}
        className="mt-6 rounded-md bg-slate-900 px-5 py-3 font-medium text-white"
      >
        Créer mon compte
      </Button>
      <Text className="mt-6 text-sm text-slate-600">
        Si le bouton ne fonctionne pas, copiez cette URL dans votre navigateur :
      </Text>
      <Text className="break-all text-xs text-slate-500">{signupUrl}</Text>
    </EmailLayout>
  );
};

export default InvitationNewUserEmail;
