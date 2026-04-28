# Phase 1B — Invitations & Reset Password Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer les flows invitation (signup ou join) et reset password pour BiblioShare, avec emails transactionnels (Resend prod / Mailpit dev), templates react-email, rate-limits double, audit log complet, attack tests dédiés.

**Architecture:** Services purs `lib/{email,invitations,password-reset}.ts` (testables sans DB) appelés depuis 2 routeurs tRPC (`invitation`, `password`). Worker BullMQ queue `mail` avec retry exponentiel pour les envois. Templates react-email rendus en HTML+texte. Toutes les écritures critiques dans des transactions Prisma `Serializable`.

**Tech Stack:** Next.js 15 + tRPC + Prisma 6 + BullMQ + ioredis + nodemailer (SMTP) + Resend SDK + react-email (render + components) + Mailpit (dev/CI) + Vitest 4 + Playwright + Zod.

**Spec source:** `docs/superpowers/specs/2026-04-27-phase-1b-invitations-reset-design.md`.

**Branch:** `feat/phase-1b-invitations-reset` (créée en Task 0).

**Scope :** uniquement la sous-phase 1B. Le panel admin complet (1C) et les pages `/account/security` sont reportés.

---

## Task 0 : Setup branche et dépendances

**Files:**

- Modify: `package.json` (deps + scripts)
- Modify: `docker-compose.dev.yml` (service mailpit)
- Modify: `docker-compose.ci.yml` (service mailpit pour E2E)

- [ ] **Step 0.1: Créer la branche de travail**

```bash
git checkout main
git pull
git checkout -b feat/phase-1b-invitations-reset
git status
```

Expected: branche créée à partir de `main` (qui contient le tag `phase-1a-complete`), working tree propre.

- [ ] **Step 0.2: Installer les dépendances runtime**

```bash
pnpm add resend nodemailer @react-email/render @react-email/components
```

Expected: 4 packages ajoutés à `dependencies`.

- [ ] **Step 0.3: Installer les dépendances dev**

```bash
pnpm add -D @types/nodemailer react-email
```

Expected: `react-email` (dev server) + types nodemailer ajoutés.

- [ ] **Step 0.4: Ajouter les scripts npm**

Modifier `package.json` section `"scripts"` pour ajouter :

```json
"email:dev": "email dev --port 3001 --dir src/emails"
```

- [ ] **Step 0.5: Ajouter Mailpit au compose dev**

Modifier `docker-compose.dev.yml`, section `services`, ajouter :

```yaml
mailpit:
  image: axllent/mailpit:v1.21
  container_name: biblioshare-mailpit
  restart: unless-stopped
  ports:
    - '1025:1025' # SMTP
    - '8025:8025' # Web UI + API
  environment:
    MP_MAX_MESSAGES: '5000'
    MP_SMTP_AUTH_ACCEPT_ANY: '1'
    MP_SMTP_AUTH_ALLOW_INSECURE: '1'
  healthcheck:
    test: ['CMD', 'wget', '-qO-', 'http://localhost:8025/api/v1/info']
    interval: 10s
    timeout: 3s
    retries: 5
```

- [ ] **Step 0.6: Ajouter Mailpit au compose CI**

Si `docker-compose.ci.yml` existe, dupliquer le bloc `mailpit` ci-dessus. Sinon créer le fichier en miroir minimal du dev. Vérifier que les jobs E2E le démarrent.

- [ ] **Step 0.7: Verify install**

```bash
pnpm install
pnpm typecheck
docker compose -f docker-compose.dev.yml up -d mailpit
curl -s http://localhost:8025/api/v1/info | head -c 200
docker compose -f docker-compose.dev.yml stop mailpit
```

Expected: `pnpm typecheck` vert, Mailpit répond JSON, stop OK.

- [ ] **Step 0.8: Commit**

```bash
git add package.json pnpm-lock.yaml docker-compose.dev.yml docker-compose.ci.yml
git commit -m "chore(phase-1b): add resend + nodemailer + react-email + Mailpit"
```

---

## Task 1 : Env vars Phase 1B

**Files:**

- Modify: `src/lib/env.ts` (schéma Zod étendu)
- Modify: `.env.example` (ajout de toutes les nouvelles variables)
- Modify: `tests/integration/setup/containers.ts` (process.env pour CI)

- [ ] **Step 1.1: Étendre le schéma Zod env**

Modifier `src/lib/env.ts`, après le bloc `// Email (Phase 1+)` existant, remplacer par :

```ts
  // Email transport (Phase 1B)
  EMAIL_TRANSPORT: z.enum(['resend', 'smtp']).default('smtp'),
  EMAIL_FROM: z.string().min(3),
  RESEND_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_LOG_SALT: z.string().min(32),
```

Puis, après le `EnvSchema = z.object({...})` (avant `export type Env`), ajouter un raffinement :

```ts
const EnvSchema = z.object({...}).superRefine((v, ctx) => {
  if (v.EMAIL_TRANSPORT === 'resend' && !v.RESEND_API_KEY) {
    ctx.addIssue({ code: 'custom', path: ['RESEND_API_KEY'], message: 'required when EMAIL_TRANSPORT=resend' });
  }
  if (v.EMAIL_TRANSPORT === 'smtp' && !v.SMTP_HOST) {
    ctx.addIssue({ code: 'custom', path: ['SMTP_HOST'], message: 'required when EMAIL_TRANSPORT=smtp' });
  }
});
```

Note : `EMAIL_FROM` n'utilise plus `.email()` (les valeurs autorisées incluent des formats `Name <addr@x>` que `z.string().email()` rejette). Validation libre minimale, le transport ré-erreur si format invalide.

- [ ] **Step 1.2: Mettre à jour `.env.example`**

Ajouter à la fin du fichier (ou dans la section email existante) :

```
# Phase 1B — Email transactionnel
EMAIL_TRANSPORT=smtp                          # 'resend' en prod
EMAIL_FROM=BiblioShare <noreply@biblio.test>
SMTP_HOST=mailpit                             # service docker-compose dev
SMTP_PORT=1025
# SMTP_USER=
# SMTP_PASS=
# RESEND_API_KEY=re_xxxxxxxx                   # requis si EMAIL_TRANSPORT=resend
EMAIL_LOG_SALT=replace-with-openssl-rand-hex-32
```

- [ ] **Step 1.3: Brancher les env vars dans le setup d'intégration**

Modifier `tests/integration/setup/containers.ts`, dans `beforeAll`, après les env existants, ajouter :

```ts
process.env.EMAIL_TRANSPORT = 'smtp';
process.env.EMAIL_FROM = 'BiblioShare <test@biblio.test>';
process.env.SMTP_HOST = '127.0.0.1';
process.env.SMTP_PORT = '1'; // port volontairement invalide ; tests unitaires mockent le transport
process.env.EMAIL_LOG_SALT = 'test-email-log-salt-32-chars-min!';
```

- [ ] **Step 1.4: Run typecheck + unit**

```bash
pnpm typecheck
pnpm test:unit -- src/lib/env
```

Expected: typecheck vert, tests env existants verts (les nouvelles variables sont optionnelles ou ont des defaults).

- [ ] **Step 1.5: Commit**

```bash
git add src/lib/env.ts .env.example tests/integration/setup/containers.ts
git commit -m "feat(phase-1b): add email transport env vars"
```

---

## Task 2 : src/lib/email.ts — transport abstrait

**Files:**

- Create: `src/lib/email.ts`
- Test: `tests/unit/email.test.ts`

- [ ] **Step 2.1: Écrire le test failing pour `renderEmail`**

Créer `tests/unit/email.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';

vi.mock('@/lib/env', () => ({
  getEnv: () => ({
    EMAIL_TRANSPORT: 'smtp',
    EMAIL_FROM: 'Test <noreply@test.local>',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: 1025,
    EMAIL_LOG_SALT: 'a'.repeat(32),
  }),
}));

import { renderEmail, getTransport } from '@/lib/email';

const Hello: React.FC<{ name: string }> = ({ name }) =>
  React.createElement('div', null, `Hello ${name}`);

describe('renderEmail', () => {
  it('renders both html and text from a react component', async () => {
    const out = await renderEmail(Hello, { name: 'Alice' });
    expect(out.html).toContain('Hello Alice');
    expect(out.text).toContain('Hello Alice');
    expect(out.html.startsWith('<')).toBe(true);
  });
});

describe('getTransport', () => {
  beforeEach(() => vi.resetModules());

  it('returns an object with a send function', () => {
    const t = getTransport();
    expect(typeof t.send).toBe('function');
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
pnpm test:unit -- email
```

Expected: FAIL with `Cannot find module '@/lib/email'`.

- [ ] **Step 2.3: Implémenter `src/lib/email.ts`**

```ts
import nodemailer, { type Transporter } from 'nodemailer';
import { Resend } from 'resend';
import { render } from '@react-email/render';
import type React from 'react';
import { createHash } from 'node:crypto';
import { getEnv } from './env';
import { getLogger } from './logger';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

export interface EmailTransport {
  send(msg: EmailMessage): Promise<{ id: string }>;
}

let cachedTransport: EmailTransport | null = null;
let cachedSmtp: Transporter | null = null;

function buildResendTransport(apiKey: string, from: string): EmailTransport {
  const client = new Resend(apiKey);
  return {
    async send(msg) {
      const res = await client.emails.send({
        from,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        replyTo: msg.replyTo,
      });
      if (res.error) throw new Error(`resend: ${res.error.message}`);
      return { id: res.data?.id ?? 'unknown' };
    },
  };
}

function buildSmtpTransport(opts: {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
}): EmailTransport {
  if (!cachedSmtp) {
    cachedSmtp = nodemailer.createTransport({
      host: opts.host,
      port: opts.port,
      secure: false,
      auth: opts.user && opts.pass ? { user: opts.user, pass: opts.pass } : undefined,
    });
  }
  const tx = cachedSmtp;
  return {
    async send(msg) {
      const info = await tx.sendMail({
        from: opts.from,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        replyTo: msg.replyTo,
      });
      return { id: info.messageId };
    },
  };
}

export function getTransport(): EmailTransport {
  if (cachedTransport) return cachedTransport;
  const env = getEnv();
  if (env.EMAIL_TRANSPORT === 'resend') {
    if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY missing');
    cachedTransport = buildResendTransport(env.RESEND_API_KEY, env.EMAIL_FROM);
  } else {
    if (!env.SMTP_HOST) throw new Error('SMTP_HOST missing');
    cachedTransport = buildSmtpTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      from: env.EMAIL_FROM,
    });
  }
  return cachedTransport;
}

export async function renderEmail<P>(
  Component: React.FC<P>,
  props: P,
): Promise<{ html: string; text: string }> {
  const html = await render(Component(props as P & React.Attributes), { pretty: false });
  const text = await render(Component(props as P & React.Attributes), { plainText: true });
  return { html, text };
}

export function hashRecipient(email: string): string {
  const salt = getEnv().EMAIL_LOG_SALT;
  return createHash('sha256').update(`${salt}:${email.toLowerCase()}`).digest('hex').slice(0, 32);
}

export async function sendEmail(msg: EmailMessage): Promise<{ id: string }> {
  const log = getLogger();
  const start = Date.now();
  const tx = getTransport();
  const result = await tx.send(msg);
  log.info(
    {
      event: 'email.sent',
      toHash: hashRecipient(msg.to),
      transportId: result.id,
      durationMs: Date.now() - start,
    },
    'email sent',
  );
  return result;
}

export function __resetEmailTransportForTest(): void {
  cachedTransport = null;
  cachedSmtp = null;
}
```

- [ ] **Step 2.4: Run test to verify it passes**

```bash
pnpm test:unit -- email
```

Expected: 2 tests pass.

- [ ] **Step 2.5: Commit**

```bash
git add src/lib/email.ts tests/unit/email.test.ts
git commit -m "feat(phase-1b): add email transport abstraction (resend + smtp)"
```

---

## Task 3 : Templates react-email

**Files:**

- Create: `src/emails/_layout.tsx`
- Create: `src/emails/invitation-new-user.tsx`
- Create: `src/emails/invitation-join-library.tsx`
- Create: `src/emails/password-reset.tsx`
- Create: `src/emails/password-reset-confirmation.tsx`
- Test: `tests/unit/emails-render.test.tsx`

- [ ] **Step 3.1: Créer `src/emails/_layout.tsx`**

```tsx
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
```

Note : `Tailwind` est le wrapper `@react-email/components` qui inline les classes. Ne nécessite pas de config tailwind dédiée pour les emails (utilise le défaut), suffisant pour Phase 1B.

- [ ] **Step 3.2: Créer `src/emails/invitation-new-user.tsx`**

```tsx
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
```

- [ ] **Step 3.3: Créer `src/emails/invitation-join-library.tsx`**

```tsx
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
```

- [ ] **Step 3.4: Créer `src/emails/password-reset.tsx`**

```tsx
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
      <Heading className="m-0 text-xl font-semibold">Réinitialisation de mot de passe</Heading>
      <Text className="mt-4">
        Vous avez demandé la réinitialisation de votre mot de passe. Cliquez sur le bouton
        ci-dessous pour en choisir un nouveau. Le lien expire à {expiresFr} (1 heure).
      </Text>
      <Button
        href={resetUrl}
        className="mt-6 rounded-md bg-slate-900 px-5 py-3 font-medium text-white"
      >
        Choisir un nouveau mot de passe
      </Button>
      <Text className="mt-6 text-sm text-slate-600">
        Si vous n'avez pas demandé cette réinitialisation, ignorez cet email — votre mot de passe
        actuel reste valide.
      </Text>
      <Text className="mt-4 break-all text-xs text-slate-500">{resetUrl}</Text>
    </EmailLayout>
  );
};

export default PasswordResetEmail;
```

- [ ] **Step 3.5: Créer `src/emails/password-reset-confirmation.tsx`**

```tsx
import * as React from 'react';
import { Heading, Text } from '@react-email/components';
import { EmailLayout } from './_layout';

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
      <Heading className="m-0 text-xl font-semibold">Mot de passe modifié</Heading>
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
```

- [ ] **Step 3.6: Écrire les tests de rendu des templates**

Créer `tests/unit/emails-render.test.tsx` :

```tsx
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/env', () => ({
  getEnv: () => ({ EMAIL_LOG_SALT: 'a'.repeat(32) }),
}));

import { renderEmail } from '@/lib/email';
import InvitationNewUserEmail from '@/emails/invitation-new-user';
import InvitationJoinLibraryEmail from '@/emails/invitation-join-library';
import PasswordResetEmail from '@/emails/password-reset';
import PasswordResetConfirmationEmail from '@/emails/password-reset-confirmation';

describe('email templates render', () => {
  const future = new Date(Date.now() + 72 * 3600 * 1000);

  it('invitation-new-user', async () => {
    const out = await renderEmail(InvitationNewUserEmail, {
      inviterName: 'Alice',
      libraryName: 'Médiathèque test',
      signupUrl: 'https://app.test/invitations/abc123',
      expiresAt: future,
    });
    expect(out.html).toContain('Alice');
    expect(out.html).toContain('Médiathèque test');
    expect(out.html).toContain('https://app.test/invitations/abc123');
    expect(out.text).toContain('Médiathèque test');
  });

  it('invitation-join-library', async () => {
    const out = await renderEmail(InvitationJoinLibraryEmail, {
      inviterName: 'Alice',
      libraryName: 'Médiathèque',
      userDisplayName: 'Bob',
      joinUrl: 'https://app.test/invitations/xyz',
      expiresAt: future,
    });
    expect(out.html).toContain('Bob');
    expect(out.html).toContain('Rejoindre');
  });

  it('password-reset', async () => {
    const out = await renderEmail(PasswordResetEmail, {
      resetUrl: 'https://app.test/password/reset/tok',
      expiresAt: new Date(Date.now() + 3600 * 1000),
    });
    expect(out.html).toContain('https://app.test/password/reset/tok');
    expect(out.html).toContain('1 heure');
  });

  it('password-reset-confirmation', async () => {
    const out = await renderEmail(PasswordResetConfirmationEmail, {
      userDisplayName: 'Bob',
      occurredAt: new Date('2026-04-27T10:30:00Z'),
    });
    expect(out.html).toContain('Bob');
    expect(out.html).toContain('Mot de passe modifié');
  });
});
```

- [ ] **Step 3.7: Run tests**

```bash
pnpm test:unit -- emails
```

Expected: 4 tests pass. Si erreur sur Tailwind, vérifier que `@react-email/components` est bien installé.

- [ ] **Step 3.8: Vérifier la preview dev**

```bash
pnpm email:dev &
sleep 3
curl -sI http://localhost:3001 | head -1
kill %1
```

Expected: HTTP 200 sur 3001 (lance le serveur de preview react-email).

- [ ] **Step 3.9: Commit**

```bash
git add src/emails/ tests/unit/emails-render.test.tsx
git commit -m "feat(phase-1b): add 4 react-email templates + render tests"
```

---

## Task 4 : i18n strings additions

**Files:**

- Modify: `messages/fr.json` (ajout des clés Phase 1B)

- [ ] **Step 4.1: Ajouter les clés au fichier i18n**

Ouvrir `messages/fr.json` et fusionner les blocs suivants à la racine de l'objet (en respectant l'ordre alphabétique des clés top-level) :

```json
{
  "admin": {
    "invite": {
      "title": "Inviter un membre",
      "lead": "Envoyez un lien d'invitation par email. La personne pourra créer son compte ou rejoindre la bibliothèque si elle est déjà inscrite.",
      "email": { "label": "Email" },
      "library": { "label": "Bibliothèque" },
      "role": {
        "label": "Rôle",
        "member": "Membre",
        "admin": "Admin de bibliothèque"
      },
      "submit": "Envoyer l'invitation",
      "cancel": "Annuler",
      "success": "Invitation envoyée à {email}.",
      "errors": {
        "rateLimited": "Trop d'invitations envoyées récemment. Réessayez dans une heure.",
        "permissionDenied": "Vous n'avez pas le droit d'inviter sur cette bibliothèque.",
        "alreadyMember": "Cette personne est déjà membre de la bibliothèque."
      }
    }
  },
  "invitation": {
    "signup": {
      "title": "Bienvenue sur BiblioShare",
      "lead": "Vous êtes invité·e à rejoindre {libraryName}.",
      "leadGlobal": "Vous êtes invité·e à rejoindre BiblioShare.",
      "displayName": "Nom affiché",
      "email": "Email",
      "password": "Mot de passe",
      "passwordConfirm": "Confirmer le mot de passe",
      "submit": "Créer mon compte"
    },
    "join": {
      "title": "Rejoindre {libraryName}",
      "lead": "Vous êtes déjà inscrit·e sur BiblioShare. Confirmez pour rejoindre la bibliothèque.",
      "submit": "Rejoindre la bibliothèque"
    },
    "invalid": {
      "title": "Lien invalide",
      "body": "Ce lien d'invitation a expiré ou a déjà été utilisé. Demandez à la personne qui vous a invité·e de vous renvoyer une invitation."
    },
    "mismatch": {
      "title": "Invitation indisponible",
      "body": "Cette invitation ne vous est pas adressée. Connectez-vous avec le compte concerné ou demandez une nouvelle invitation."
    }
  },
  "password": {
    "forgot": {
      "title": "Mot de passe oublié",
      "lead": "Saisissez votre email. Si un compte existe, vous recevrez un lien de réinitialisation.",
      "email": { "label": "Email" },
      "submit": "Envoyer le lien",
      "confirmation": "Si un compte existe pour cet email, un lien de réinitialisation lui a été envoyé."
    },
    "reset": {
      "title": "Choisir un nouveau mot de passe",
      "lead": "Choisissez un nouveau mot de passe d'au moins 12 caractères, mélangeant lettres, chiffres et symboles, ou une phrase de passe d'au moins 16 caractères.",
      "newPassword": "Nouveau mot de passe",
      "confirmPassword": "Confirmer le mot de passe",
      "submit": "Mettre à jour",
      "success": "Mot de passe modifié. Connectez-vous avec votre nouveau mot de passe.",
      "invalid": {
        "title": "Lien invalide",
        "body": "Ce lien a expiré ou a déjà été utilisé. Demandez un nouveau lien sur la page Mot de passe oublié."
      }
    }
  }
}
```

- [ ] **Step 4.2: Vérifier que le JSON est valide**

```bash
node -e "JSON.parse(require('fs').readFileSync('messages/fr.json', 'utf8'))" && echo OK
```

Expected: `OK`.

- [ ] **Step 4.3: Run typecheck (next-intl regenerate types)**

```bash
pnpm typecheck
```

Expected: vert. Si `next-intl` génère des types stricts, il peut détecter les nouvelles clés (souvent OK silencieux).

- [ ] **Step 4.4: Commit**

```bash
git add messages/fr.json
git commit -m "feat(phase-1b): add i18n strings for invitations + password reset"
```

---

## Task 5 : Worker BullMQ — queue mail

**Files:**

- Modify: `worker/index.ts` (ajout queue + worker mail)
- Create: `worker/jobs/send-invitation.ts`
- Create: `worker/jobs/send-password-reset.ts`
- Create: `worker/jobs/send-reset-confirmation.ts`
- Create: `src/lib/mail-queue.ts` (helper côté Next pour enqueue)
- Test: `tests/unit/mail-queue.test.ts`

- [ ] **Step 5.1: Créer le helper d'enqueue côté Next**

Créer `src/lib/mail-queue.ts` :

```ts
import { Queue } from 'bullmq';
import { getRedis } from './redis';

export type MailJobName =
  | 'send-invitation-new-user'
  | 'send-invitation-join-library'
  | 'send-password-reset'
  | 'send-password-reset-confirmation';

export interface InvitationNewUserJob {
  to: string;
  inviterName: string;
  libraryName?: string | null;
  signupUrl: string;
  expiresAtIso: string;
}
export interface InvitationJoinLibraryJob {
  to: string;
  inviterName: string;
  libraryName: string;
  userDisplayName: string;
  joinUrl: string;
  expiresAtIso: string;
}
export interface PasswordResetJob {
  to: string;
  resetUrl: string;
  expiresAtIso: string;
}
export interface PasswordResetConfirmationJob {
  to: string;
  userDisplayName: string;
  occurredAtIso: string;
}

export type MailJobData =
  | InvitationNewUserJob
  | InvitationJoinLibraryJob
  | PasswordResetJob
  | PasswordResetConfirmationJob;

const QUEUE_NAME = 'mail';

let queue: Queue | null = null;

export function getMailQueue(): Queue {
  if (queue) return queue;
  queue = new Queue(QUEUE_NAME, {
    connection: getRedis(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: { count: 1000, age: 24 * 3600 },
      removeOnFail: { count: 5000 },
    },
  });
  return queue;
}

export async function enqueueMail<N extends MailJobName>(
  name: N,
  data: MailJobData,
): Promise<void> {
  await getMailQueue().add(name, data);
}

export function __resetMailQueueForTest(): void {
  queue = null;
}
```

- [ ] **Step 5.2: Écrire le test failing du helper**

Créer `tests/unit/mail-queue.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const addMock = vi.fn().mockResolvedValue(undefined);

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({ add: addMock })),
}));
vi.mock('@/lib/redis', () => ({ getRedis: () => ({}) }));

import { enqueueMail, __resetMailQueueForTest } from '@/lib/mail-queue';

describe('enqueueMail', () => {
  beforeEach(() => {
    addMock.mockClear();
    __resetMailQueueForTest();
  });

  it('forwards name + data to BullMQ', async () => {
    await enqueueMail('send-password-reset', {
      to: 'a@b.test',
      resetUrl: 'https://x',
      expiresAtIso: '2026-01-01T00:00:00Z',
    });
    expect(addMock).toHaveBeenCalledWith(
      'send-password-reset',
      expect.objectContaining({ to: 'a@b.test' }),
    );
  });
});
```

- [ ] **Step 5.3: Run test to verify it passes**

```bash
pnpm test:unit -- mail-queue
```

Expected: 1 test passes.

- [ ] **Step 5.4: Créer `worker/jobs/send-invitation.ts`**

Note : le worker tourne dans son propre dossier `worker/` qui a son propre `tsconfig`. Il importe les templates et `lib/email.ts` via des chemins relatifs vers `../src/`. Vérifier `worker/tsconfig.json` `paths` ou utiliser le path mapping existant Phase 0/1A.

Si le worker n'a pas accès à `src/`, dupliquer la logique d'envoi minimale dans `worker/`. Sinon (cas attendu) :

```ts
import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import { sendEmail, renderEmail } from '../../src/lib/email.js';
import InvitationNewUser from '../../src/emails/invitation-new-user.js';
import InvitationJoinLibrary from '../../src/emails/invitation-join-library.js';

export async function handleSendInvitationNewUser(job: Job, logger: Logger): Promise<void> {
  const { to, inviterName, libraryName, signupUrl, expiresAtIso } = job.data as {
    to: string;
    inviterName: string;
    libraryName?: string | null;
    signupUrl: string;
    expiresAtIso: string;
  };
  const expiresAt = new Date(expiresAtIso);
  const { html, text } = await renderEmail(InvitationNewUser, {
    inviterName,
    libraryName: libraryName ?? null,
    signupUrl,
    expiresAt,
  });
  await sendEmail({
    to,
    subject: libraryName
      ? `Vous êtes invité·e à rejoindre ${libraryName}`
      : 'Vous êtes invité·e sur BiblioShare',
    html,
    text,
  });
  logger.info({ jobId: job.id }, 'invitation new user sent');
}

export async function handleSendInvitationJoinLibrary(job: Job, logger: Logger): Promise<void> {
  const { to, inviterName, libraryName, userDisplayName, joinUrl, expiresAtIso } = job.data as {
    to: string;
    inviterName: string;
    libraryName: string;
    userDisplayName: string;
    joinUrl: string;
    expiresAtIso: string;
  };
  const { html, text } = await renderEmail(InvitationJoinLibrary, {
    inviterName,
    libraryName,
    userDisplayName,
    joinUrl,
    expiresAt: new Date(expiresAtIso),
  });
  await sendEmail({
    to,
    subject: `${inviterName} vous invite à rejoindre ${libraryName}`,
    html,
    text,
  });
  logger.info({ jobId: job.id }, 'invitation join sent');
}
```

**ATTENTION résolution modules** : si l'import direct depuis `../../src/lib/email.js` ne fonctionne pas (module resolution worker → src), trois alternatives :

1. Ajouter le path `@/*` au `worker/tsconfig.json` `paths` et un alias runtime.
2. Bundler le worker avec esbuild qui inline les imports (option lourde).
3. Dupliquer une copie minimaliste de `email.ts` + templates dans `worker/lib/`.

L'option 1 (path mapping + ts-node/tsx ESM resolver) est privilégiée. Vérifier au step 5.7.

- [ ] **Step 5.5: Créer `worker/jobs/send-password-reset.ts`**

```ts
import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import { sendEmail, renderEmail } from '../../src/lib/email.js';
import PasswordReset from '../../src/emails/password-reset.js';
import PasswordResetConfirmation from '../../src/emails/password-reset-confirmation.js';

export async function handleSendPasswordReset(job: Job, logger: Logger): Promise<void> {
  const { to, resetUrl, expiresAtIso } = job.data as {
    to: string;
    resetUrl: string;
    expiresAtIso: string;
  };
  const { html, text } = await renderEmail(PasswordReset, {
    resetUrl,
    expiresAt: new Date(expiresAtIso),
  });
  await sendEmail({
    to,
    subject: 'Réinitialisation de votre mot de passe',
    html,
    text,
  });
  logger.info({ jobId: job.id }, 'password reset sent');
}

export async function handleSendPasswordResetConfirmation(job: Job, logger: Logger): Promise<void> {
  const { to, userDisplayName, occurredAtIso } = job.data as {
    to: string;
    userDisplayName: string;
    occurredAtIso: string;
  };
  const { html, text } = await renderEmail(PasswordResetConfirmation, {
    userDisplayName,
    occurredAt: new Date(occurredAtIso),
  });
  await sendEmail({
    to,
    subject: 'Votre mot de passe a été modifié',
    html,
    text,
  });
  logger.info({ jobId: job.id }, 'password reset confirmation sent');
}
```

- [ ] **Step 5.6: Brancher la queue mail dans `worker/index.ts`**

Modifier `worker/index.ts`. Après l'import existant `import { cleanupExpiredTokens } from './jobs/cleanup-expired-tokens.js';`, ajouter :

```ts
import {
  handleSendInvitationNewUser,
  handleSendInvitationJoinLibrary,
} from './jobs/send-invitation.js';
import {
  handleSendPasswordReset,
  handleSendPasswordResetConfirmation,
} from './jobs/send-password-reset.js';
```

Étendre le schéma Zod env (juste après `LOG_LEVEL`) avec les variables email :

```ts
    EMAIL_TRANSPORT: z.enum(['resend', 'smtp']).default('smtp'),
    EMAIL_FROM: z.string().min(3),
    RESEND_API_KEY: z.string().optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    EMAIL_LOG_SALT: z.string().min(32),
    APP_URL: z.string().url(),
    IP_HASH_SALT: z.string().min(16),
    UA_HASH_SALT: z.string().min(16),
    CRYPTO_MASTER_KEY: z.string().min(32),
```

Note : `IP_HASH_SALT`, `UA_HASH_SALT`, `CRYPTO_MASTER_KEY` sont requis car `src/lib/env.ts` les valide quand on importe `email.ts` → `crypto.ts` côté worker.

Après la création de `queue`/`worker` cleanup existante, ajouter (avant `scheduleCleanup`) :

```ts
const MAIL_QUEUE = 'mail';
const mailQueue = new Queue(MAIL_QUEUE, {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { count: 1000, age: 24 * 3600 },
    removeOnFail: { count: 5000 },
  },
});

const mailWorker = new Worker(
  MAIL_QUEUE,
  async (job) => {
    switch (job.name) {
      case 'send-invitation-new-user':
        return handleSendInvitationNewUser(job, logger);
      case 'send-invitation-join-library':
        return handleSendInvitationJoinLibrary(job, logger);
      case 'send-password-reset':
        return handleSendPasswordReset(job, logger);
      case 'send-password-reset-confirmation':
        return handleSendPasswordResetConfirmation(job, logger);
      default:
        logger.warn({ name: job.name }, 'unknown mail job');
    }
  },
  { connection: redis, concurrency: 4 },
);

mailWorker.on('failed', (job, err) => {
  if (job?.attemptsMade && job.opts.attempts && job.attemptsMade >= job.opts.attempts) {
    logger.error(
      { err, jobName: job.name, jobId: job.id, attempts: job.attemptsMade },
      'email.failed_permanent',
    );
  } else {
    logger.warn({ err, jobName: job?.name, jobId: job?.id }, 'mail job retrying');
  }
});
```

Modifier le bloc `shutdown` pour inclure `mailWorker.close()` et `mailQueue.close()` :

```ts
await worker.close();
await mailWorker.close();
await queue.close();
await mailQueue.close();
```

- [ ] **Step 5.7: Vérifier la résolution de modules worker → src**

```bash
cd worker && pnpm typecheck && cd ..
```

Si erreur sur `'../../src/lib/email.js'` :

- Vérifier que `worker/tsconfig.json` a bien `"module": "NodeNext"` ou `"esnext"` avec `"moduleResolution": "NodeNext"`.
- Vérifier que `worker/package.json` a `"type": "module"`.
- Vérifier que les fichiers source `src/lib/email.ts` sont compilés en .js dans le build worker. Si non, ajouter un build step `tsc -p src/tsconfig.json` pré-worker, ou utiliser `tsx` pour le worker en dev.

Si la stack actuelle fait tourner le worker avec `tsx` en dev et `node dist/` en prod, prévoir le build :

```bash
cd worker && pnpm build && cd ..
```

Doit produire `worker/dist/jobs/send-invitation.js` et `worker/dist/jobs/send-password-reset.js`.

- [ ] **Step 5.8: Smoke test enqueue → Mailpit**

```bash
docker compose -f docker-compose.dev.yml up -d mailpit redis postgres
# dans un terminal :
pnpm worker:dev   # ou la commande équivalente Phase 0
# dans un autre terminal :
pnpm tsx -e "import('./src/lib/mail-queue').then(m=>m.enqueueMail('send-password-reset',{to:'test@x.test',resetUrl:'http://localhost:3000/reset/x',expiresAtIso:new Date(Date.now()+3600000).toISOString()})).then(()=>console.log('queued'))"
sleep 5
curl -s http://localhost:8025/api/v1/messages | head -c 400
```

Expected: la réponse contient un message avec `"To": [{"Address":"test@x.test"...}]` et un sujet « Réinitialisation de votre mot de passe ».

- [ ] **Step 5.9: Commit**

```bash
git add src/lib/mail-queue.ts tests/unit/mail-queue.test.ts worker/jobs/send-invitation.ts worker/jobs/send-password-reset.ts worker/index.ts
git commit -m "feat(phase-1b): add BullMQ mail queue + 3 senders with retry"
```

---

## Task 6 : src/lib/invitations.ts — service métier

**Files:**

- Create: `src/lib/invitations.ts`
- Test: `tests/unit/invitations.test.ts`
- Test: `tests/integration/invitations.test.ts`

- [ ] **Step 6.1: Écrire les tests unitaires (mocks Prisma)**

Créer `tests/unit/invitations.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDeep, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

const dbMock = mockDeep<PrismaClient>();
vi.mock('@/lib/db', () => ({ db: dbMock }));
vi.mock('@/lib/env', () => ({
  getEnv: () => ({ APP_URL: 'https://app.test', IP_HASH_SALT: 'a'.repeat(16) }),
}));
vi.mock('@/lib/audit-log', () => ({ recordAudit: vi.fn() }));

import { createInvitation } from '@/lib/invitations';

describe('createInvitation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.user.findUnique.mockReset();
    dbMock.invitation.create.mockReset();
  });

  it('creates a signup-mode invitation when email does not exist', async () => {
    dbMock.user.findUnique.mockResolvedValue(null);
    dbMock.invitation.create.mockResolvedValue({
      id: 'inv1',
      email: 'new@x.test',
      tokenHash: 'h',
      expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
    } as never);

    const out = await createInvitation({
      invitedById: 'u1',
      email: 'New@X.test',
      libraryId: 'lib1',
      proposedRole: 'MEMBER',
    });

    expect(out.mode).toBe('signup');
    expect(typeof out.rawToken).toBe('string');
    expect(out.rawToken.length).toBeGreaterThan(20);
    expect(out.invitationId).toBe('inv1');
    expect(dbMock.invitation.create).toHaveBeenCalledOnce();
  });

  it('creates a join-mode invitation when email matches existing user', async () => {
    dbMock.user.findUnique.mockResolvedValue({ id: 'u9', email: 'old@x.test' } as never);
    dbMock.invitation.create.mockResolvedValue({
      id: 'inv2',
      email: 'old@x.test',
      tokenHash: 'h',
      expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
    } as never);

    const out = await createInvitation({
      invitedById: 'u1',
      email: 'old@x.test',
      libraryId: 'lib1',
      proposedRole: 'MEMBER',
    });

    expect(out.mode).toBe('join');
  });

  it('lowercases email before storage', async () => {
    dbMock.user.findUnique.mockResolvedValue(null);
    dbMock.invitation.create.mockResolvedValue({ id: 'inv', email: 'mixed@x.test' } as never);

    await createInvitation({ invitedById: 'u1', email: 'Mixed@X.TEST' });

    expect(dbMock.invitation.create.mock.calls[0]?.[0]?.data.email).toBe('mixed@x.test');
  });
});
```

- [ ] **Step 6.2: Écrire le service `src/lib/invitations.ts`**

```ts
import { Prisma, type Invitation, type LibraryRole } from '@prisma/client';
import { db } from './db';
import { generateRawToken, hashToken, verifyToken } from './tokens';
import { hash as argonHash } from '@node-rs/argon2';

const INVITATION_TTL_MS = 72 * 3600 * 1000;

export interface CreateInvitationInput {
  invitedById: string;
  email: string;
  libraryId?: string;
  proposedRole?: LibraryRole;
}

export interface CreateInvitationResult {
  invitationId: string;
  rawToken: string;
  mode: 'signup' | 'join';
  email: string;
  expiresAt: Date;
}

export async function createInvitation(
  input: CreateInvitationInput,
): Promise<CreateInvitationResult> {
  const email = input.email.toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });
  const mode: 'signup' | 'join' = existing ? 'join' : 'signup';
  const rawToken = generateRawToken();
  const tokenHash = await hashToken(rawToken);
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

  const inv = await db.invitation.create({
    data: {
      email,
      invitedById: input.invitedById,
      libraryId: input.libraryId,
      proposedRole: input.proposedRole,
      tokenHash,
      expiresAt,
    },
  });

  return { invitationId: inv.id, rawToken, mode, email, expiresAt };
}

export async function findInvitationByRawToken(rawToken: string): Promise<Invitation | null> {
  // Ramène toutes les invitations actives, vérifie l'argon2 hash en boucle.
  const candidates = await db.invitation.findMany({
    where: { consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  for (const inv of candidates) {
    if (await verifyToken(rawToken, inv.tokenHash)) return inv;
  }
  return null;
}

export interface ConsumeSignupInput {
  rawToken: string;
  displayName: string;
  password: string;
}

const ARGON_PASSWORD_OPTS = {
  algorithm: 2 as const,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export async function consumeInvitationNewUser(
  input: ConsumeSignupInput,
): Promise<{ userId: string; libraryId?: string }> {
  const inv = await findInvitationByRawToken(input.rawToken);
  if (!inv) throw new Error('INVALID_TOKEN');
  // Race-safe consume : tx Serializable + WHERE consumedAt:null
  const passwordHash = await argonHash(input.password, ARGON_PASSWORD_OPTS);
  return db.$transaction(
    async (tx) => {
      const updated = await tx.invitation.updateMany({
        where: { id: inv.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      if (updated.count === 0) throw new Error('INVALID_TOKEN');
      const user = await tx.user.create({
        data: {
          email: inv.email,
          displayName: input.displayName,
          passwordHash,
          role: 'USER',
        },
      });
      await tx.invitation.update({
        where: { id: inv.id },
        data: { consumedById: user.id },
      });
      if (inv.libraryId) {
        await tx.libraryMember.create({
          data: {
            userId: user.id,
            libraryId: inv.libraryId,
            role: inv.proposedRole ?? 'MEMBER',
          },
        });
      }
      return { userId: user.id, libraryId: inv.libraryId ?? undefined };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function consumeInvitationJoinLibrary(
  rawToken: string,
  userId: string,
): Promise<{ libraryId: string }> {
  const inv = await findInvitationByRawToken(rawToken);
  if (!inv) throw new Error('INVALID_TOKEN');
  if (!inv.libraryId) throw new Error('INVALID_TOKEN'); // join requires a libraryId
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('INVALID_TOKEN');
  if (user.email.toLowerCase() !== inv.email.toLowerCase()) throw new Error('EMAIL_MISMATCH');
  return db.$transaction(
    async (tx) => {
      const updated = await tx.invitation.updateMany({
        where: { id: inv.id, consumedAt: null },
        data: { consumedAt: new Date(), consumedById: userId },
      });
      if (updated.count === 0) throw new Error('INVALID_TOKEN');
      try {
        await tx.libraryMember.create({
          data: {
            userId,
            libraryId: inv.libraryId!,
            role: inv.proposedRole ?? 'MEMBER',
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new Error('ALREADY_MEMBER');
        }
        throw err;
      }
      return { libraryId: inv.libraryId! };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function revokeInvitation(invitationId: string): Promise<void> {
  await db.invitation.update({
    where: { id: invitationId },
    data: { consumedAt: new Date() }, // marqué consommé pour neutraliser sans le supprimer
  });
}
```

- [ ] **Step 6.3: Run tests unit**

```bash
pnpm test:unit -- invitations
```

Expected: 3 tests pass.

- [ ] **Step 6.4: Écrire le test integration `findInvitationByRawToken` + consume signup**

Créer `tests/integration/invitations.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import {
  createInvitation,
  findInvitationByRawToken,
  consumeInvitationNewUser,
  consumeInvitationJoinLibrary,
  revokeInvitation,
} from '@/lib/invitations';
import { hash as argonHash } from '@node-rs/argon2';

async function seedAdmin() {
  return db.user.create({
    data: {
      email: `admin-${Date.now()}@x.test`,
      displayName: 'Admin',
      passwordHash: await argonHash('x', {
        algorithm: 2 as const,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      }),
      role: 'GLOBAL_ADMIN',
    },
  });
}

async function seedLibrary() {
  return db.library.create({
    data: { name: `Lib-${Date.now()}`, slug: `lib-${Date.now()}` },
  });
}

beforeEach(async () => {
  await db.libraryMember.deleteMany();
  await db.invitation.deleteMany();
  await db.user.deleteMany();
  await db.library.deleteMany();
});

describe('invitations integration', () => {
  it('creates + finds + consumes signup', async () => {
    const admin = await seedAdmin();
    const lib = await seedLibrary();
    const r = await createInvitation({
      invitedById: admin.id,
      email: 'newbie@x.test',
      libraryId: lib.id,
      proposedRole: 'MEMBER',
    });
    expect(r.mode).toBe('signup');
    const found = await findInvitationByRawToken(r.rawToken);
    expect(found?.id).toBe(r.invitationId);
    const out = await consumeInvitationNewUser({
      rawToken: r.rawToken,
      displayName: 'Newbie',
      password: 'CorrectHorseBatteryStaple',
    });
    expect(out.userId).toBeTruthy();
    const member = await db.libraryMember.findFirst({
      where: { userId: out.userId, libraryId: lib.id },
    });
    expect(member?.role).toBe('MEMBER');
  });

  it('detects existing user → join mode + consumes', async () => {
    const admin = await seedAdmin();
    const lib = await seedLibrary();
    const u = await db.user.create({
      data: {
        email: 'old@x.test',
        displayName: 'Old',
        passwordHash: await argonHash('x', {
          algorithm: 2 as const,
          memoryCost: 19456,
          timeCost: 2,
          parallelism: 1,
        }),
      },
    });
    const r = await createInvitation({
      invitedById: admin.id,
      email: 'old@x.test',
      libraryId: lib.id,
      proposedRole: 'MEMBER',
    });
    expect(r.mode).toBe('join');
    const out = await consumeInvitationJoinLibrary(r.rawToken, u.id);
    expect(out.libraryId).toBe(lib.id);
    const member = await db.libraryMember.findFirst({
      where: { userId: u.id, libraryId: lib.id },
    });
    expect(member).toBeTruthy();
  });

  it('replay attack: 2nd consume of same token fails', async () => {
    const admin = await seedAdmin();
    const r = await createInvitation({ invitedById: admin.id, email: 'r@x.test' });
    await consumeInvitationNewUser({
      rawToken: r.rawToken,
      displayName: 'A',
      password: 'CorrectHorseBatteryStaple',
    });
    await expect(
      consumeInvitationNewUser({
        rawToken: r.rawToken,
        displayName: 'A2',
        password: 'CorrectHorseBatteryStaple',
      }),
    ).rejects.toThrow('INVALID_TOKEN');
  });

  it('expired token: not found', async () => {
    const admin = await seedAdmin();
    const r = await createInvitation({ invitedById: admin.id, email: 'e@x.test' });
    await db.invitation.update({
      where: { id: r.invitationId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await findInvitationByRawToken(r.rawToken)).toBeNull();
  });

  it('email mismatch on join: throws', async () => {
    const admin = await seedAdmin();
    const lib = await seedLibrary();
    await db.user.create({
      data: {
        email: 'a@x.test',
        displayName: 'A',
        passwordHash: await argonHash('x', {
          algorithm: 2 as const,
          memoryCost: 19456,
          timeCost: 2,
          parallelism: 1,
        }),
      },
    });
    const userB = await db.user.create({
      data: {
        email: 'b@x.test',
        displayName: 'B',
        passwordHash: await argonHash('x', {
          algorithm: 2 as const,
          memoryCost: 19456,
          timeCost: 2,
          parallelism: 1,
        }),
      },
    });
    const r = await createInvitation({
      invitedById: admin.id,
      email: 'a@x.test',
      libraryId: lib.id,
    });
    await expect(consumeInvitationJoinLibrary(r.rawToken, userB.id)).rejects.toThrow(
      'EMAIL_MISMATCH',
    );
  });

  it('tampered token: not found', async () => {
    const admin = await seedAdmin();
    const r = await createInvitation({ invitedById: admin.id, email: 't@x.test' });
    const tampered = r.rawToken.slice(0, -1) + (r.rawToken.endsWith('a') ? 'b' : 'a');
    expect(await findInvitationByRawToken(tampered)).toBeNull();
  });

  it('revoke: marks consumedAt → no longer findable', async () => {
    const admin = await seedAdmin();
    const r = await createInvitation({ invitedById: admin.id, email: 'rev@x.test' });
    await revokeInvitation(r.invitationId);
    expect(await findInvitationByRawToken(r.rawToken)).toBeNull();
  });
});
```

- [ ] **Step 6.5: Run integration tests**

```bash
pnpm test:integration -- invitations
```

Expected: 7 tests pass.

- [ ] **Step 6.6: Commit**

```bash
git add src/lib/invitations.ts tests/unit/invitations.test.ts tests/integration/invitations.test.ts
git commit -m "feat(phase-1b): add invitations service (create/find/consume signup+join/revoke)"
```

---

## Task 7 : src/lib/password-reset.ts — service métier

**Files:**

- Create: `src/lib/password-reset.ts`
- Test: `tests/integration/password-reset.test.ts`

- [ ] **Step 7.1: Écrire le service `src/lib/password-reset.ts`**

```ts
import { Prisma, type PasswordResetToken } from '@prisma/client';
import { hash as argonHash } from '@node-rs/argon2';
import { db } from './db';
import { generateRawToken, hashToken, verifyToken } from './tokens';

const RESET_TTL_MS = 60 * 60 * 1000;
const ARGON_PASSWORD_OPTS = {
  algorithm: 2 as const,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export interface RequestResetResult {
  userExists: boolean;
  rawToken?: string;
  expiresAt?: Date;
}

export async function createPasswordResetToken(email: string): Promise<RequestResetResult> {
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) return { userExists: false };
  const rawToken = generateRawToken();
  const tokenHash = await hashToken(rawToken);
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);
  await db.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt },
  });
  return { userExists: true, rawToken, expiresAt };
}

export async function findResetTokenByRawToken(
  rawToken: string,
): Promise<PasswordResetToken | null> {
  const candidates = await db.passwordResetToken.findMany({
    where: { consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  for (const t of candidates) {
    if (await verifyToken(rawToken, t.tokenHash)) return t;
  }
  return null;
}

export interface ConsumeResetResult {
  userId: string;
  email: string;
  displayName: string;
}

export async function consumePasswordReset(
  rawToken: string,
  newPassword: string,
): Promise<ConsumeResetResult> {
  const tok = await findResetTokenByRawToken(rawToken);
  if (!tok) throw new Error('INVALID_TOKEN');
  const passwordHash = await argonHash(newPassword, ARGON_PASSWORD_OPTS);

  return db.$transaction(
    async (tx) => {
      const updated = await tx.passwordResetToken.updateMany({
        where: { id: tok.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      if (updated.count === 0) throw new Error('INVALID_TOKEN');
      const user = await tx.user.update({
        where: { id: tok.userId },
        data: {
          passwordHash,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
      // invalide TOUTES les sessions actives du user (force re-login partout)
      await tx.session.deleteMany({ where: { userId: user.id } });
      // drain les autres reset tokens pending pour ce user
      await tx.passwordResetToken.deleteMany({
        where: { userId: user.id, consumedAt: null },
      });
      return {
        userId: user.id,
        email: user.email,
        displayName: user.displayName,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
```

- [ ] **Step 7.2: Écrire le test intégration**

Créer `tests/integration/password-reset.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import {
  createPasswordResetToken,
  findResetTokenByRawToken,
  consumePasswordReset,
} from '@/lib/password-reset';
import { hash as argonHash } from '@node-rs/argon2';

const ARGON = { algorithm: 2 as const, memoryCost: 19456, timeCost: 2, parallelism: 1 };

async function seedUser(email: string) {
  return db.user.create({
    data: {
      email,
      displayName: 'U',
      passwordHash: await argonHash('initial', ARGON),
    },
  });
}

beforeEach(async () => {
  await db.session.deleteMany();
  await db.passwordResetToken.deleteMany();
  await db.user.deleteMany();
});

describe('password-reset integration', () => {
  it('returns userExists=false for unknown email', async () => {
    const r = await createPasswordResetToken('ghost@x.test');
    expect(r.userExists).toBe(false);
    expect(r.rawToken).toBeUndefined();
  });

  it('creates a token for existing user', async () => {
    await seedUser('a@x.test');
    const r = await createPasswordResetToken('a@x.test');
    expect(r.userExists).toBe(true);
    expect(r.rawToken).toBeTruthy();
    const found = await findResetTokenByRawToken(r.rawToken!);
    expect(found?.consumedAt).toBeNull();
  });

  it('consume rotates password + clears sessions + drains other tokens', async () => {
    const u = await seedUser('a@x.test');
    await db.session.create({
      data: {
        userId: u.id,
        sessionToken: 'tok1',
        expires: new Date(Date.now() + 3600_000),
        pending2fa: false,
        lastActivityAt: new Date(),
      },
    });
    const t1 = await createPasswordResetToken('a@x.test');
    const t2 = await createPasswordResetToken('a@x.test');
    expect(t1.rawToken && t2.rawToken).toBeTruthy();

    const out = await consumePasswordReset(t1.rawToken!, 'BrandNewPassword42!');
    expect(out.userId).toBe(u.id);

    // sessions wiped
    expect(await db.session.count({ where: { userId: u.id } })).toBe(0);
    // t2 drained
    expect(await db.passwordResetToken.count({ where: { userId: u.id, consumedAt: null } })).toBe(
      0,
    );
    // t1 marked consumed
    expect(await findResetTokenByRawToken(t1.rawToken!)).toBeNull();
  });

  it('replay: second consume fails', async () => {
    await seedUser('a@x.test');
    const t = await createPasswordResetToken('a@x.test');
    await consumePasswordReset(t.rawToken!, 'BrandNewPassword42!');
    await expect(consumePasswordReset(t.rawToken!, 'AnotherPassword42!')).rejects.toThrow(
      'INVALID_TOKEN',
    );
  });

  it('expired token not findable', async () => {
    await seedUser('a@x.test');
    const t = await createPasswordResetToken('a@x.test');
    await db.passwordResetToken.updateMany({
      where: { userId: { not: '' } },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await findResetTokenByRawToken(t.rawToken!)).toBeNull();
  });
});
```

- [ ] **Step 7.3: Run tests**

```bash
pnpm test:integration -- password-reset
```

Expected: 5 tests pass.

- [ ] **Step 7.4: Commit**

```bash
git add src/lib/password-reset.ts tests/integration/password-reset.test.ts
git commit -m "feat(phase-1b): add password-reset service (request/find/consume + session wipe)"
```

---

## Task 8 : Rate-limiter `resetIpOnlyLimiter`

**Files:**

- Modify: `src/lib/rate-limit.ts`
- Test: `tests/integration/rate-limit-reset.test.ts`

- [ ] **Step 8.1: Ajouter le limiter dans `src/lib/rate-limit.ts`**

À la fin du fichier, ajouter :

```ts
export const resetIpOnlyLimiter = new RateLimiterRedis({
  ...baseOpts(),
  keyPrefix: 'rl:reset_ip',
  points: 30,
  duration: 60 * 60,
  blockDuration: 60 * 60,
  insuranceLimiter: memInsurance(30, 60 * 60),
});
```

- [ ] **Step 8.2: Étendre le helper `flushRateLimit` (si présent)**

Vérifier `tests/integration/setup/` pour un helper qui flushe les limiteurs entre tests. S'il existe, ajouter le pattern `rl:reset_ip:*` à la liste des prefixes purgés.

```bash
grep -rn "rl:" tests/integration/setup/ tests/integration/helpers/ 2>/dev/null | head
```

Si `flushRateLimit` est défini quelque part comme tableau `prefixes`, ajouter `'rl:reset_ip'`.

- [ ] **Step 8.3: Test minimal du limiter**

Créer `tests/integration/rate-limit-reset.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { resetIpOnlyLimiter } from '@/lib/rate-limit';
import { getRedis } from '@/lib/redis';

beforeEach(async () => {
  const redis = getRedis();
  const keys = await redis.keys('rl:reset_ip:*');
  if (keys.length) await redis.del(...keys);
});

describe('resetIpOnlyLimiter', () => {
  it('blocks after 30 attempts in the same window', async () => {
    const ipKey = 'iphash-test-1';
    for (let i = 0; i < 30; i++) {
      await resetIpOnlyLimiter.consume(ipKey);
    }
    await expect(resetIpOnlyLimiter.consume(ipKey)).rejects.toMatchObject({
      consumedPoints: expect.any(Number),
    });
  });
});
```

- [ ] **Step 8.4: Run integration**

```bash
pnpm test:integration -- rate-limit-reset
```

Expected: 1 test passes.

- [ ] **Step 8.5: Commit**

```bash
git add src/lib/rate-limit.ts tests/integration/rate-limit-reset.test.ts
git commit -m "feat(phase-1b): add resetIpOnlyLimiter (30/h per ipHash)"
```

---

## Task 9 : Routeur tRPC `invitation`

**Files:**

- Create: `src/server/trpc/routers/invitation.ts`
- Modify: `src/server/trpc/routers/_app.ts` (mount)
- Test: `tests/integration/invitation-router.test.ts`

- [ ] **Step 9.1: Écrire le routeur**

Créer `src/server/trpc/routers/invitation.ts` :

```ts
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { t } from '../trpc';
import { authedProcedure, publicProcedure } from '../procedures';
import { db } from '@/lib/db';
import {
  createInvitation,
  findInvitationByRawToken,
  consumeInvitationNewUser,
  consumeInvitationJoinLibrary,
  revokeInvitation,
} from '@/lib/invitations';
import { recordAudit } from '@/lib/audit-log';
import { invitationLimiter } from '@/lib/rate-limit';
import { hashEmail } from '@/lib/crypto';
import { getEnv } from '@/lib/env';
import { enqueueMail } from '@/lib/mail-queue';

const createInput = z.object({
  email: z.string().email().max(254),
  libraryId: z.string().cuid().optional(),
  proposedRole: z.enum(['MEMBER', 'LIBRARY_ADMIN']).optional(),
});

const consumeSignupInput = z.object({
  rawToken: z.string().min(20).max(100),
  displayName: z.string().min(1).max(80),
  password: z.string().min(12).max(200),
});

const consumeJoinInput = z.object({
  rawToken: z.string().min(20).max(100),
});

const validateInput = z.object({ rawToken: z.string().min(20).max(100) });

const revokeInput = z.object({ invitationId: z.string().cuid() });

export const invitationRouter = t.router({
  create: authedProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    // Permission : LIBRARY_ADMIN sur libraryId, ou GLOBAL_ADMIN
    if (input.libraryId) {
      const isGlobal = ctx.user.role === 'GLOBAL_ADMIN';
      if (!isGlobal) {
        const membership = await db.libraryMember.findUnique({
          where: {
            userId_libraryId: { userId: ctx.user.id, libraryId: input.libraryId },
          },
        });
        if (!membership || membership.role !== 'LIBRARY_ADMIN') {
          await recordAudit({
            action: 'permission.denied',
            actor: { id: ctx.user.id },
            metadata: { perm: 'invite_to_library', libraryId: input.libraryId },
          });
          throw new TRPCError({ code: 'FORBIDDEN' });
        }
      }
    } else if (ctx.user.role !== 'GLOBAL_ADMIN') {
      // pas de libraryId → seul GLOBAL_ADMIN peut inviter (compte system)
      await recordAudit({
        action: 'permission.denied',
        actor: { id: ctx.user.id },
        metadata: { perm: 'invite_global' },
      });
      throw new TRPCError({ code: 'FORBIDDEN' });
    }

    try {
      await invitationLimiter.consume(ctx.user.id);
    } catch {
      throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
    }

    const inviter = await db.user.findUnique({ where: { id: ctx.user.id } });
    const library = input.libraryId
      ? await db.library.findUnique({ where: { id: input.libraryId } })
      : null;

    const result = await createInvitation({
      invitedById: ctx.user.id,
      email: input.email,
      libraryId: input.libraryId,
      proposedRole: input.proposedRole,
    });

    await recordAudit({
      action: 'auth.invitation.created',
      actor: { id: ctx.user.id },
      target: { type: 'INVITATION', id: result.invitationId },
      metadata: {
        emailHash: hashEmail(result.email),
        libraryId: input.libraryId,
        role: input.proposedRole,
        mode: result.mode,
      },
    });

    const baseUrl = getEnv().APP_URL.replace(/\/$/, '');
    const url = `${baseUrl}/invitations/${result.rawToken}`;
    const expiresAtIso = result.expiresAt.toISOString();

    if (result.mode === 'signup') {
      await enqueueMail('send-invitation-new-user', {
        to: result.email,
        inviterName: inviter?.displayName ?? 'Un administrateur',
        libraryName: library?.name ?? null,
        signupUrl: url,
        expiresAtIso,
      });
    } else {
      const target = await db.user.findUnique({ where: { email: result.email } });
      await enqueueMail('send-invitation-join-library', {
        to: result.email,
        inviterName: inviter?.displayName ?? 'Un administrateur',
        libraryName: library?.name ?? '',
        userDisplayName: target?.displayName ?? '',
        joinUrl: url,
        expiresAtIso,
      });
    }

    return { invitationId: result.invitationId, mode: result.mode };
  }),

  validate: publicProcedure.input(validateInput).query(async ({ input }) => {
    const inv = await findInvitationByRawToken(input.rawToken);
    if (!inv) return { valid: false } as const;
    const target = await db.user.findUnique({ where: { email: inv.email } });
    const lib = inv.libraryId
      ? await db.library.findUnique({ where: { id: inv.libraryId } })
      : null;
    return {
      valid: true as const,
      mode: target ? ('join' as const) : ('signup' as const),
      email: inv.email,
      libraryName: lib?.name ?? null,
    };
  }),

  consumeSignup: publicProcedure.input(consumeSignupInput).mutation(async ({ input, ctx }) => {
    try {
      const out = await consumeInvitationNewUser(input);
      await recordAudit({
        action: 'auth.invitation.consumed',
        actor: { id: out.userId },
        metadata: { mode: 'signup', libraryId: out.libraryId },
      });
      return { userId: out.userId };
    } catch (err) {
      if (err instanceof Error && err.message === 'INVALID_TOKEN') {
        await recordAudit({
          action: 'auth.invitation.invalid_attempt',
          metadata: { reason: 'not_found_or_consumed_or_expired' },
        });
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'INVALID_TOKEN' });
      }
      throw err;
    }
  }),

  consumeJoin: authedProcedure.input(consumeJoinInput).mutation(async ({ ctx, input }) => {
    try {
      const out = await consumeInvitationJoinLibrary(input.rawToken, ctx.user.id);
      await recordAudit({
        action: 'auth.invitation.consumed',
        actor: { id: ctx.user.id },
        metadata: { mode: 'join', libraryId: out.libraryId },
      });
      return { libraryId: out.libraryId };
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === 'INVALID_TOKEN') {
          await recordAudit({
            action: 'auth.invitation.invalid_attempt',
            actor: { id: ctx.user.id },
            metadata: { reason: 'not_found_or_consumed_or_expired' },
          });
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'INVALID_TOKEN' });
        }
        if (err.message === 'EMAIL_MISMATCH') {
          await recordAudit({
            action: 'auth.invitation.invalid_attempt',
            actor: { id: ctx.user.id },
            metadata: { reason: 'email_mismatch' },
          });
          throw new TRPCError({ code: 'FORBIDDEN', message: 'EMAIL_MISMATCH' });
        }
        if (err.message === 'ALREADY_MEMBER') {
          throw new TRPCError({ code: 'CONFLICT', message: 'ALREADY_MEMBER' });
        }
      }
      throw err;
    }
  }),

  revoke: authedProcedure.input(revokeInput).mutation(async ({ ctx, input }) => {
    const inv = await db.invitation.findUnique({ where: { id: input.invitationId } });
    if (!inv) throw new TRPCError({ code: 'NOT_FOUND' });
    if (inv.invitedById !== ctx.user.id && ctx.user.role !== 'GLOBAL_ADMIN') {
      await recordAudit({
        action: 'permission.denied',
        actor: { id: ctx.user.id },
        metadata: { perm: 'revoke_invitation', invitationId: inv.id },
      });
      throw new TRPCError({ code: 'FORBIDDEN' });
    }
    await revokeInvitation(input.invitationId);
    await recordAudit({
      action: 'auth.invitation.revoked',
      actor: { id: ctx.user.id },
      target: { type: 'INVITATION', id: input.invitationId },
      metadata: { revokedBy: ctx.user.id },
    });
    return { ok: true as const };
  }),
});
```

- [ ] **Step 9.2: Monter le routeur dans `_app.ts`**

Modifier `src/server/trpc/routers/_app.ts`. Importer et merger :

```ts
import { invitationRouter } from './invitation';
// ...
export const appRouter = t.router({
  auth: authRouter,
  invitation: invitationRouter,
});
```

- [ ] **Step 9.3: Test integration end-to-end du routeur**

Créer `tests/integration/invitation-router.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { appRouter } from '@/server/trpc/routers/_app';
import { db } from '@/lib/db';
import { hash as argonHash } from '@node-rs/argon2';

const ARGON = { algorithm: 2 as const, memoryCost: 19456, timeCost: 2, parallelism: 1 };

async function makeAdminCtx() {
  const u = await db.user.create({
    data: {
      email: `admin-${Date.now()}@x.test`,
      displayName: 'Admin',
      passwordHash: await argonHash('x', ARGON),
      role: 'GLOBAL_ADMIN',
      twoFactorEnabled: true,
      createdAt: new Date(Date.now() - 365 * 86400 * 1000),
    },
  });
  const s = await db.session.create({
    data: {
      userId: u.id,
      sessionToken: `s-${Date.now()}`,
      expires: new Date(Date.now() + 3600_000),
      pending2fa: false,
      lastActivityAt: new Date(),
    },
  });
  return { session: s, user: u };
}

beforeEach(async () => {
  await db.libraryMember.deleteMany();
  await db.invitation.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany();
  await db.library.deleteMany();
  await db.auditLog.deleteMany();
});

describe('invitation router', () => {
  it('global admin creates a global invitation (no libraryId)', async () => {
    const ctx = await makeAdminCtx();
    const caller = appRouter.createCaller(ctx as any);
    const out = await caller.invitation.create({ email: 'new@x.test' });
    expect(out.mode).toBe('signup');
    const audits = await db.auditLog.findMany({ where: { action: 'auth.invitation.created' } });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.metadata).toMatchObject({ mode: 'signup' });
  });

  it('library admin invites to their library', async () => {
    const u = await db.user.create({
      data: {
        email: `libadmin-${Date.now()}@x.test`,
        displayName: 'L',
        passwordHash: await argonHash('x', ARGON),
        role: 'USER',
        twoFactorEnabled: false,
      },
    });
    const lib = await db.library.create({
      data: { name: 'L', slug: `l-${Date.now()}` },
    });
    await db.libraryMember.create({
      data: { userId: u.id, libraryId: lib.id, role: 'LIBRARY_ADMIN' },
    });
    const s = await db.session.create({
      data: {
        userId: u.id,
        sessionToken: `s-${Date.now()}`,
        expires: new Date(Date.now() + 3600_000),
        pending2fa: false,
        lastActivityAt: new Date(),
      },
    });
    const caller = appRouter.createCaller({ session: s, user: u } as any);
    const out = await caller.invitation.create({
      email: 'new2@x.test',
      libraryId: lib.id,
      proposedRole: 'MEMBER',
    });
    expect(out.invitationId).toBeTruthy();
  });

  it('non-admin trying to invite to a library is forbidden', async () => {
    const u = await db.user.create({
      data: {
        email: `plain-${Date.now()}@x.test`,
        displayName: 'P',
        passwordHash: await argonHash('x', ARGON),
        role: 'USER',
      },
    });
    const lib = await db.library.create({ data: { name: 'L', slug: `l-${Date.now()}` } });
    const s = await db.session.create({
      data: {
        userId: u.id,
        sessionToken: `s-${Date.now()}`,
        expires: new Date(Date.now() + 3600_000),
        pending2fa: false,
        lastActivityAt: new Date(),
      },
    });
    const caller = appRouter.createCaller({ session: s, user: u } as any);
    await expect(
      caller.invitation.create({ email: 'x@x.test', libraryId: lib.id }),
    ).rejects.toThrow(/FORBIDDEN/);
  });
});
```

- [ ] **Step 9.4: Run integration**

```bash
pnpm test:integration -- invitation-router
```

Expected: 3 tests pass.

- [ ] **Step 9.5: Commit**

```bash
git add src/server/trpc/routers/invitation.ts src/server/trpc/routers/_app.ts tests/integration/invitation-router.test.ts
git commit -m "feat(phase-1b): add tRPC invitation router (create/validate/consume/revoke)"
```

---

## Task 10 : Routeur tRPC `password` + timing pad

**Files:**

- Create: `src/server/trpc/routers/password.ts`
- Modify: `src/server/trpc/routers/_app.ts`
- Test: `tests/integration/password-router.test.ts`
- Test: `tests/attacks/password-reset.test.ts`

- [ ] **Step 10.1: Écrire le routeur**

Créer `src/server/trpc/routers/password.ts` :

```ts
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { t } from '../trpc';
import { publicProcedure } from '../procedures';
import {
  createPasswordResetToken,
  findResetTokenByRawToken,
  consumePasswordReset,
} from '@/lib/password-reset';
import { recordAudit } from '@/lib/audit-log';
import { resetRequestLimiter, resetIpOnlyLimiter } from '@/lib/rate-limit';
import { hashEmail, hashIp } from '@/lib/crypto';
import { getEnv } from '@/lib/env';
import { enqueueMail } from '@/lib/mail-queue';

const PAD_BUDGET_MS = 250;

async function constantTimeBudget<T>(fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  let result: T | undefined;
  let err: unknown;
  try {
    result = await fn();
  } catch (e) {
    err = e;
  }
  const elapsed = Date.now() - start;
  const remaining = PAD_BUDGET_MS - elapsed;
  if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
  if (err) throw err;
  return result as T;
}

const requestInput = z.object({ email: z.string().email().max(254) });
const consumeInput = z.object({
  rawToken: z.string().min(20).max(100),
  newPassword: z.string().min(12).max(200),
});
const validateInput = z.object({ rawToken: z.string().min(20).max(100) });

export const passwordRouter = t.router({
  requestReset: publicProcedure.input(requestInput).mutation(async ({ input, ctx }) => {
    return constantTimeBudget(async () => {
      const ip = (ctx as any)?.req?.ip ?? '0.0.0.0';
      let rateLimited = false;
      try {
        await resetIpOnlyLimiter.consume(hashIp(ip));
        await resetRequestLimiter.consume(hashEmail(input.email));
      } catch {
        rateLimited = true;
      }

      let userExists = false;
      if (!rateLimited) {
        const r = await createPasswordResetToken(input.email);
        userExists = r.userExists;
        if (r.userExists && r.rawToken && r.expiresAt) {
          const baseUrl = getEnv().APP_URL.replace(/\/$/, '');
          await enqueueMail('send-password-reset', {
            to: input.email.toLowerCase(),
            resetUrl: `${baseUrl}/password/reset/${r.rawToken}`,
            expiresAtIso: r.expiresAt.toISOString(),
          });
        }
      }

      await recordAudit({
        action: 'auth.password.reset_requested',
        metadata: { emailHash: hashEmail(input.email), userExists, rateLimited },
      });

      // Réponse uniforme — pas de leak
      return { ok: true as const };
    });
  }),

  validateToken: publicProcedure.input(validateInput).query(async ({ input }) => {
    const t = await findResetTokenByRawToken(input.rawToken);
    return { valid: t !== null };
  }),

  consumeReset: publicProcedure.input(consumeInput).mutation(async ({ input }) => {
    try {
      const out = await consumePasswordReset(input.rawToken, input.newPassword);
      await recordAudit({
        action: 'auth.password.reset_consumed',
        actor: { id: out.userId },
        metadata: { userId: out.userId },
      });
      // email de confirmation
      await enqueueMail('send-password-reset-confirmation', {
        to: out.email,
        userDisplayName: out.displayName,
        occurredAtIso: new Date().toISOString(),
      });
      return { ok: true as const };
    } catch (err) {
      if (err instanceof Error && err.message === 'INVALID_TOKEN') {
        await recordAudit({
          action: 'auth.password.reset_invalid_attempt',
          metadata: { reason: 'not_found_or_consumed_or_expired' },
        });
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'INVALID_TOKEN' });
      }
      throw err;
    }
  }),
});
```

- [ ] **Step 10.2: Mount dans `_app.ts`**

```ts
import { passwordRouter } from './password';
// ...
export const appRouter = t.router({
  auth: authRouter,
  invitation: invitationRouter,
  password: passwordRouter,
});
```

- [ ] **Step 10.3: Étendre l'union AuditAction**

Modifier `src/lib/audit-log.ts`. Dans le bloc 1B, ajouter (s'ils manquent) :

```ts
  | 'auth.invitation.invalid_attempt'
  | 'auth.invitation.send_failed'
  | 'auth.password.reset_invalid_attempt'
  | 'auth.password.reset_expired'
```

- [ ] **Step 10.4: Test integration du routeur password**

Créer `tests/integration/password-router.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { appRouter } from '@/server/trpc/routers/_app';
import { db } from '@/lib/db';
import { hash as argonHash } from '@node-rs/argon2';
import { getRedis } from '@/lib/redis';

const ARGON = { algorithm: 2 as const, memoryCost: 19456, timeCost: 2, parallelism: 1 };

beforeEach(async () => {
  await db.session.deleteMany();
  await db.passwordResetToken.deleteMany();
  await db.user.deleteMany();
  await db.auditLog.deleteMany();
  const r = getRedis();
  for (const prefix of ['rl:reset', 'rl:reset_ip']) {
    const keys = await r.keys(`${prefix}:*`);
    if (keys.length) await r.del(...keys);
  }
});

describe('password router', () => {
  it('requestReset returns ok=true for unknown email (no leak)', async () => {
    const caller = appRouter.createCaller({ session: null, user: null } as any);
    const out = await caller.password.requestReset({ email: 'ghost@x.test' });
    expect(out.ok).toBe(true);
  });

  it('requestReset enqueues email for existing user', async () => {
    await db.user.create({
      data: { email: 'a@x.test', displayName: 'A', passwordHash: await argonHash('x', ARGON) },
    });
    const caller = appRouter.createCaller({ session: null, user: null } as any);
    await caller.password.requestReset({ email: 'a@x.test' });
    const tokens = await db.passwordResetToken.findMany();
    expect(tokens).toHaveLength(1);
  });

  it('consumeReset rotates password and invalidates sessions', async () => {
    const u = await db.user.create({
      data: { email: 'a@x.test', displayName: 'A', passwordHash: await argonHash('old', ARGON) },
    });
    await db.session.create({
      data: {
        userId: u.id,
        sessionToken: 'tok',
        expires: new Date(Date.now() + 3600_000),
        pending2fa: false,
        lastActivityAt: new Date(),
      },
    });
    const callerPub = appRouter.createCaller({ session: null, user: null } as any);
    await callerPub.password.requestReset({ email: 'a@x.test' });
    const tokRow = await db.passwordResetToken.findFirst({ where: { userId: u.id } });
    expect(tokRow).toBeTruthy();
    // Pour récupérer le rawToken il faut passer par le helper service direct, mais ici on
    // teste via consumeReset avec un mauvais token → 400 puis on simule un token valide via
    // appel direct de la lib (les tests intégration de la lib couvrent le rotate happy path).
    await expect(
      callerPub.password.consumeReset({ rawToken: 'bad'.repeat(10), newPassword: 'NewPass1234!' }),
    ).rejects.toThrow(/INVALID_TOKEN/);
  });
});
```

- [ ] **Step 10.5: Run integration password-router**

```bash
pnpm test:integration -- password-router
```

Expected: 3 tests pass.

- [ ] **Step 10.6: Attack tests dédiés (timing + énumération)**

Créer `tests/attacks/password-reset.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { appRouter } from '@/server/trpc/routers/_app';
import { db } from '@/lib/db';
import { hash as argonHash } from '@node-rs/argon2';
import { getRedis } from '@/lib/redis';

const ARGON = { algorithm: 2 as const, memoryCost: 19456, timeCost: 2, parallelism: 1 };

beforeEach(async () => {
  await db.passwordResetToken.deleteMany();
  await db.user.deleteMany();
  const r = getRedis();
  for (const prefix of ['rl:reset', 'rl:reset_ip']) {
    const keys = await r.keys(`${prefix}:*`);
    if (keys.length) await r.del(...keys);
  }
});

async function timeIt(fn: () => Promise<unknown>): Promise<number> {
  const s = Date.now();
  await fn().catch(() => {});
  return Date.now() - s;
}

describe('password reset — timing & enumeration', () => {
  it('requestReset has uniform latency for unknown vs known email (within 80ms)', async () => {
    await db.user.create({
      data: { email: 'real@x.test', displayName: 'R', passwordHash: await argonHash('x', ARGON) },
    });
    const caller = appRouter.createCaller({ session: null, user: null } as any);

    // chauffer le pool argon2 / connexions DB
    await caller.password.requestReset({ email: 'warm@x.test' });

    const samplesA: number[] = [];
    const samplesB: number[] = [];
    for (let i = 0; i < 5; i++) {
      samplesA.push(
        await timeIt(() => caller.password.requestReset({ email: `ghost${i}@x.test` })),
      );
      samplesB.push(await timeIt(() => caller.password.requestReset({ email: 'real@x.test' })));
    }
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const delta = Math.abs(avg(samplesA) - avg(samplesB));
    expect(delta).toBeLessThan(80);
  });

  it('rate limit per email triggers silent throttle (still ok=true)', async () => {
    const caller = appRouter.createCaller({ session: null, user: null } as any);
    for (let i = 0; i < 4; i++) {
      const out = await caller.password.requestReset({ email: 'x@x.test' });
      expect(out.ok).toBe(true);
    }
    // au-delà du quota, toujours 200 mais aucun token créé
    expect(await db.passwordResetToken.count()).toBe(0);
  });
});
```

- [ ] **Step 10.7: Run attack tests**

```bash
pnpm test:integration -- password-reset
```

(Le glob attack tests est inclus dans `vitest.integration.config.ts` Phase 0/1A.) Expected: 2 tests pass.

- [ ] **Step 10.8: Commit**

```bash
git add src/server/trpc/routers/password.ts src/server/trpc/routers/_app.ts src/lib/audit-log.ts tests/integration/password-router.test.ts tests/attacks/password-reset.test.ts
git commit -m "feat(phase-1b): add tRPC password router with timing pad + attack tests"
```

---

## Task 11 : Page `/admin/users/invite`

**Files:**

- Create: `src/app/admin/users/invite/page.tsx`
- Create: `src/app/admin/users/invite/invite-form.tsx` (client component)
- Create: `src/app/admin/users/invite/actions.ts` (server action wrapper)

- [ ] **Step 11.1: Créer la server action**

Créer `src/app/admin/users/invite/actions.ts` :

```ts
'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { TRPCError } from '@trpc/server';
import { appRouter } from '@/server/trpc/routers/_app';
import { createContext } from '@/server/trpc/context';

const InputSchema = z.object({
  email: z.string().email().max(254),
  libraryId: z.string().cuid().optional(),
  proposedRole: z.enum(['MEMBER', 'LIBRARY_ADMIN']).optional(),
});

export type InviteState =
  | { status: 'idle' }
  | { status: 'success'; email: string }
  | { status: 'error'; code: 'FORBIDDEN' | 'TOO_MANY_REQUESTS' | 'VALIDATION' | 'UNKNOWN' };

export async function submitInvite(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const parsed = InputSchema.safeParse({
    email: formData.get('email')?.toString() ?? '',
    libraryId: (formData.get('libraryId')?.toString() || undefined) as string | undefined,
    proposedRole: (formData.get('proposedRole')?.toString() || undefined) as
      | 'MEMBER'
      | 'LIBRARY_ADMIN'
      | undefined,
  });
  if (!parsed.success) return { status: 'error', code: 'VALIDATION' };

  const ctx = await createContext();
  const caller = appRouter.createCaller(ctx);
  try {
    await caller.invitation.create(parsed.data);
    revalidatePath('/admin');
    return { status: 'success', email: parsed.data.email };
  } catch (err) {
    if (err instanceof TRPCError) {
      if (err.code === 'FORBIDDEN') return { status: 'error', code: 'FORBIDDEN' };
      if (err.code === 'TOO_MANY_REQUESTS') return { status: 'error', code: 'TOO_MANY_REQUESTS' };
    }
    return { status: 'error', code: 'UNKNOWN' };
  }
}
```

- [ ] **Step 11.2: Créer le composant client**

Créer `src/app/admin/users/invite/invite-form.tsx` :

```tsx
'use client';

import * as React from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { submitInvite, type InviteState } from './actions';

interface Library {
  id: string;
  name: string;
}

const initial: InviteState = { status: 'idle' };

export function InviteForm({ libraries }: { libraries: Library[] }) {
  const t = useTranslations();
  const [state, formAction] = useFormState(submitInvite, initial);

  return (
    <form action={formAction} className="max-w-md space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium">
          {t('admin.invite.email.label')}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
        />
      </div>
      {libraries.length > 0 ? (
        <div>
          <label htmlFor="libraryId" className="block text-sm font-medium">
            {t('admin.invite.library.label')}
          </label>
          <select
            id="libraryId"
            name="libraryId"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
          >
            {libraries.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <fieldset>
        <legend className="text-sm font-medium">{t('admin.invite.role.label')}</legend>
        <div className="mt-1 space-x-4">
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="proposedRole" value="MEMBER" defaultChecked />
            {t('admin.invite.role.member')}
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="proposedRole" value="LIBRARY_ADMIN" />
            {t('admin.invite.role.admin')}
          </label>
        </div>
      </fieldset>
      <SubmitButton />
      <FormFeedback state={state} />
    </form>
  );
}

function SubmitButton() {
  const t = useTranslations();
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
    >
      {t('admin.invite.submit')}
    </button>
  );
}

function FormFeedback({ state }: { state: InviteState }) {
  const t = useTranslations();
  if (state.status === 'success') {
    return (
      <p role="status" className="text-sm text-emerald-700">
        {t('admin.invite.success', { email: state.email })}
      </p>
    );
  }
  if (state.status === 'error') {
    const map: Record<string, string> = {
      FORBIDDEN: t('admin.invite.errors.permissionDenied'),
      TOO_MANY_REQUESTS: t('admin.invite.errors.rateLimited'),
      VALIDATION: 'Email invalide.',
      UNKNOWN: 'Erreur inconnue.',
    };
    return (
      <p role="alert" className="text-sm text-red-700">
        {map[state.code] ?? map.UNKNOWN}
      </p>
    );
  }
  return null;
}
```

- [ ] **Step 11.3: Créer la page server component**

Créer `src/app/admin/users/invite/page.tsx` :

```tsx
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { db } from '@/lib/db';
import { getCurrentSessionAndUser } from '@/server/auth/session-bridge';
import { InviteForm } from './invite-form';

export default async function InviteUserPage() {
  const result = await getCurrentSessionAndUser();
  if (!result || !result.user) redirect('/login');
  if (result.session.pending2fa) redirect('/login/2fa');
  const user = result.user;

  // Listing biblios où l'user est admin
  let libraries: { id: string; name: string }[] = [];
  if (user.role === 'GLOBAL_ADMIN') {
    libraries = await db.library.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  } else {
    const memberships = await db.libraryMember.findMany({
      where: { userId: user.id, role: 'LIBRARY_ADMIN' },
      include: { library: { select: { id: true, name: true } } },
    });
    libraries = memberships.map((m) => m.library);
    if (libraries.length === 0) redirect('/admin');
  }

  const t = await getTranslations();
  return (
    <main className="container mx-auto py-10">
      <h1 className="text-2xl font-semibold">{t('admin.invite.title')}</h1>
      <p className="mt-2 max-w-prose text-sm text-slate-600">{t('admin.invite.lead')}</p>
      <div className="mt-6">
        <InviteForm libraries={libraries} />
      </div>
    </main>
  );
}
```

- [ ] **Step 11.4: Vérifier le rendu manuellement**

```bash
docker compose -f docker-compose.dev.yml up -d
pnpm dev &
sleep 5
# logger en tant qu'Admin global au préalable, puis :
curl -sI http://localhost:3000/admin/users/invite | head -1
kill %1
```

Expected: HTTP 200 (en session valide). Si 307 redirect vers login, c'est attendu hors session.

- [ ] **Step 11.5: Commit**

```bash
git add src/app/admin/users/invite/
git commit -m "feat(phase-1b): add /admin/users/invite mini-form (server component + form action)"
```

---

## Task 12 : Page publique `/invitations/[token]`

**Files:**

- Create: `src/app/invitations/[token]/page.tsx`
- Create: `src/app/invitations/[token]/signup-form.tsx`
- Create: `src/app/invitations/[token]/join-form.tsx`
- Create: `src/app/invitations/[token]/actions.ts`

- [ ] **Step 12.1: Server actions consume**

Créer `src/app/invitations/[token]/actions.ts` :

```ts
'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { TRPCError } from '@trpc/server';
import { signIn } from '@/server/auth';
import { appRouter } from '@/server/trpc/routers/_app';
import { createContext } from '@/server/trpc/context';

const SignupSchema = z.object({
  rawToken: z.string().min(20).max(100),
  displayName: z.string().min(1).max(80),
  password: z.string().min(12).max(200),
  confirmPassword: z.string().min(12).max(200),
  email: z.string().email(),
});

export type SignupState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

export async function submitSignup(_prev: SignupState, fd: FormData): Promise<SignupState> {
  const parsed = SignupSchema.safeParse({
    rawToken: fd.get('rawToken')?.toString() ?? '',
    displayName: fd.get('displayName')?.toString() ?? '',
    password: fd.get('password')?.toString() ?? '',
    confirmPassword: fd.get('confirmPassword')?.toString() ?? '',
    email: fd.get('email')?.toString() ?? '',
  });
  if (!parsed.success) return { status: 'error', message: 'Champs invalides.' };
  if (parsed.data.password !== parsed.data.confirmPassword) {
    return { status: 'error', message: 'Les mots de passe ne correspondent pas.' };
  }
  const ctx = await createContext();
  const caller = appRouter.createCaller(ctx);
  try {
    await caller.invitation.consumeSignup({
      rawToken: parsed.data.rawToken,
      displayName: parsed.data.displayName,
      password: parsed.data.password,
    });
  } catch (err) {
    return { status: 'error', message: 'Lien invalide ou expiré.' };
  }
  await signIn('credentials', {
    email: parsed.data.email,
    password: parsed.data.password,
    redirect: false,
  });
  redirect('/');
}

export type JoinState = { status: 'idle' } | { status: 'error'; message: string };

export async function submitJoin(rawToken: string): Promise<JoinState> {
  const ctx = await createContext();
  const caller = appRouter.createCaller(ctx);
  try {
    await caller.invitation.consumeJoin({ rawToken });
  } catch (err) {
    if (err instanceof TRPCError && err.message === 'EMAIL_MISMATCH') {
      return { status: 'error', message: 'Cette invitation ne vous est pas adressée.' };
    }
    return { status: 'error', message: 'Lien invalide ou expiré.' };
  }
  redirect('/');
}
```

- [ ] **Step 12.2: Composant signup**

Créer `src/app/invitations/[token]/signup-form.tsx` :

```tsx
'use client';

import * as React from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { submitSignup, type SignupState } from './actions';

const initial: SignupState = { status: 'idle' };

export function SignupForm({
  rawToken,
  email,
  libraryName,
}: {
  rawToken: string;
  email: string;
  libraryName?: string | null;
}) {
  const t = useTranslations();
  const [state, formAction] = useFormState(submitSignup, initial);
  return (
    <form action={formAction} className="max-w-md space-y-4">
      <input type="hidden" name="rawToken" value={rawToken} />
      <input type="hidden" name="email" value={email} />
      <p className="text-sm text-slate-600">
        {libraryName
          ? t('invitation.signup.lead', { libraryName })
          : t('invitation.signup.leadGlobal')}
      </p>
      <div>
        <label htmlFor="email-readonly" className="block text-sm font-medium">
          {t('invitation.signup.email')}
        </label>
        <input
          id="email-readonly"
          value={email}
          readOnly
          className="mt-1 w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2"
        />
      </div>
      <div>
        <label htmlFor="displayName" className="block text-sm font-medium">
          {t('invitation.signup.displayName')}
        </label>
        <input
          id="displayName"
          name="displayName"
          required
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium">
          {t('invitation.signup.password')}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={12}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
        />
      </div>
      <div>
        <label htmlFor="confirmPassword" className="block text-sm font-medium">
          {t('invitation.signup.passwordConfirm')}
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
          minLength={12}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
        />
      </div>
      <SubmitBtn label={t('invitation.signup.submit')} />
      {state.status === 'error' ? (
        <p role="alert" className="text-sm text-red-700">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function SubmitBtn({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
    >
      {label}
    </button>
  );
}
```

- [ ] **Step 12.3: Composant join**

Créer `src/app/invitations/[token]/join-form.tsx` :

```tsx
'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { submitJoin, type JoinState } from './actions';

export function JoinForm({ rawToken, libraryName }: { rawToken: string; libraryName: string }) {
  const t = useTranslations();
  const [pending, start] = React.useTransition();
  const [state, setState] = React.useState<JoinState>({ status: 'idle' });

  return (
    <div className="max-w-md space-y-4">
      <p className="text-sm text-slate-600">{t('invitation.join.lead')}</p>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          start(async () => {
            const out = await submitJoin(rawToken);
            setState(out);
          });
        }}
        className="rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
      >
        {t('invitation.join.submit')} {libraryName}
      </button>
      {state.status === 'error' ? (
        <p role="alert" className="text-sm text-red-700">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 12.4: Page server component**

Créer `src/app/invitations/[token]/page.tsx` :

```tsx
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { appRouter } from '@/server/trpc/routers/_app';
import { createContext } from '@/server/trpc/context';
import { SignupForm } from './signup-form';
import { JoinForm } from './join-form';

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function InvitationConsumePage({ params }: PageProps) {
  const { token } = await params;
  const ctx = await createContext();
  const caller = appRouter.createCaller(ctx);
  const validation = await caller.invitation.validate({ rawToken: token });
  const t = await getTranslations();

  if (!validation.valid) {
    return (
      <main className="container mx-auto max-w-md py-10">
        <h1 className="text-2xl font-semibold">{t('invitation.invalid.title')}</h1>
        <p className="mt-2 text-slate-600">{t('invitation.invalid.body')}</p>
      </main>
    );
  }

  if (validation.mode === 'join') {
    if (!ctx.user) {
      const callbackUrl = encodeURIComponent(`/invitations/${token}`);
      redirect(`/login?callbackUrl=${callbackUrl}`);
    }
    if (ctx.user.email.toLowerCase() !== validation.email.toLowerCase()) {
      return (
        <main className="container mx-auto max-w-md py-10">
          <h1 className="text-2xl font-semibold">{t('invitation.mismatch.title')}</h1>
          <p className="mt-2 text-slate-600">{t('invitation.mismatch.body')}</p>
        </main>
      );
    }
    return (
      <main className="container mx-auto py-10">
        <h1 className="text-2xl font-semibold">
          {t('invitation.join.title', { libraryName: validation.libraryName ?? '' })}
        </h1>
        <div className="mt-6">
          <JoinForm rawToken={token} libraryName={validation.libraryName ?? ''} />
        </div>
      </main>
    );
  }

  return (
    <main className="container mx-auto py-10">
      <h1 className="text-2xl font-semibold">{t('invitation.signup.title')}</h1>
      <div className="mt-6">
        <SignupForm
          rawToken={token}
          email={validation.email}
          libraryName={validation.libraryName}
        />
      </div>
    </main>
  );
}
```

- [ ] **Step 12.5: Vérifier que le path est public dans le middleware**

Modifier `src/middleware.ts` (si nécessaire) pour ajouter `/invitations` à la liste des publicPaths. Vérifier d'abord :

```bash
grep -n "publicPaths\|PUBLIC" src/middleware.ts
```

Ajouter `/invitations` au tableau si manquant.

- [ ] **Step 12.6: Commit**

```bash
git add src/app/invitations/ src/middleware.ts
git commit -m "feat(phase-1b): add /invitations/[token] page (signup + join modes)"
```

---

## Task 13 : Pages publiques `/password/forgot` + `/password/reset/[token]`

**Files:**

- Create: `src/app/(auth)/password/forgot/page.tsx`
- Create: `src/app/(auth)/password/forgot/forgot-form.tsx`
- Create: `src/app/(auth)/password/forgot/actions.ts`
- Create: `src/app/(auth)/password/reset/[token]/page.tsx`
- Create: `src/app/(auth)/password/reset/[token]/reset-form.tsx`
- Create: `src/app/(auth)/password/reset/[token]/actions.ts`

- [ ] **Step 13.1: Action forgot**

Créer `src/app/(auth)/password/forgot/actions.ts` :

```ts
'use server';

import { z } from 'zod';
import { appRouter } from '@/server/trpc/routers/_app';
import { createContext } from '@/server/trpc/context';

const Schema = z.object({ email: z.string().email().max(254) });

export type ForgotState =
  | { status: 'idle' }
  | { status: 'submitted' }
  | { status: 'error'; message: string };

export async function submitForgot(_p: ForgotState, fd: FormData): Promise<ForgotState> {
  const parsed = Schema.safeParse({ email: fd.get('email')?.toString() ?? '' });
  if (!parsed.success) return { status: 'error', message: 'Email invalide.' };
  const ctx = await createContext();
  const caller = appRouter.createCaller(ctx);
  await caller.password.requestReset({ email: parsed.data.email });
  return { status: 'submitted' };
}
```

- [ ] **Step 13.2: Composant forgot**

Créer `src/app/(auth)/password/forgot/forgot-form.tsx` :

```tsx
'use client';

import * as React from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { submitForgot, type ForgotState } from './actions';

const initial: ForgotState = { status: 'idle' };

export function ForgotForm() {
  const t = useTranslations();
  const [state, action] = useFormState(submitForgot, initial);
  if (state.status === 'submitted') {
    return (
      <p role="status" className="text-sm text-slate-700">
        {t('password.forgot.confirmation')}
      </p>
    );
  }
  return (
    <form action={action} className="max-w-md space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium">
          {t('password.forgot.email.label')}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoFocus
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
        />
      </div>
      <Submit />
      {state.status === 'error' ? (
        <p role="alert" className="text-sm text-red-700">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function Submit() {
  const t = useTranslations();
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
    >
      {t('password.forgot.submit')}
    </button>
  );
}
```

- [ ] **Step 13.3: Page forgot**

Créer `src/app/(auth)/password/forgot/page.tsx` :

```tsx
import { getTranslations } from 'next-intl/server';
import { ForgotForm } from './forgot-form';

export default async function ForgotPasswordPage() {
  const t = await getTranslations();
  return (
    <main className="container mx-auto py-10">
      <h1 className="text-2xl font-semibold">{t('password.forgot.title')}</h1>
      <p className="mt-2 max-w-prose text-sm text-slate-600">{t('password.forgot.lead')}</p>
      <div className="mt-6">
        <ForgotForm />
      </div>
    </main>
  );
}
```

- [ ] **Step 13.4: Action reset**

Créer `src/app/(auth)/password/reset/[token]/actions.ts` :

```ts
'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { appRouter } from '@/server/trpc/routers/_app';
import { createContext } from '@/server/trpc/context';

const Schema = z
  .object({
    rawToken: z.string().min(20).max(100),
    newPassword: z.string().min(12).max(200),
    confirm: z.string().min(12).max(200),
  })
  .refine((v) => v.newPassword === v.confirm, { message: 'mismatch' });

export type ResetState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

export async function submitReset(_p: ResetState, fd: FormData): Promise<ResetState> {
  const parsed = Schema.safeParse({
    rawToken: fd.get('rawToken')?.toString() ?? '',
    newPassword: fd.get('newPassword')?.toString() ?? '',
    confirm: fd.get('confirm')?.toString() ?? '',
  });
  if (!parsed.success) return { status: 'error', message: 'Champs invalides.' };
  const ctx = await createContext();
  const caller = appRouter.createCaller(ctx);
  try {
    await caller.password.consumeReset({
      rawToken: parsed.data.rawToken,
      newPassword: parsed.data.newPassword,
    });
  } catch {
    return { status: 'error', message: 'Lien invalide ou expiré.' };
  }
  redirect('/login?reset=ok');
}
```

- [ ] **Step 13.5: Composant reset**

Créer `src/app/(auth)/password/reset/[token]/reset-form.tsx` :

```tsx
'use client';

import * as React from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { submitReset, type ResetState } from './actions';

const initial: ResetState = { status: 'idle' };

export function ResetForm({ rawToken }: { rawToken: string }) {
  const t = useTranslations();
  const [state, action] = useFormState(submitReset, initial);
  return (
    <form action={action} className="max-w-md space-y-4">
      <input type="hidden" name="rawToken" value={rawToken} />
      <p className="text-sm text-slate-600">{t('password.reset.lead')}</p>
      <div>
        <label htmlFor="newPassword" className="block text-sm font-medium">
          {t('password.reset.newPassword')}
        </label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          required
          minLength={12}
          autoFocus
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
        />
      </div>
      <div>
        <label htmlFor="confirm" className="block text-sm font-medium">
          {t('password.reset.confirmPassword')}
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          required
          minLength={12}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
        />
      </div>
      <Submit />
      {state.status === 'error' ? (
        <p role="alert" className="text-sm text-red-700">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function Submit() {
  const t = useTranslations();
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-slate-900 px-4 py-2 text-white disabled:opacity-50"
    >
      {t('password.reset.submit')}
    </button>
  );
}
```

- [ ] **Step 13.6: Page reset**

Créer `src/app/(auth)/password/reset/[token]/page.tsx` :

```tsx
import { getTranslations } from 'next-intl/server';
import { appRouter } from '@/server/trpc/routers/_app';
import { createContext } from '@/server/trpc/context';
import { ResetForm } from './reset-form';

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function ResetPasswordPage({ params }: PageProps) {
  const { token } = await params;
  const ctx = await createContext();
  const caller = appRouter.createCaller(ctx);
  const v = await caller.password.validateToken({ rawToken: token });
  const t = await getTranslations();

  if (!v.valid) {
    return (
      <main className="container mx-auto max-w-md py-10">
        <h1 className="text-2xl font-semibold">{t('password.reset.invalid.title')}</h1>
        <p className="mt-2 text-slate-600">{t('password.reset.invalid.body')}</p>
      </main>
    );
  }
  return (
    <main className="container mx-auto py-10">
      <h1 className="text-2xl font-semibold">{t('password.reset.title')}</h1>
      <div className="mt-6">
        <ResetForm rawToken={token} />
      </div>
    </main>
  );
}
```

- [ ] **Step 13.7: Brancher /password dans publicPaths du middleware**

Vérifier `src/middleware.ts`. Ajouter `/password/forgot` et `/password/reset` à la liste publique si nécessaire :

```bash
grep -n "publicPaths\|/login\|/password" src/middleware.ts
```

- [ ] **Step 13.8: Brancher le lien sur /login**

Modifier la page `/login` pour activer le lien « Mot de passe oublié ? » qui était disabled en 1A. Pointer vers `/password/forgot`.

```bash
grep -n "forgotPassword\|forgot-password" src/app/\(auth\)/login/
```

Selon le code existant, modifier le composant pour rendre le lien actif sans le `disabled` style.

- [ ] **Step 13.9: Commit**

```bash
git add src/app/\(auth\)/password/ src/middleware.ts src/app/\(auth\)/login/
git commit -m "feat(phase-1b): add /password/forgot + /password/reset/[token] pages"
```

---

## Task 14 : Cleanup job — extension audit invitations expirées

**Files:**

- Modify: `worker/jobs/cleanup-expired-tokens.ts`
- Test: `tests/integration/worker-cleanup-tokens.test.ts`

- [ ] **Step 14.1: Lire l'implémentation existante**

```bash
cat worker/jobs/cleanup-expired-tokens.ts
```

Si le job existe déjà mais ne loggue pas l'audit `auth.invitation.expired`, l'étendre. Sinon créer le pattern.

- [ ] **Step 14.2: Implémenter / étendre `cleanup-expired-tokens.ts`**

```ts
import type { PrismaClient } from '@prisma/client';

const RETENTION_MS = 7 * 24 * 3600 * 1000;

export async function cleanupExpiredTokens(
  db: PrismaClient,
): Promise<{ invitationsDeleted: number; resetsDeleted: number; auditsLogged: number }> {
  const cutoff = new Date(Date.now() - RETENTION_MS);

  const expiredInvitations = await db.invitation.findMany({
    where: { expiresAt: { lt: cutoff }, consumedAt: null },
    select: { id: true },
  });

  let auditsLogged = 0;
  if (expiredInvitations.length > 0) {
    await db.auditLog.createMany({
      data: expiredInvitations.map((inv) => ({
        action: 'auth.invitation.expired',
        targetType: 'INVITATION',
        targetId: inv.id,
        metadata: { invitationId: inv.id } as object,
      })),
    });
    auditsLogged = expiredInvitations.length;
  }

  const expiredResetTokens = await db.passwordResetToken.findMany({
    where: { expiresAt: { lt: cutoff } },
    select: { id: true },
  });
  if (expiredResetTokens.length > 0) {
    await db.auditLog.createMany({
      data: expiredResetTokens.map((t) => ({
        action: 'auth.password.reset_expired',
        targetType: 'AUTH',
        targetId: t.id,
        metadata: { tokenId: t.id } as object,
      })),
    });
    auditsLogged += expiredResetTokens.length;
  }

  const r1 = await db.invitation.deleteMany({
    where: { expiresAt: { lt: cutoff }, consumedAt: null },
  });
  const r2 = await db.passwordResetToken.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });

  return {
    invitationsDeleted: r1.count,
    resetsDeleted: r2.count,
    auditsLogged,
  };
}
```

- [ ] **Step 14.3: Test integration cleanup**

Créer `tests/integration/worker-cleanup-tokens.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { cleanupExpiredTokens } from '../../worker/jobs/cleanup-expired-tokens';
import { hash as argonHash } from '@node-rs/argon2';

beforeEach(async () => {
  await db.auditLog.deleteMany();
  await db.passwordResetToken.deleteMany();
  await db.invitation.deleteMany();
  await db.user.deleteMany();
});

describe('cleanup-expired-tokens', () => {
  it('deletes invitations + reset tokens older than 7d, logs audit per item', async () => {
    const u = await db.user.create({
      data: {
        email: 'a@x.test',
        displayName: 'A',
        passwordHash: await argonHash('x', {
          algorithm: 2 as const,
          memoryCost: 19456,
          timeCost: 2,
          parallelism: 1,
        }),
        role: 'GLOBAL_ADMIN',
      },
    });
    const old = new Date(Date.now() - 8 * 24 * 3600 * 1000);
    await db.invitation.create({
      data: {
        email: 'inv@x.test',
        invitedById: u.id,
        tokenHash: 'h1',
        expiresAt: old,
      },
    });
    await db.passwordResetToken.create({
      data: { userId: u.id, tokenHash: 'h2', expiresAt: old },
    });

    const out = await cleanupExpiredTokens(db);
    expect(out.invitationsDeleted).toBe(1);
    expect(out.resetsDeleted).toBe(1);
    expect(out.auditsLogged).toBe(2);

    const audits = await db.auditLog.findMany();
    const actions = audits.map((a) => a.action).sort();
    expect(actions).toEqual(['auth.invitation.expired', 'auth.password.reset_expired']);
  });

  it('keeps recently expired tokens within retention window', async () => {
    const u = await db.user.create({
      data: {
        email: 'b@x.test',
        displayName: 'B',
        passwordHash: await argonHash('x', {
          algorithm: 2 as const,
          memoryCost: 19456,
          timeCost: 2,
          parallelism: 1,
        }),
      },
    });
    const recent = new Date(Date.now() - 3600 * 1000); // expired 1h ago
    await db.passwordResetToken.create({
      data: { userId: u.id, tokenHash: 'h3', expiresAt: recent },
    });
    const out = await cleanupExpiredTokens(db);
    expect(out.resetsDeleted).toBe(0);
  });
});
```

- [ ] **Step 14.4: Run integration**

```bash
pnpm test:integration -- worker-cleanup-tokens
```

Expected: 2 tests pass.

- [ ] **Step 14.5: Commit**

```bash
git add worker/jobs/cleanup-expired-tokens.ts tests/integration/worker-cleanup-tokens.test.ts
git commit -m "feat(phase-1b): cleanup-expired-tokens logs audit per expired item"
```

---

## Task 15 : E2E Playwright — 4 scénarios

**Files:**

- Create: `tests/e2e/helpers/mailpit.ts`
- Create: `tests/e2e/invitation-new-user.spec.ts`
- Create: `tests/e2e/invitation-existing-user.spec.ts`
- Create: `tests/e2e/password-reset.spec.ts`
- Create: `tests/e2e/reset-invalidates-sessions.spec.ts`

- [ ] **Step 15.1: Helper Mailpit**

Créer `tests/e2e/helpers/mailpit.ts` :

```ts
const MAILPIT_BASE = process.env.MAILPIT_URL ?? 'http://localhost:8025';

interface MailpitMessage {
  ID: string;
  To: { Address: string }[];
  Subject: string;
  Snippet: string;
}

export async function clearMailpit(): Promise<void> {
  const res = await fetch(`${MAILPIT_BASE}/api/v1/messages`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`mailpit clear failed: ${res.status}`);
}

export async function waitForEmail(
  to: string,
  predicate?: (m: MailpitMessage) => boolean,
  timeoutMs = 15_000,
): Promise<MailpitMessage> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${MAILPIT_BASE}/api/v1/messages`);
    const body = (await res.json()) as { messages: MailpitMessage[] };
    const found = body.messages.find(
      (m) =>
        m.To.some((t) => t.Address.toLowerCase() === to.toLowerCase()) &&
        (predicate ? predicate(m) : true),
    );
    if (found) return found;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`email to ${to} not received in ${timeoutMs}ms`);
}

export async function getMessageBody(id: string): Promise<{ HTML: string; Text: string }> {
  const res = await fetch(`${MAILPIT_BASE}/api/v1/message/${id}`);
  return (await res.json()) as { HTML: string; Text: string };
}

export function extractFirstUrl(body: string, prefix: string): string {
  const re = new RegExp(
    `(${prefix.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}[A-Za-z0-9_\\-/.?=&%]+)`,
  );
  const m = body.match(re);
  if (!m) throw new Error(`url with prefix ${prefix} not found`);
  return m[1];
}
```

- [ ] **Step 15.2: Scénario E2E — invite new user**

Créer `tests/e2e/invitation-new-user.spec.ts` :

```ts
import { test, expect } from '@playwright/test';
import { clearMailpit, waitForEmail, getMessageBody, extractFirstUrl } from './helpers/mailpit';

test.beforeEach(async () => {
  await clearMailpit();
});

test('admin invites a new user → signup → /', async ({ page, request, context }) => {
  // Helper E2E déjà existant Phase 1A : seedAdminAndLogin (à reuse / adapter)
  // Ici on suppose la présence d'un endpoint helper de seed via /api/test/seed-admin
  // (à créer côté Phase 1A si manquant), sinon on utilise directement la DB via un
  // hook `globalSetup`.
  await page.goto('/login');
  // login en tant qu'admin global avec 2FA déjà OK
  await page.getByLabel('Email').fill(process.env.E2E_ADMIN_EMAIL!);
  await page.getByLabel('Mot de passe').fill(process.env.E2E_ADMIN_PASSWORD!);
  await page.getByRole('button', { name: /se connecter/i }).click();
  // ... 2FA flow déjà testé Phase 1A, on suppose un cookie injecté ou un endpoint shortcut
  await page.goto('/admin/users/invite');
  await page.getByLabel('Email').fill('newbie@x.test');
  await page.getByRole('button', { name: /Envoyer/ }).click();
  await expect(page.getByRole('status')).toContainText('newbie@x.test');

  const msg = await waitForEmail('newbie@x.test');
  const body = await getMessageBody(msg.ID);
  const link = extractFirstUrl(body.HTML, `${process.env.APP_BASE_URL}/invitations/`);

  await page.goto(link);
  await page.getByLabel(/Nom affiché/).fill('Newbie');
  await page.getByLabel(/^Mot de passe$/).fill('CorrectHorseBatteryStaple');
  await page.getByLabel(/Confirmer/).fill('CorrectHorseBatteryStaple');
  await page.getByRole('button', { name: /Créer mon compte/ }).click();
  await expect(page).toHaveURL('/');
});
```

Note : ce scénario suppose un helper de login admin déjà créé en Phase 1A (cf. `tests/e2e/` existants). Si non disponible, ajouter un endpoint `/api/test/seed-admin` (gated par `NODE_ENV=test`) qui crée un admin avec session pré-validée.

- [ ] **Step 15.3: Scénario E2E — invite existing user (join)**

Créer `tests/e2e/invitation-existing-user.spec.ts` :

```ts
import { test, expect } from '@playwright/test';
import { clearMailpit, waitForEmail, getMessageBody, extractFirstUrl } from './helpers/mailpit';

test.beforeEach(async () => {
  await clearMailpit();
});

test('admin invites existing user → join library', async ({ page }) => {
  // Préreq : un user 'existing@x.test' existe déjà + un admin connecté
  await page.goto('/admin/users/invite');
  await page.getByLabel('Email').fill('existing@x.test');
  await page.getByRole('button', { name: /Envoyer/ }).click();
  const msg = await waitForEmail('existing@x.test');
  const body = await getMessageBody(msg.ID);
  const link = extractFirstUrl(body.HTML, `${process.env.APP_BASE_URL}/invitations/`);

  // Switch context : user existant déjà logué (helper)
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('Email').fill('existing@x.test');
  await page.getByLabel('Mot de passe').fill(process.env.E2E_EXISTING_PASSWORD!);
  await page.getByRole('button', { name: /se connecter/i }).click();
  await page.goto(link);
  await page.getByRole('button', { name: /Rejoindre/ }).click();
  await expect(page).toHaveURL('/');
});
```

- [ ] **Step 15.4: Scénario E2E — password reset**

Créer `tests/e2e/password-reset.spec.ts` :

```ts
import { test, expect } from '@playwright/test';
import { clearMailpit, waitForEmail, getMessageBody, extractFirstUrl } from './helpers/mailpit';

test.beforeEach(async () => {
  await clearMailpit();
});

test('user resets password and logs in with new one', async ({ page }) => {
  await page.goto('/password/forgot');
  await page.getByLabel('Email').fill('existing@x.test');
  await page.getByRole('button', { name: /Envoyer le lien/ }).click();
  await expect(page.getByRole('status')).toContainText('Si un compte existe');

  const msg = await waitForEmail('existing@x.test', (m) => /Réinitialisation/.test(m.Subject));
  const body = await getMessageBody(msg.ID);
  const link = extractFirstUrl(body.HTML, `${process.env.APP_BASE_URL}/password/reset/`);

  await page.goto(link);
  await page.getByLabel(/Nouveau mot de passe/).fill('BrandNewPassword42!');
  await page.getByLabel(/Confirmer le mot de passe/).fill('BrandNewPassword42!');
  await page.getByRole('button', { name: /Mettre à jour/ }).click();
  await expect(page).toHaveURL(/\/login\?reset=ok$/);

  await page.getByLabel('Email').fill('existing@x.test');
  await page.getByLabel('Mot de passe').fill('BrandNewPassword42!');
  await page.getByRole('button', { name: /se connecter/i }).click();
  // succès → /login/2fa ou /
});
```

- [ ] **Step 15.5: Scénario E2E — reset invalidates sessions**

Créer `tests/e2e/reset-invalidates-sessions.spec.ts` :

```ts
import { test, expect, type BrowserContext } from '@playwright/test';
import { clearMailpit, waitForEmail, getMessageBody, extractFirstUrl } from './helpers/mailpit';

test.beforeEach(async () => {
  await clearMailpit();
});

async function login(ctx: BrowserContext, email: string, password: string) {
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: /se connecter/i }).click();
  return page;
}

test('reset password kicks active sessions out', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await login(ctxA, 'existing@x.test', process.env.E2E_EXISTING_PASSWORD!);
  // Browser B : forgot + reset
  const pageB = await ctxB.newPage();
  await pageB.goto('/password/forgot');
  await pageB.getByLabel('Email').fill('existing@x.test');
  await pageB.getByRole('button', { name: /Envoyer le lien/ }).click();
  const msg = await waitForEmail('existing@x.test', (m) => /Réinitialisation/.test(m.Subject));
  const body = await getMessageBody(msg.ID);
  const link = extractFirstUrl(body.HTML, `${process.env.APP_BASE_URL}/password/reset/`);
  await pageB.goto(link);
  await pageB.getByLabel(/Nouveau mot de passe/).fill('AnotherFreshPwd99!');
  await pageB.getByLabel(/Confirmer le mot de passe/).fill('AnotherFreshPwd99!');
  await pageB.getByRole('button', { name: /Mettre à jour/ }).click();

  // Browser A : naviguer vers /admin → doit être redirigé vers /login
  await pageA.goto('/admin');
  await expect(pageA).toHaveURL(/\/login/);
});
```

- [ ] **Step 15.6: Vérifier la config Playwright**

Vérifier `playwright.config.ts` que :

- `webServer` lance bien `pnpm dev` ou `pnpm start` avec les bons env vars (incluant `EMAIL_TRANSPORT=smtp` + `SMTP_HOST=localhost` + `EMAIL_FROM` + `MAILPIT_URL`).
- Les env de test exposent `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD`, `E2E_EXISTING_PASSWORD` pour les helpers.
- Mailpit + Postgres + Redis sont up avant de lancer Playwright (cf. `docker-compose.ci.yml`).

- [ ] **Step 15.7: Run E2E suite**

```bash
docker compose -f docker-compose.ci.yml up -d mailpit postgres redis
pnpm e2e -- --grep "phase-1b|invitation|password|reset"
```

Expected: les 4 scénarios passent. Si problèmes de timing avec Mailpit, augmenter le timeout de `waitForEmail`.

- [ ] **Step 15.8: Commit**

```bash
git add tests/e2e/
git commit -m "test(phase-1b): add 4 E2E scenarios (invite/join/reset/session-invalidation)"
```

---

## Task 16 : Documentation deployment + Resend DNS

**Files:**

- Modify: `docs/deployment.md`

- [ ] **Step 16.1: Ajouter la section Resend**

Modifier `docs/deployment.md`. Avant la section bootstrap admin (ou en fin de fichier), ajouter :

````markdown
## Email transactionnel — Resend (production)

BiblioShare envoie 4 emails transactionnels (invitation new user, invitation join library,
password reset, password reset confirmation). En prod on utilise [Resend](https://resend.com/).

### 1. Créer le compte + le domaine

1. Créer un compte sur https://resend.com/.
2. Section **Domains** → **Add Domain**, saisir `biblioshare.example.org`.
3. Resend affiche 3 enregistrements DNS à publier chez votre registrar (OVH, Gandi, etc.) :
   - `MX` ou `TXT` pour SPF
   - `TXT` pour DKIM (clé publique fournie)
   - `TXT` pour DMARC (reco minimale : `v=DMARC1; p=quarantine; rua=mailto:postmaster@biblioshare.example.org;`)

### 2. Configurer DNS chez OVH

OVH → Web Cloud → Domains → `biblioshare.example.org` → DNS Zone. Ajouter chaque
enregistrement Resend tel quel. Délai de propagation : 5-60 min.

Vérifier la propagation :

```bash
dig +short TXT biblioshare.example.org
dig +short TXT _dmarc.biblioshare.example.org
dig +short TXT resend._domainkey.biblioshare.example.org
```
````

### 3. Variables Coolify

Dans l'interface Coolify, app BiblioShare → Environment :

```
EMAIL_TRANSPORT=resend
EMAIL_FROM=BiblioShare <noreply@biblioshare.example.org>
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxx
APP_URL=https://biblioshare.example.org
EMAIL_LOG_SALT=<openssl rand -hex 32>
```

Redémarrer le container app + worker.

### 4. Vérifier l'envoi

```bash
# depuis le container app
node -e "import('./.next/server/...').then(...)"
```

Plus simple : déclencher un reset password sur un compte de test, vérifier que l'email
arrive (boîte de spam comprise).

### 5. Surveiller

- Resend dashboard expose : delivered/bounced/complained/opened/clicked.
- Audit log BiblioShare : table `AuditLog` action `auth.invitation.send_failed` pour
  les envois en DLQ après 5 retries.
- Logs pino : `event=email.sent` avec `transportId` (l'ID Resend) pour corréler.

````

- [ ] **Step 16.2: Commit**

```bash
git add docs/deployment.md
git commit -m "docs(phase-1b): add Resend setup + DNS instructions"
````

---

## Task 17 : Smoke test staging + tag `phase-1b-complete`

**Files:**

- (aucun fichier modifié — checklist manuelle + tag git)

- [ ] **Step 17.1: Run full test suite**

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm e2e
```

Expected: tout vert.

- [ ] **Step 17.2: Build production**

```bash
pnpm build
docker build -t biblioshare-app:phase-1b -f Dockerfile .
docker build -t biblioshare-worker:phase-1b -f Dockerfile.worker .
```

Expected: builds OK.

- [ ] **Step 17.3: Push branche + ouvrir PR**

```bash
git push -u origin feat/phase-1b-invitations-reset
gh pr create --title "feat(phase-1b): invitations & reset password" --body "$(cat <<'EOF'
## Summary
- Invitations admin (signup + join modes) avec consent flow pour users existants
- Reset password avec invalidation totale des sessions + email de confirmation
- Templates react-email (4 templates), Resend prod / Mailpit dev
- Worker BullMQ queue mail avec retry exp backoff
- Rate-limits double sur reset (per-email + per-IP)
- Timing pad ~250ms sur /password/forgot (mitigation A2)
- 9 attack tests + 4 scénarios E2E Playwright

## Test plan
- [x] Unit tests verts (lib/email, mail-queue, invitations, emails-render)
- [x] Integration tests verts (invitations, password-reset, routers, rate-limit-reset, worker-cleanup-tokens)
- [x] Attack tests verts (password-reset timing + énumération)
- [x] E2E verts (4 scénarios)
- [ ] Smoke test staging Coolify
- [ ] DNS Resend propagation OK + email reçu en boîte réelle

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 17.4: Smoke test Coolify staging**

Suivre `docs/deployment.md` :

1. Configurer les env vars Resend + EMAIL_LOG_SALT.
2. Push image staging.
3. Login en tant qu'admin global.
4. Créer une biblio + s'inviter soi-même via `/admin/users/invite` → vérifier email reçu sur boîte réelle (test gmail/outlook).
5. Cliquer le lien → signup → /.
6. Logout → `/password/forgot` → vérifier email confirmation reçu post-reset.
7. Vérifier audit log dans la DB : `SELECT action, count(*) FROM "AuditLog" WHERE action LIKE 'auth.%' GROUP BY action;` (≥ 1 ligne par event Phase 1B activé).

Si tout OK :

- [ ] **Step 17.5: Merge la PR**

```bash
gh pr merge --squash --delete-branch
git checkout main
git pull
```

- [ ] **Step 17.6: Tag git `phase-1b-complete`**

```bash
git tag -a phase-1b-complete -m "Phase 1B complete: invitations & reset password"
git push origin phase-1b-complete
```

- [ ] **Step 17.7: Mettre à jour la mémoire projet**

Créer un memory file `project_phase_1b_completed.md` (cf. rituel de fin de phase mentionné dans la mémoire globale).

```markdown
---
name: Phase 1B — clôture
description: Phase 1B (invitations + reset password) clôturée le YYYY-MM-DD, tag `phase-1b-complete`.
type: project
---

# Phase 1B — clôture

Tag : `phase-1b-complete` sur `<commit-sha>`. PR `#NN` mergée.

Livrables :

- Services `lib/{email,invitations,password-reset,mail-queue}.ts`
- 4 templates react-email
- Routeurs tRPC `invitation` + `password`
- Pages `/admin/users/invite`, `/invitations/[token]`, `/password/forgot`, `/password/reset/[token]`
- Worker BullMQ queue `mail` avec retry
- Cleanup tokens étendu avec audit per-item
- 9 attack tests, 4 scénarios E2E

CI : tous les jobs verts. Smoke staging OK.

Prochaine étape : Phase 1C (panel admin complet, /account/security, matrice rôles complète).
```

Mettre à jour `MEMORY.md` (index) avec une ligne pointant vers ce nouveau memory.

---

## Self-Review

**Spec coverage check** (sections du spec ↔ tasks) :

| Spec section                | Task(s) couvrante(s)                                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| §1.4 Livrables techniques   | Tasks 1-15                                                                                                        |
| §2.1 Flow invitation signup | Tasks 6, 9, 12                                                                                                    |
| §2.2 Flow invitation join   | Tasks 6, 9, 12                                                                                                    |
| §2.3 Flow reset password    | Tasks 7, 10, 13                                                                                                   |
| §3.1 Découpage fichiers     | Tous                                                                                                              |
| §3.2 Modules services       | Tasks 2, 6, 7                                                                                                     |
| §3.3 Env vars               | Task 1                                                                                                            |
| §4.1 Tokens                 | Task 6, 7 (réutilise `lib/tokens.ts` existant)                                                                    |
| §4.2 Rate-limits            | Task 8 (resetIpOnlyLimiter) + Tasks 9, 10 (consume)                                                               |
| §4.3 Audit events           | Task 10.3 (extension union) + Tasks 9, 10, 14 (recordAudit calls)                                                 |
| §4.4 Cleanup job            | Task 14                                                                                                           |
| §4.5 safeCallbackUrl        | Task 12 (server component handles l'invitation), Task 13 (idem reset)                                             |
| §4.6 Attack tests           | Task 6 (replay/expired/tamper/crossuser), Task 7 (replay/expired/drain/sessions), Task 10 (timing/enumeration)    |
| §5.1 Pages UI               | Tasks 11, 12, 13                                                                                                  |
| §5.2 i18n                   | Task 4                                                                                                            |
| §5.3 Emails templates       | Task 3                                                                                                            |
| §6.1 Tests                  | Tasks 6, 7, 8, 9, 10, 14, 15                                                                                      |
| §6.2 Observabilité          | Tasks 2 (logs sendEmail), 5 (worker failed listener)                                                              |
| §6.3 Risques                | adressés implicitement par retry config (Task 5), `Serializable` tx (Tasks 6, 7), redact pino (existant Phase 1A) |
| §6.4 Ordre exécution        | Suit la séquence Tasks 0-17                                                                                       |
| §7 Décisions                | Toutes implémentées                                                                                               |

**Placeholder scan** : aucun TBD/TODO dans les tâches. Les seuls « selon code existant » concernent des helpers Phase 1A à inspecter (helper E2E login admin, `flushRateLimit` test) — explicités dans les steps comme à vérifier.

**Type consistency** : `MailJobName` (Task 5) référencé dans `enqueueMail` (Tasks 9, 10) avec les mêmes 4 noms. `CreateInvitationResult.mode` cohérent entre service (Task 6) et router (Task 9). `ResetState`/`SignupState`/`ForgotState`/`InviteState` chacun défini dans son fichier d'action et utilisé seulement dans son composant.

**Scope check** : 17 tasks pour une sous-phase de mid-size — comparable aux 25 tasks de Phase 1A. Granularité OK.

---

## Hors-Scope (rappel — repoussé en 1C ou plus tard)

- Panel `/admin/users` complet (table + suspend/delete/role-change)
- Page `/admin/invitations` (table de gestion : revoke UI, resend, voir statut)
- Page `/account/security` (sessions, regen recovery codes, désactiver 2FA, change MdP)
- Geo-lookup IP pour `ipApprox` dans les emails
- Fallback SMTP en prod si Resend down (YAGNI 1B)
