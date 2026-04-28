import * as React from 'react';
import { Button, Heading, Text } from '@react-email/components';
import { EmailLayout } from './_layout';

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
      <Heading className="text-xl font-semibold m-0">Bonjour {userDisplayName}</Heading>
      <Text className="mt-4">
        {inviterName} vous invite à rejoindre la bibliothèque <strong>{libraryName}</strong> sur
        BiblioShare. Vous pourrez y accéder avec votre compte existant.
      </Text>
      <Text className="mt-2">Lien valable jusqu'au {expiresFr}.</Text>
      <Button
        href={joinUrl}
        className="mt-6 bg-slate-900 text-white px-5 py-3 rounded-md font-medium"
      >
        Rejoindre {libraryName}
      </Button>
      <Text className="mt-6 text-xs text-slate-500 break-all">{joinUrl}</Text>
    </EmailLayout>
  );
};

export default InvitationJoinLibraryEmail;
