// DUPLICATED from src/emails/invitation-join-library.tsx — keep in sync. Phase 1B
// chose duplication over a shared workspace package; revisit in Phase 2+.
// FR-only for Phase 1B. Email i18n via next-intl is deferred to Phase 2;
// to localize, thread `getTranslations` outputs as props from the caller.
import * as React from 'react';
import { Button, Heading, Text } from '@react-email/components';
import { EmailLayout } from './_layout.js';

export interface InvitationJoinLibraryProps {
  inviterName: string;
  libraryName: string;
  userDisplayName: string;
  joinUrl: string;
  expiresAt: Date;
}

const InvitationJoinLibraryEmail: React.FC<InvitationJoinLibraryProps> = ({
  inviterName,
  libraryName,
  userDisplayName,
  joinUrl,
  expiresAt,
}) => {
  const expiresFr = expiresAt.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <EmailLayout preview={`${inviterName} vous invite à rejoindre ${libraryName}`}>
      <Heading className="m-0 text-xl font-semibold">Bonjour {userDisplayName}</Heading>
      <Text className="mt-4">
        {inviterName} vous invite à rejoindre la bibliothèque <strong>{libraryName}</strong> sur
        BiblioShare. Vous pourrez y accéder avec votre compte existant.
      </Text>
      <Text className="mt-2">Lien valable jusqu'au {expiresFr}.</Text>
      <Button
        href={joinUrl}
        className="mt-6 rounded-md bg-slate-900 px-5 py-3 font-medium text-white"
      >
        Rejoindre {libraryName}
      </Button>
      <Text className="mt-6 break-all text-xs text-slate-500">{joinUrl}</Text>
    </EmailLayout>
  );
};

export default InvitationJoinLibraryEmail;
