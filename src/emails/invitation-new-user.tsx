// FR-only for Phase 1B. Email i18n via next-intl is deferred to Phase 2;
// to localize, thread `getTranslations` outputs as props from the caller.
import * as React from 'react';
import { Button, Heading, Text } from '@react-email/components';
import { EmailLayout } from './_layout';

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
      <Heading className="text-xl font-semibold m-0">Vous êtes invité·e</Heading>
      <Text className="mt-4">
        {inviterName} vous invite à rejoindre {target}.
      </Text>
      <Text className="mt-2">
        Créez votre compte en cliquant sur le bouton ci-dessous. Ce lien est valable jusqu&apos;au {expiresFr}.
      </Text>
      <Button
        href={signupUrl}
        className="mt-6 bg-slate-900 text-white px-5 py-3 rounded-md font-medium"
      >
        Créer mon compte
      </Button>
      <Text className="mt-6 text-sm text-slate-600">
        Si le bouton ne fonctionne pas, copiez cette URL dans votre navigateur :
      </Text>
      <Text className="text-xs text-slate-500 break-all">{signupUrl}</Text>
    </EmailLayout>
  );
};

export default InvitationNewUserEmail;
