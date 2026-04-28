// DUPLICATED from src/emails/_layout.tsx — keep in sync. Phase 1B
// chose duplication over a shared workspace package; revisit in Phase 2+.
// FR-only for Phase 1B. Email i18n via next-intl is deferred to Phase 2;
// to localize, thread `getTranslations` outputs as props from the caller.
import * as React from 'react';
import { Html, Head, Body, Container, Section, Text, Hr, Tailwind } from '@react-email/components';

export interface LayoutProps {
  preview?: string;
  children: React.ReactNode;
}

export const EmailLayout: React.FC<LayoutProps> = ({ preview, children }) => (
  <Html lang="fr">
    <Head>
      <title>BiblioShare</title>
      {preview ? <meta name="description" content={preview} /> : null}
    </Head>
    <Tailwind>
      <Body className="bg-white font-sans text-slate-900">
        <Container className="mx-auto max-w-xl px-6 py-8">
          <Section>
            <Text className="m-0 text-2xl font-semibold tracking-tight">BiblioShare</Text>
          </Section>
          <Section className="mt-6">{children}</Section>
          <Hr className="my-8 border-slate-200" />
          <Section>
            <Text className="m-0 text-xs text-slate-500">
              Vous recevez cet email parce qu'une action sur BiblioShare le concerne. Si vous pensez
              que c'est une erreur, ignorez ce message.
            </Text>
          </Section>
        </Container>
      </Body>
    </Tailwind>
  </Html>
);
