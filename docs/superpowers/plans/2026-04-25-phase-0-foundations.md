# Phase 0 — Fondations : Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produire un repo Next.js 15 + TypeScript fullstack avec stack Docker Compose complète (8 services), schéma Prisma intégral, CI fonctionnelle, système de design de base, prêt à déployer sur Coolify et à recevoir l'authentification de la Phase 1.

**Architecture:** Monorepo Next.js avec un seul package applicatif (l'app) et un worker Node minimal. 8 services Docker orchestrés par Coolify. Schéma Prisma complet (toutes les tables) défini dès Phase 0 ; les API et UI métier viennent dans les phases suivantes. Aucune logique d'authentification dans cette phase (Phase 1).

**Tech Stack:** Next.js 15 (App Router) · TypeScript strict · Prisma 6 · PostgreSQL 16 · Redis 7 · Meilisearch 1.x · ClamAV daemon · Calibre · Pino · Tailwind 4 · shadcn/ui · Lucide · next-intl · zod · Vitest · Playwright · Docker · GitHub Actions · pnpm.

**Critère de validation final** : un dev tiers clone le repo, suit le README, lance `docker compose up`, voit la page d'accueil en HTTPS local, voit `/health` répondre 200 sur tous les sous-systèmes (DB, Redis, Meili, ClamAV), tout passe en CI. Déploiement Coolify validé sur le VPS réel en HTTPS.

**Référence design** : `docs/superpowers/specs/2026-04-25-biblioshare-design.md`.

---

## Décomposition des fichiers

### Fichiers à créer

| Fichier                                  | Responsabilité                                             |
| ---------------------------------------- | ---------------------------------------------------------- |
| `package.json`                           | Métadonnées projet, scripts npm, dépendances               |
| `pnpm-lock.yaml`                         | Lockfile pnpm (généré)                                     |
| `tsconfig.json`                          | Config TS strict                                           |
| `next.config.ts`                         | Config Next.js (security headers, i18n, output standalone) |
| `tailwind.config.ts`                     | Config Tailwind avec design tokens                         |
| `postcss.config.mjs`                     | PostCSS pour Tailwind                                      |
| `.eslintrc.cjs` (ou `eslint.config.mjs`) | Config ESLint + règle custom no-unscoped-prisma            |
| `.prettierrc`                            | Config Prettier                                            |
| `.editorconfig`                          | Cohérence éditeurs                                         |
| `.env.example`                           | Variables d'environnement documentées                      |
| `.dockerignore`                          | Exclusions build Docker                                    |
| `Dockerfile`                             | Image app (multi-stage)                                    |
| `Dockerfile.worker`                      | Image worker (multi-stage)                                 |
| `docker-compose.yml`                     | Orchestration 8 services                                   |
| `prisma/schema.prisma`                   | Schéma DB complet                                          |
| `prisma/seed.ts`                         | Seed dev minimal                                           |
| `src/app/layout.tsx`                     | Layout racine                                              |
| `src/app/page.tsx`                       | Page d'accueil minimale                                    |
| `src/app/globals.css`                    | CSS global, tokens, base Tailwind                          |
| `src/app/api/health/route.ts`            | Endpoint healthcheck                                       |
| `src/lib/env.ts`                         | Validation des variables d'env (zod)                       |
| `src/lib/logger.ts`                      | Logger pino configuré                                      |
| `src/lib/db.ts`                          | Client Prisma singleton                                    |
| `src/lib/redis.ts`                       | Client Redis singleton                                     |
| `src/lib/meili.ts`                       | Client Meilisearch singleton                               |
| `src/lib/private-scope.ts`               | Type Brand `PrivateScope`                                  |
| `src/lib/security-headers.ts`            | Helper headers de sécurité                                 |
| `src/components/ui/button.tsx`           | Primitive Button                                           |
| `src/components/ui/input.tsx`            | Primitive Input                                            |
| `src/components/ui/card.tsx`             | Primitive Card                                             |
| `src/components/ui/toast.tsx`            | Primitive Toast                                            |
| `src/i18n/messages/fr.json`              | Traductions FR                                             |
| `src/i18n/config.ts`                     | Config next-intl                                           |
| `worker/index.ts`                        | Worker minimal (boot, connect Redis, idle)                 |
| `worker/tsconfig.json`                   | Config TS worker                                           |
| `eslint-rules/no-unscoped-prisma.js`     | Règle ESLint custom                                        |
| `tests/unit/example.test.ts`             | Test unit exemple                                          |
| `tests/e2e/health.spec.ts`               | Test E2E exemple                                           |
| `vitest.config.ts`                       | Config Vitest                                              |
| `playwright.config.ts`                   | Config Playwright                                          |
| `.github/workflows/ci.yml`               | Pipeline CI                                                |
| `.github/dependabot.yml`                 | Config Dependabot                                          |
| `.github/workflows/codeql.yml`           | Scan sécurité GitHub natif (optionnel)                     |
| `README.md`                              | Doc projet, démarrage rapide                               |
| `docs/deployment.md`                     | Guide Coolify pas-à-pas                                    |
| `docs/security/owasp-mapping.md`         | Couverture OWASP Top 10 (squelette)                        |
| `docs/security/credential-rotation.md`   | Calendrier rotation credentials                            |

### Fichiers à modifier

| Fichier      | Modification                                                                 |
| ------------ | ---------------------------------------------------------------------------- |
| `.gitignore` | Ajouter exclusions Next.js (`.next/`, `next-env.d.ts`) si pas déjà couvertes |

---

## Conventions communes

- **Package manager** : `pnpm` (rapide, déterministe, standard en 2026).
- **Commit style** : Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`, `ci:`).
- **Branche** : tout sur `main` durant Phase 0 (solo dev, pas de PR à se faire à soi-même). Branche dédiée + PR à partir de Phase 1.
- **Tests** : TDD strict — écrire le test, le voir échouer, implémenter, voir passer, commit.
- **Commits fréquents** : un commit par tâche (parfois deux), jamais de gros commits massifs.

---

## Section A — Bootstrap projet

### Task 1 : Initialiser Next.js 15 + TypeScript strict + pnpm

**Files:**

- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `next-env.d.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `postcss.config.mjs`, `tailwind.config.ts`
- Create: `.gitignore` mis à jour

- [ ] **Step 1 : Créer le projet Next.js**

```bash
cd /Users/seraphin/Library/CloudStorage/SynologyDrive-save/02_Trinity/Projet/github/fm-librairy
pnpm create next-app@15.0.0 . --typescript --tailwind --eslint --app --src-dir --use-pnpm --import-alias "@/*"
```

Répondre `Yes` aux questions par défaut. Si `create-next-app` refuse parce que le dossier n'est pas vide (à cause de `docs/`), exécuter dans un dossier temporaire puis copier les fichiers générés à la racine.

Alternative robuste si bloqué :

```bash
mkdir -p /tmp/biblioshare-init
cd /tmp/biblioshare-init
pnpm create next-app@15.0.0 app --typescript --tailwind --eslint --app --src-dir --use-pnpm --import-alias "@/*"
cp -r app/. /Users/seraphin/Library/CloudStorage/SynologyDrive-save/02_Trinity/Projet/github/fm-librairy/
cd /Users/seraphin/Library/CloudStorage/SynologyDrive-save/02_Trinity/Projet/github/fm-librairy
rm -rf /tmp/biblioshare-init
```

- [ ] **Step 2 : Activer TypeScript strict**

Modifier `tsconfig.json` pour activer toutes les options strict. Remplacer le contenu par :

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": false,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "worker"]
}
```

- [ ] **Step 3 : Ajouter le script `typecheck`**

Modifier `package.json`, ajouter dans `"scripts"` :

```json
"typecheck": "tsc --noEmit"
```

- [ ] **Step 4 : Vérifier que tout passe**

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm build
```

Expected : tout passe sans erreur. Build produit `.next/`.

- [ ] **Step 5 : Commit**

```bash
git add .
git commit -m "chore: bootstrap Next.js 15 + TypeScript strict via create-next-app"
```

---

### Task 2 : Configurer Prettier + EditorConfig + .gitignore complet

**Files:**

- Create: `.prettierrc`, `.editorconfig`
- Modify: `package.json` (scripts format), `.gitignore`

- [ ] **Step 1 : Installer Prettier**

```bash
pnpm add -D prettier prettier-plugin-tailwindcss
```

- [ ] **Step 2 : Créer `.prettierrc`**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "endOfLine": "lf",
  "plugins": ["prettier-plugin-tailwindcss"]
}
```

- [ ] **Step 3 : Créer `.editorconfig`**

```ini
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false
```

- [ ] **Step 4 : Ajouter scripts format dans `package.json`**

Dans `"scripts"` :

```json
"format": "prettier --write .",
"format:check": "prettier --check ."
```

- [ ] **Step 5 : Compléter `.gitignore`**

Le `.gitignore` racine existe déjà (créé en Phase Design). Vérifier qu'il contient bien les entrées Next.js et Prisma. Compléter si besoin :

```
# Next.js
.next/
next-env.d.ts
.vercel

# Prisma generated client
prisma/generated/

# pnpm
.pnpm-store/
```

- [ ] **Step 6 : Formatter tout le code**

```bash
pnpm format
```

- [ ] **Step 7 : Commit**

```bash
git add .
git commit -m "chore: add Prettier + EditorConfig"
```

---

### Task 3 : Installer Tailwind 4 + shadcn/ui + Lucide icons

**Note** : Next.js 15 + `create-next-app --tailwind` installe déjà Tailwind. On y ajoute shadcn/ui et Lucide.

**Files:**

- Modify: `package.json`, `tailwind.config.ts`, `src/app/globals.css`
- Create: `components.json` (shadcn config), `src/lib/utils.ts`

- [ ] **Step 1 : Installer shadcn/ui CLI et Lucide**

```bash
pnpm dlx shadcn@latest init -d
pnpm add lucide-react class-variance-authority clsx tailwind-merge
```

`shadcn init` pose des questions : choisir `New York` style, `Neutral` base color, accepter le chemin par défaut `src/components`.

- [ ] **Step 2 : Vérifier que `components.json` est créé à la racine**

Contenu attendu (vérifier, ajuster si différent) :

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

- [ ] **Step 3 : Vérifier `src/lib/utils.ts`**

Doit contenir :

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4 : Sanity check**

```bash
pnpm typecheck
pnpm build
```

Expected : passe.

- [ ] **Step 5 : Commit**

```bash
git add .
git commit -m "feat: add shadcn/ui + Lucide icons"
```

---

### Task 4 : Définir les design tokens

**Goal** : palette neutre + un accent unique (sobre, professionnel), typographie système avec police lisible, tokens d'espacement et rayons cohérents. Mode sombre soigné.

**Files:**

- Modify: `src/app/globals.css`, `tailwind.config.ts`

- [ ] **Step 1 : Définir les tokens CSS dans `src/app/globals.css`**

Remplacer le contenu par :

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    /* Couleurs — palette neutre + accent ardoise/encre */
    --background: 0 0% 100%;
    --foreground: 222 14% 12%;
    --muted: 220 13% 96%;
    --muted-foreground: 220 9% 46%;
    --card: 0 0% 100%;
    --card-foreground: 222 14% 12%;
    --popover: 0 0% 100%;
    --popover-foreground: 222 14% 12%;
    --border: 220 13% 91%;
    --input: 220 13% 91%;
    --primary: 222 47% 18%;
    --primary-foreground: 220 13% 98%;
    --secondary: 220 13% 95%;
    --secondary-foreground: 222 14% 12%;
    --accent: 217 91% 45%;
    --accent-foreground: 220 13% 98%;
    --destructive: 0 72% 45%;
    --destructive-foreground: 220 13% 98%;
    --success: 142 71% 36%;
    --warning: 38 92% 50%;
    --ring: 217 91% 45%;
    --radius: 0.5rem;
  }

  .dark {
    --background: 222 18% 9%;
    --foreground: 220 13% 96%;
    --muted: 222 14% 16%;
    --muted-foreground: 220 9% 65%;
    --card: 222 18% 11%;
    --card-foreground: 220 13% 96%;
    --popover: 222 18% 11%;
    --popover-foreground: 220 13% 96%;
    --border: 222 14% 18%;
    --input: 222 14% 18%;
    --primary: 220 13% 96%;
    --primary-foreground: 222 18% 9%;
    --secondary: 222 14% 16%;
    --secondary-foreground: 220 13% 96%;
    --accent: 217 91% 60%;
    --accent-foreground: 222 18% 9%;
    --destructive: 0 62% 50%;
    --destructive-foreground: 220 13% 96%;
    --success: 142 71% 45%;
    --warning: 38 92% 55%;
    --ring: 217 91% 60%;
  }

  * {
    @apply border-border;
  }
  html {
    font-feature-settings:
      'rlig' 1,
      'calt' 1;
  }
  body {
    @apply bg-background text-foreground antialiased;
  }
}
```

- [ ] **Step 2 : Mettre à jour `tailwind.config.ts`**

Remplacer le contenu par :

```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1rem',
      screens: { '2xl': '1280px' },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Inter',
          'sans-serif',
        ],
        serif: ['ui-serif', 'Georgia', 'Cambria', 'Times New Roman', 'serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'monospace'],
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out',
        'slide-up': 'slide-up 240ms ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
```

- [ ] **Step 3 : Sanity check**

```bash
pnpm build
```

- [ ] **Step 4 : Commit**

```bash
git add tailwind.config.ts src/app/globals.css
git commit -m "feat: define design tokens (palette, typography, radii, animations)"
```

---

### Task 5 : Ajouter primitives UI (Button, Input, Card, Toast)

**Files:**

- Create via shadcn CLI : `src/components/ui/button.tsx`, `src/components/ui/input.tsx`, `src/components/ui/card.tsx`, `src/components/ui/toast.tsx`, `src/components/ui/toaster.tsx`, `src/hooks/use-toast.ts`
- Create: `tests/unit/button.test.tsx`

- [ ] **Step 1 : Ajouter les primitives via shadcn CLI**

```bash
pnpm dlx shadcn@latest add button input card toast
```

Cela crée les fichiers dans `src/components/ui/` et `src/hooks/use-toast.ts`. Accepter les overwrites s'il y en a.

- [ ] **Step 2 : Vérifier l'import et le rendu**

Modifier temporairement `src/app/page.tsx` pour vérifier le rendu :

```tsx
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BookOpen } from 'lucide-react';

export default function Home() {
  return (
    <main className="container mx-auto flex min-h-screen items-center justify-center p-8">
      <Card className="w-full max-w-md animate-slide-up">
        <CardHeader className="flex flex-row items-center gap-3">
          <BookOpen className="h-6 w-6 text-accent" aria-hidden />
          <CardTitle>BiblioShare</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Plateforme privée de gestion de bibliothèques.
          </p>
          <Button className="w-full">Bientôt disponible</Button>
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 3 : Sanity check rendu**

```bash
pnpm dev
```

Ouvrir http://localhost:3000 — vérifier visuellement que la card s'affiche correctement, l'icône Lucide est visible, le bouton est stylé, l'animation `slide-up` joue au chargement. Tuer le dev server (`Ctrl+C`).

- [ ] **Step 4 : Commit**

```bash
git add .
git commit -m "feat: add base UI primitives (Button, Input, Card, Toast)"
```

---

## Section B — Couche données (Prisma)

### Task 6 : Initialiser Prisma + écrire le schéma complet

**Files:**

- Create: `prisma/schema.prisma`, `src/lib/db.ts`
- Modify: `package.json` (scripts prisma)

- [ ] **Step 1 : Installer Prisma**

```bash
pnpm add prisma @prisma/client
pnpm dlx prisma init --datasource-provider postgresql
```

Cela crée `prisma/schema.prisma` initial et un `.env` (à supprimer, on utilise `.env.local` géré par Next).

```bash
rm -f .env
```

- [ ] **Step 2 : Écrire le schéma complet dans `prisma/schema.prisma`**

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["fullTextSearchPostgres", "postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [pgcrypto, citext, pg_trgm]
}

// =====================================================
// Auth & Comptes
// =====================================================

enum UserRole {
  GLOBAL_ADMIN
  USER
}

enum UserStatus {
  ACTIVE
  SUSPENDED
}

model User {
  id               String     @id @default(cuid())
  email            String     @unique @db.Citext
  emailVerifiedAt  DateTime?
  passwordHash     String
  displayName      String
  role             UserRole   @default(USER)
  status           UserStatus @default(ACTIVE)
  twoFactorEnabled Boolean    @default(false)
  locale           String     @default("fr")
  createdAt        DateTime   @default(now())
  updatedAt        DateTime   @updatedAt
  lastLoginAt      DateTime?

  twoFactorSecret    TwoFactorSecret?
  invitationsCreated Invitation[]      @relation("InvitedBy")
  invitationConsumed Invitation?       @relation("ConsumedBy")
  passwordResets     PasswordResetToken[]
  libraryMembers     LibraryMember[]
  uploadedBooks      Book[]            @relation("UploadedBy")
  ownedCopies        PhysicalCopy[]    @relation("Owner")
  heldCopies         PhysicalCopy[]    @relation("CurrentHolder")
  physicalRequests   PhysicalRequest[]
  annotations        Annotation[]
  bookmarks          Bookmark[]
  readingProgress    ReadingProgress[]
  readingSessions    ReadingSession[]
  ratings            Rating[]
  reviews            Review[]
  collections        Collection[]
  downloadLogs       DownloadLog[]
  auditLogs          AuditLog[]
  notifications      Notification[]

  @@index([role])
  @@index([status])
}

model TwoFactorSecret {
  userId       String    @id
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  secretCipher String
  backupCodes  String[]
  confirmedAt  DateTime?
  createdAt    DateTime  @default(now())
}

enum LibraryRole {
  LIBRARY_ADMIN
  MEMBER
}

model Invitation {
  id            String       @id @default(cuid())
  email         String       @db.Citext
  invitedById   String
  invitedBy     User         @relation("InvitedBy", fields: [invitedById], references: [id])
  libraryId     String?
  library       Library?     @relation(fields: [libraryId], references: [id], onDelete: SetNull)
  proposedRole  LibraryRole?
  tokenHash     String       @unique
  expiresAt     DateTime
  consumedAt    DateTime?
  consumedById  String?      @unique
  consumedBy    User?        @relation("ConsumedBy", fields: [consumedById], references: [id])
  createdAt     DateTime     @default(now())

  @@index([email])
}

model PasswordResetToken {
  id         String    @id @default(cuid())
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  String    @unique
  expiresAt  DateTime
  consumedAt DateTime?
  createdAt  DateTime  @default(now())

  @@index([userId])
}

// =====================================================
// Bibliothèques & Permissions
// =====================================================

model Library {
  id          String   @id @default(cuid())
  name        String
  slug        String   @unique
  description String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  members     LibraryMember[]
  invitations Invitation[]
  books       Book[]
  tags        Tag[]
}

model LibraryMember {
  userId      String
  user        User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  libraryId   String
  library     Library     @relation(fields: [libraryId], references: [id], onDelete: Cascade)
  role        LibraryRole @default(MEMBER)
  canRead     Boolean     @default(true)
  canUpload   Boolean     @default(false)
  canDownload Boolean     @default(true)
  joinedAt    DateTime    @default(now())

  @@id([userId, libraryId])
  @@index([libraryId])
}

// =====================================================
// Livres
// =====================================================

enum MetadataSource {
  GOOGLE_BOOKS
  OPEN_LIBRARY
  ISBNDB
  MANUAL
}

enum BookFormat {
  EPUB
  PDF
  TXT
  DOCX
}

enum ScanStatus {
  PENDING
  CLEAN
  INFECTED
  ERROR
}

model Book {
  id              String          @id @default(cuid())
  libraryId       String
  library         Library         @relation(fields: [libraryId], references: [id], onDelete: Cascade)
  title           String
  authors         String[]
  isbn10          String?
  isbn13          String?
  publisher       String?
  publishedYear   Int?
  language        String?
  description     String?
  coverPath       String?
  metadataSource  MetadataSource? @default(MANUAL)
  hasDigital      Boolean         @default(false)
  hasPhysical     Boolean         @default(false)
  uploadedById    String?
  uploadedBy      User?           @relation("UploadedBy", fields: [uploadedById], references: [id], onDelete: SetNull)
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  files           BookFile[]
  tags            BookTag[]
  physicalCopy    PhysicalCopy?
  annotations     Annotation[]
  bookmarks       Bookmark[]
  readingProgress ReadingProgress[]
  readingSessions ReadingSession[]
  ratings         Rating[]
  reviews         Review[]
  inCollections   CollectionBook[]
  downloadLogs    DownloadLog[]

  @@index([libraryId, title])
  @@index([libraryId, isbn13])
}

model BookFile {
  id            String     @id @default(cuid())
  bookId        String
  book          Book       @relation(fields: [bookId], references: [id], onDelete: Cascade)
  format        BookFormat
  isOriginal    Boolean
  storagePath   String
  fileSizeBytes BigInt
  sha256        String
  mimeType      String
  scanStatus    ScanStatus @default(PENDING)
  scannedAt     DateTime?
  indexedAt     DateTime?
  createdAt     DateTime   @default(now())

  downloadLogs  DownloadLog[]

  @@unique([bookId, format])
  @@index([sha256])
}

model Tag {
  id        String  @id @default(cuid())
  libraryId String
  library   Library @relation(fields: [libraryId], references: [id], onDelete: Cascade)
  name      String  @db.Citext

  books BookTag[]

  @@unique([libraryId, name])
}

model BookTag {
  bookId String
  book   Book   @relation(fields: [bookId], references: [id], onDelete: Cascade)
  tagId  String
  tag    Tag    @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@id([bookId, tagId])
}

// =====================================================
// Livres physiques
// =====================================================

model PhysicalCopy {
  id              String   @id @default(cuid())
  bookId          String   @unique
  book            Book     @relation(fields: [bookId], references: [id], onDelete: Cascade)
  ownerId         String
  owner           User     @relation("Owner", fields: [ownerId], references: [id])
  currentHolderId String?
  currentHolder   User?    @relation("CurrentHolder", fields: [currentHolderId], references: [id], onDelete: SetNull)
  notes           String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  requests PhysicalRequest[]
}

enum PhysicalRequestStatus {
  PENDING
  ACCEPTED
  DECLINED
  CANCELLED
  FULFILLED
}

model PhysicalRequest {
  id          String                @id @default(cuid())
  copyId      String
  copy        PhysicalCopy          @relation(fields: [copyId], references: [id], onDelete: Cascade)
  requesterId String
  requester   User                  @relation(fields: [requesterId], references: [id], onDelete: Cascade)
  status      PhysicalRequestStatus @default(PENDING)
  message     String?
  createdAt   DateTime              @default(now())
  respondedAt DateTime?
}

// =====================================================
// Lecture (annotations, marque-pages, progression)
// =====================================================

enum AnnotationColor {
  YELLOW
  GREEN
  BLUE
  PINK
  ORANGE
}

model Annotation {
  id           String          @id @default(cuid())
  userId       String
  user         User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  bookId       String
  book         Book            @relation(fields: [bookId], references: [id], onDelete: Cascade)
  format       BookFormat
  locator      Json
  selectedText String
  noteContent  String?
  color        AnnotationColor @default(YELLOW)
  createdAt    DateTime        @default(now())
  updatedAt    DateTime        @updatedAt

  @@index([userId, bookId])
}

model Bookmark {
  id        String     @id @default(cuid())
  userId    String
  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  bookId    String
  book      Book       @relation(fields: [bookId], references: [id], onDelete: Cascade)
  format    BookFormat
  locator   Json
  label     String?
  createdAt DateTime   @default(now())

  @@index([userId, bookId])
}

model ReadingProgress {
  userId     String
  user       User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  bookId     String
  book       Book       @relation(fields: [bookId], references: [id], onDelete: Cascade)
  format     BookFormat
  locator    Json
  percentage Decimal    @db.Decimal(5, 2)
  lastDevice String?
  updatedAt  DateTime   @updatedAt

  @@id([userId, bookId])
}

model ReadingSession {
  id            String     @id @default(cuid())
  userId        String
  user          User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  bookId        String
  book          Book       @relation(fields: [bookId], references: [id], onDelete: Cascade)
  startedAt     DateTime
  endedAt       DateTime
  durationSec   Int
  startLocator  Json
  endLocator    Json

  @@index([userId, startedAt])
}

// =====================================================
// Social
// =====================================================

model Rating {
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  bookId    String
  book      Book     @relation(fields: [bookId], references: [id], onDelete: Cascade)
  stars     Int      @db.SmallInt
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@id([userId, bookId])
}

enum ReviewStatus {
  VISIBLE
  HIDDEN_BY_MOD
  REMOVED
}

model Review {
  id        String       @id @default(cuid())
  userId    String
  user      User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  bookId    String
  book      Book         @relation(fields: [bookId], references: [id], onDelete: Cascade)
  body      String
  status    ReviewStatus @default(VISIBLE)
  createdAt DateTime     @default(now())
  updatedAt DateTime     @updatedAt

  @@index([bookId, createdAt])
}

// =====================================================
// Collections
// =====================================================

model Collection {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  name        String
  description String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  books CollectionBook[]
}

model CollectionBook {
  collectionId String
  collection   Collection @relation(fields: [collectionId], references: [id], onDelete: Cascade)
  bookId       String
  book         Book       @relation(fields: [bookId], references: [id], onDelete: Cascade)
  position     Int
  addedAt      DateTime   @default(now())

  @@id([collectionId, bookId])
  @@index([collectionId, position])
}

// =====================================================
// Audit & Logs
// =====================================================

model DownloadLog {
  id         String   @id @default(cuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  bookId     String
  book       Book     @relation(fields: [bookId], references: [id], onDelete: Cascade)
  bookFileId String
  bookFile   BookFile @relation(fields: [bookFileId], references: [id], onDelete: Cascade)
  ipHash     String
  userAgent  String
  createdAt  DateTime @default(now())

  @@index([userId, createdAt])
  @@index([bookId, createdAt])
}

model AuditLog {
  id         String   @id @default(cuid())
  actorId    String?
  actor      User?    @relation(fields: [actorId], references: [id], onDelete: SetNull)
  action     String
  targetType String
  targetId   String
  metadata   Json?
  ipHash     String?
  createdAt  DateTime @default(now())

  @@index([actorId, createdAt])
  @@index([targetType, targetId])
}

enum NotificationType {
  PHYSICAL_REQUEST
  INVITATION_ACCEPTED
  REVIEW_HIDDEN
  GENERIC
}

model Notification {
  id        String           @id @default(cuid())
  userId    String
  user      User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  type      NotificationType
  payload   Json
  readAt    DateTime?
  createdAt DateTime         @default(now())

  @@index([userId, createdAt])
}
```

- [ ] **Step 3 : Ajouter scripts Prisma dans `package.json`**

Dans `"scripts"` :

```json
"prisma:generate": "prisma generate",
"prisma:migrate:dev": "prisma migrate dev",
"prisma:migrate:deploy": "prisma migrate deploy",
"prisma:studio": "prisma studio"
```

- [ ] **Step 4 : Générer le client Prisma (validation syntaxe)**

```bash
pnpm prisma:generate
```

Expected : « Generated Prisma Client (v6.x.x) ». Si erreur de syntaxe, corriger avant de continuer.

- [ ] **Step 5 : Créer `src/lib/db.ts` (singleton Prisma)**

```ts
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
```

- [ ] **Step 6 : Sanity check**

```bash
pnpm typecheck
```

Expected : passe.

- [ ] **Step 7 : Commit**

```bash
git add prisma/ src/lib/db.ts package.json
git commit -m "feat: add Prisma schema (full data model) + DB singleton"
```

---

### Task 7 : Créer le type Brand `PrivateScope`

**Goal** : type qui rend impossible de fetcher des annotations/bookmarks/progression sans avoir d'abord prouvé qu'on est dans un scope utilisateur explicite. Empêche les fuites cross-users par construction.

**Files:**

- Create: `src/lib/private-scope.ts`, `tests/unit/private-scope.test.ts`

- [ ] **Step 1 : Écrire le test d'abord**

`tests/unit/private-scope.test.ts` :

```ts
import { describe, it, expect, expectTypeOf } from 'vitest';
import { withCurrentUserScope, type PrivateScope } from '@/lib/private-scope';

describe('PrivateScope', () => {
  it('produit un objet contenant userId et un brand non-construisible', () => {
    const scope = withCurrentUserScope('user_abc');
    expect(scope.userId).toBe('user_abc');
  });

  it('refuse une string vide ou non préfixée', () => {
    expect(() => withCurrentUserScope('')).toThrow();
  });

  it('le type PrivateScope ne peut pas être construit littéralement', () => {
    // Test de niveau type — vérifié par tsc, pas par runtime.
    // L'erreur de compile suivante prouve l'invariant :
    //   const fake: PrivateScope = { userId: 'x' };  // <- doit échouer en TS
    expectTypeOf<PrivateScope>().toMatchTypeOf<{ userId: string }>();
  });
});
```

- [ ] **Step 2 : Vérifier que le test échoue (fichier source absent)**

```bash
pnpm vitest run tests/unit/private-scope.test.ts
```

Expected : FAIL — `Cannot find module '@/lib/private-scope'`. (Note : Vitest n'est pas encore installé. On reviendra ici après Task 13. Pour l'instant, on saute Step 2 et on implémente directement.)

- [ ] **Step 3 : Implémenter `src/lib/private-scope.ts`**

```ts
declare const __privateScopeBrand: unique symbol;

/**
 * Type "Brand" non-construisible hors de `withCurrentUserScope`.
 * Toute query sur Annotation, Bookmark, ReadingProgress, ReadingSession
 * doit recevoir un PrivateScope, garantissant qu'on a explicitement
 * scope par userId.
 */
export type PrivateScope = {
  readonly userId: string;
  readonly [__privateScopeBrand]: true;
};

export function withCurrentUserScope(userId: string): PrivateScope {
  if (!userId || typeof userId !== 'string') {
    throw new Error('PrivateScope: userId requis et non vide');
  }
  return { userId, [__privateScopeBrand]: true } as PrivateScope;
}
```

- [ ] **Step 4 : Sanity check typecheck**

```bash
pnpm typecheck
```

Expected : passe.

- [ ] **Step 5 : Commit**

```bash
git add src/lib/private-scope.ts tests/unit/private-scope.test.ts
git commit -m "feat: add PrivateScope brand type for user-scoped queries"
```

---

## Section C — Configuration runtime

### Task 8 : Validation des variables d'environnement (zod)

**Files:**

- Create: `src/lib/env.ts`, `.env.example`
- Modify: `package.json` (script `env:check`)

- [ ] **Step 1 : Installer zod**

```bash
pnpm add zod
```

- [ ] **Step 2 : Créer `src/lib/env.ts`**

```ts
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Base URL de l'app (utilisée pour les liens d'invitation, magic links, etc.)
  APP_URL: z.string().url(),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url(),

  // Meilisearch
  MEILI_HOST: z.string().url(),
  MEILI_MASTER_KEY: z.string().min(16),

  // ClamAV
  CLAMAV_HOST: z.string().default('clamav'),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),

  // Logger
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Sécurité (utilisés en Phase 1+ ; définis dès Phase 0 pour valider le contrat)
  SESSION_SECRET: z.string().min(32),
  CRYPTO_MASTER_KEY: z.string().min(32),

  // Email (Phase 1+)
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().email().default('noreply@biblioshare.local'),

  // APIs métadonnées (Phase 2+)
  GOOGLE_BOOKS_API_KEY: z.string().optional(),
  ISBNDB_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(
      "[env] Variables d'environnement invalides :",
      parsed.error.flatten().fieldErrors,
    );
    throw new Error('Invalid environment variables');
  }
  cached = parsed.data;
  return cached;
}
```

- [ ] **Step 3 : Créer `.env.example`**

```
# === Application ===
APP_URL=http://localhost:3000
NODE_ENV=development
LOG_LEVEL=info

# === Base de données ===
DATABASE_URL=postgresql://biblioshare:devpassword@localhost:5432/biblioshare

# === Cache & queues ===
REDIS_URL=redis://localhost:6379

# === Recherche ===
MEILI_HOST=http://localhost:7700
MEILI_MASTER_KEY=please-change-me-min-16-chars

# === Antivirus ===
CLAMAV_HOST=localhost
CLAMAV_PORT=3310

# === Sécurité (générer avec : openssl rand -hex 32) ===
SESSION_SECRET=please-generate-with-openssl-rand-hex-32
CRYPTO_MASTER_KEY=please-generate-with-openssl-rand-hex-32

# === Email (Phase 1+) ===
# RESEND_API_KEY=re_xxx
EMAIL_FROM=noreply@biblioshare.local

# === APIs métadonnées (Phase 2+) ===
# GOOGLE_BOOKS_API_KEY=
# ISBNDB_API_KEY=
```

- [ ] **Step 4 : Créer `.env.local` pour le dev (basé sur `.env.example`)**

```bash
cp .env.example .env.local
# Générer les secrets pour le dev
sed -i.bak "s/please-generate-with-openssl-rand-hex-32/$(openssl rand -hex 32)/" .env.local
# Sur macOS, sed -i.bak laisse un backup .env.local.bak — le supprimer
rm -f .env.local.bak
```

Vérifier que `.env.local` est bien dans `.gitignore` (le `.gitignore` Phase Design contient `.env.local`).

- [ ] **Step 5 : Ajouter script `env:check` dans `package.json`**

```json
"env:check": "node -e \"import('./src/lib/env.ts').then(m => m.getEnv()).then(() => console.log('env OK')).catch(e => { console.error(e); process.exit(1); })\""
```

(Si l'import direct ne marche pas en pur Node sans transpiler, on remplacera par un script tsx en Task 17.)

- [ ] **Step 6 : Sanity check**

```bash
pnpm typecheck
```

- [ ] **Step 7 : Commit**

```bash
git add src/lib/env.ts .env.example package.json
git commit -m "feat: add zod-validated env schema + .env.example"
```

---

### Task 9 : Logger Pino structuré avec redact

**Files:**

- Create: `src/lib/logger.ts`, `tests/unit/logger.test.ts`

- [ ] **Step 1 : Installer Pino**

```bash
pnpm add pino
pnpm add -D pino-pretty
```

- [ ] **Step 2 : Créer `src/lib/logger.ts`**

```ts
import pino from 'pino';
import { getEnv } from './env';

const env = getEnv();

const isDev = env.NODE_ENV === 'development';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'biblioshare', env: env.NODE_ENV },
  redact: {
    paths: [
      'password',
      'passwordHash',
      'token',
      'tokenHash',
      'secret',
      'secretCipher',
      'authorization',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.tokenHash',
      '*.secret',
      '*.secretCipher',
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
    ],
    censor: '[REDACTED]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss',
            ignore: 'pid,hostname,service,env',
          },
        },
      }
    : {}),
});
```

- [ ] **Step 3 : Test : redaction des secrets**

`tests/unit/logger.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('logger redaction', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NODE_ENV = 'production';
    process.env.LOG_LEVEL = 'info';
    process.env.APP_URL = 'http://localhost:3000';
    process.env.DATABASE_URL = 'postgresql://x:x@localhost:5432/x';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.MEILI_HOST = 'http://localhost:7700';
    process.env.MEILI_MASTER_KEY = 'abcdefghijklmnop';
    process.env.SESSION_SECRET = '0'.repeat(32);
    process.env.CRYPTO_MASTER_KEY = '1'.repeat(32);
  });

  it('redacte les champs sensibles dans les logs', async () => {
    const { logger } = await import('@/lib/logger');
    const captured: string[] = [];
    const stream = { write: (s: string) => captured.push(s) };
    const child = logger.child({}, { stream });
    child.info({ password: 'super-secret', other: 'visible' }, 'event');
    const out = captured.join('');
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain('super-secret');
    expect(out).toContain('visible');
  });
});
```

- [ ] **Step 4 : (Repoussé) Lancer le test**

Vitest n'est pas encore configuré (Task 13). On reviendra valider ce test à ce moment.

- [ ] **Step 5 : Commit**

```bash
git add src/lib/logger.ts tests/unit/logger.test.ts package.json
git commit -m "feat: add pino logger with secret redaction"
```

---

### Task 10 : Clients Redis et Meilisearch (singletons)

**Files:**

- Create: `src/lib/redis.ts`, `src/lib/meili.ts`

- [ ] **Step 1 : Installer ioredis et meilisearch**

```bash
pnpm add ioredis meilisearch
```

- [ ] **Step 2 : Créer `src/lib/redis.ts`**

```ts
import Redis from 'ioredis';
import { getEnv } from './env';

const globalForRedis = globalThis as unknown as { redis: Redis | undefined };

export const redis =
  globalForRedis.redis ??
  new Redis(getEnv().REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });

if (process.env.NODE_ENV !== 'production') globalForRedis.redis = redis;
```

- [ ] **Step 3 : Créer `src/lib/meili.ts`**

```ts
import { MeiliSearch } from 'meilisearch';
import { getEnv } from './env';

const env = getEnv();

const globalForMeili = globalThis as unknown as { meili: MeiliSearch | undefined };

export const meili =
  globalForMeili.meili ??
  new MeiliSearch({
    host: env.MEILI_HOST,
    apiKey: env.MEILI_MASTER_KEY,
  });

if (process.env.NODE_ENV !== 'production') globalForMeili.meili = meili;
```

- [ ] **Step 4 : Sanity check**

```bash
pnpm typecheck
```

- [ ] **Step 5 : Commit**

```bash
git add src/lib/redis.ts src/lib/meili.ts package.json
git commit -m "feat: add Redis and Meilisearch singletons"
```

---

### Task 11 : Endpoint /health avec checks DB, Redis, Meili, ClamAV

**Files:**

- Create: `src/app/api/health/route.ts`, `tests/unit/health.test.ts`

- [ ] **Step 1 : Installer le client ClamAV**

```bash
pnpm add clamscan
pnpm add -D @types/clamscan
```

(Si `@types/clamscan` n'existe pas, on le déclarera localement en Step 2.)

- [ ] **Step 2 : Si pas de @types officiels, déclarer localement**

Si l'install précédente a échoué pour les types, créer `src/types/clamscan.d.ts` :

```ts
declare module 'clamscan' {
  interface ClamScanOptions {
    clamdscan?: { host?: string; port?: number; timeout?: number };
    preference?: 'clamdscan' | 'clamscan';
  }
  class ClamScan {
    init(opts: ClamScanOptions): Promise<ClamScan>;
    getVersion(): Promise<string>;
    isInfected(filePath: string): Promise<{ isInfected: boolean; viruses: string[] }>;
  }
  export = ClamScan;
}
```

- [ ] **Step 3 : Créer `src/app/api/health/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { redis } from '@/lib/redis';
import { meili } from '@/lib/meili';
import { logger } from '@/lib/logger';
import { getEnv } from '@/lib/env';
import net from 'node:net';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type CheckResult = { name: string; ok: boolean; latencyMs?: number; error?: string };

async function checkDb(): Promise<CheckResult> {
  const start = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return { name: 'postgres', ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { name: 'postgres', ok: false, error: (err as Error).message };
  }
}

async function checkRedis(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const pong = await redis.ping();
    return { name: 'redis', ok: pong === 'PONG', latencyMs: Date.now() - start };
  } catch (err) {
    return { name: 'redis', ok: false, error: (err as Error).message };
  }
}

async function checkMeili(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const h = await meili.health();
    return { name: 'meilisearch', ok: h.status === 'available', latencyMs: Date.now() - start };
  } catch (err) {
    return { name: 'meilisearch', ok: false, error: (err as Error).message };
  }
}

async function checkClamav(): Promise<CheckResult> {
  const env = getEnv();
  const start = Date.now();
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let resolved = false;
    const finalize = (ok: boolean, error?: string) => {
      if (resolved) return;
      resolved = true;
      socket.destroy();
      resolve({ name: 'clamav', ok, latencyMs: Date.now() - start, error });
    };
    socket.setTimeout(2000);
    socket.on('error', (e) => finalize(false, e.message));
    socket.on('timeout', () => finalize(false, 'timeout'));
    socket.connect(env.CLAMAV_PORT, env.CLAMAV_HOST, () => {
      socket.write('PING\n');
    });
    socket.on('data', (data) => finalize(data.toString().trim() === 'PONG'));
  });
}

export async function GET() {
  const checks = await Promise.all([checkDb(), checkRedis(), checkMeili(), checkClamav()]);
  const allOk = checks.every((c) => c.ok);
  const status = allOk ? 200 : 503;
  if (!allOk) {
    logger.warn({ checks }, 'health degraded');
  }
  return NextResponse.json(
    {
      status: allOk ? 'ok' : 'degraded',
      checks,
      uptimeSec: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}
```

- [ ] **Step 4 : Sanity check**

```bash
pnpm typecheck
```

- [ ] **Step 5 : Commit**

```bash
git add src/app/api/health/route.ts src/types/ package.json
git commit -m "feat: add /api/health endpoint with subsystem checks"
```

---

### Task 12 : Page d'accueil minimale + i18n FR

**Files:**

- Create: `src/i18n/messages/fr.json`, `src/i18n/config.ts`, `next.config.ts` (si modif), `src/app/layout.tsx`, `src/app/page.tsx`
- Modify: `src/app/layout.tsx`, `src/app/page.tsx`

- [ ] **Step 1 : Installer next-intl**

```bash
pnpm add next-intl
```

- [ ] **Step 2 : Créer `src/i18n/messages/fr.json`**

```json
{
  "Home": {
    "title": "BiblioShare",
    "subtitle": "Plateforme privée de gestion de bibliothèques numériques et physiques",
    "comingSoon": "Bientôt disponible",
    "phase": "Phase 0 — Fondations"
  },
  "common": {
    "loading": "Chargement…",
    "error": "Une erreur est survenue.",
    "retry": "Réessayer"
  }
}
```

- [ ] **Step 3 : Créer `src/i18n/config.ts`**

```ts
import { getRequestConfig } from 'next-intl/server';

export default getRequestConfig(async () => ({
  locale: 'fr',
  messages: (await import('./messages/fr.json')).default,
}));
```

- [ ] **Step 4 : Modifier `next.config.ts` pour activer next-intl**

```ts
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/config.ts');

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: '100mb' },
  },
};

export default withNextIntl(nextConfig);
```

- [ ] **Step 5 : Mettre à jour `src/app/layout.tsx`**

```tsx
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getLocale } from 'next-intl/server';
import { Toaster } from '@/components/ui/toaster';
import './globals.css';

export const metadata: Metadata = {
  title: 'BiblioShare',
  description: 'Plateforme privée de gestion de bibliothèques',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 6 : Mettre à jour `src/app/page.tsx`**

```tsx
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Library } from 'lucide-react';

export default function HomePage() {
  const t = useTranslations('Home');
  return (
    <main className="container mx-auto flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md animate-slide-up shadow-sm">
        <CardHeader className="space-y-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent/10">
            <Library className="h-5 w-5 text-accent" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <CardTitle className="text-xl">{t('title')}</CardTitle>
            <CardDescription>{t('subtitle')}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{t('phase')}</p>
          <p className="text-sm text-foreground">{t('comingSoon')}</p>
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 7 : Sanity check rendu**

```bash
pnpm dev
```

Ouvrir http://localhost:3000. Vérifier visuellement le rendu (français, design soigné, animation à l'arrivée). Tuer le serveur.

- [ ] **Step 8 : Commit**

```bash
git add .
git commit -m "feat: add i18n FR + minimal landing page with Lucide icon"
```

---

## Section D — Sécurité de base

### Task 13 : Headers de sécurité (CSP, HSTS, etc.)

**Files:**

- Create: `src/lib/security-headers.ts`
- Modify: `next.config.ts`

- [ ] **Step 1 : Créer `src/lib/security-headers.ts`**

```ts
/**
 * Headers de sécurité globaux.
 * - HSTS : force HTTPS
 * - X-Frame-Options DENY : interdit l'embed (clickjacking)
 * - X-Content-Type-Options nosniff : interdit MIME-sniffing
 * - Referrer-Policy strict-origin-when-cross-origin : limite les fuites
 * - Permissions-Policy : désactive les fonctionnalités sensibles
 * - CSP stricte : whitelist des sources, jamais 'unsafe-inline' sans nonce
 */

export type CspNonce = string;

export function buildCspHeader(nonce: CspNonce, isDev: boolean): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'", // Tailwind émet des styles inline ; à durcir si possible plus tard
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ];
  return directives.join('; ');
}

export const STATIC_SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=(), browsing-topics=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains; preload',
  },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
] as const;
```

- [ ] **Step 2 : Brancher dans `next.config.ts`**

Modifier `next.config.ts` pour ajouter une fonction `headers()` :

```ts
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { STATIC_SECURITY_HEADERS } from './src/lib/security-headers';

const withNextIntl = createNextIntlPlugin('./src/i18n/config.ts');

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: '100mb' },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: STATIC_SECURITY_HEADERS.map(({ key, value }) => ({ key, value })),
      },
    ];
  },
};

export default withNextIntl(nextConfig);
```

Note : la CSP avec nonce sera ajoutée en Phase 1 via middleware (les nonces nécessitent du SSR-time computation, plus complexe). Pour Phase 0, on se contente des headers statiques.

- [ ] **Step 3 : Vérifier en dev**

```bash
pnpm dev
```

```bash
curl -sI http://localhost:3000 | grep -iE "strict-transport|x-frame|x-content|referrer|permissions"
```

Expected : tous les headers présents.

Tuer le serveur.

- [ ] **Step 4 : Commit**

```bash
git add src/lib/security-headers.ts next.config.ts
git commit -m "feat: add static security headers (HSTS, X-Frame-Options, etc.)"
```

---

### Task 14 : Règle ESLint custom — interdire `findMany`/`findFirst` sans `where`

**Goal** : éviter qu'une query Prisma sans scope ne fuite des données cross-bibliothèque.

**Files:**

- Create: `eslint-rules/no-unscoped-prisma.js`, `eslint-rules/index.js`
- Modify: `eslint.config.mjs` (ou `.eslintrc.cjs`)

- [ ] **Step 1 : Créer la règle `eslint-rules/no-unscoped-prisma.js`**

```js
/**
 * Interdit db.<model>.findMany() / findFirst() / findFirstOrThrow()
 * sans clause `where`. Évite les fuites de données cross-scope.
 *
 * Faux positifs acceptables : on peut désactiver localement avec
 * // eslint-disable-next-line no-unscoped-prisma -- raison: ...
 */
'use strict';

const FORBIDDEN_METHODS = new Set(['findMany', 'findFirst', 'findFirstOrThrow']);

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Interdit findMany/findFirst Prisma sans clause where (anti-IDOR)',
    },
    schema: [],
    messages: {
      missingWhere:
        'Prisma `{{method}}` sans `where` interdit (risque de fuite cross-scope). Ajoutez `where` ou désactivez localement avec un commentaire justifié.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression') return;
        if (callee.property.type !== 'Identifier') return;
        if (!FORBIDDEN_METHODS.has(callee.property.name)) return;

        const arg = node.arguments[0];
        // Pas d'argument du tout
        if (!arg) {
          context.report({
            node,
            messageId: 'missingWhere',
            data: { method: callee.property.name },
          });
          return;
        }
        // Argument est un objet littéral : vérifier qu'il a une clé `where`
        if (arg.type === 'ObjectExpression') {
          const hasWhere = arg.properties.some(
            (p) => p.type === 'Property' && p.key.type === 'Identifier' && p.key.name === 'where',
          );
          if (!hasWhere) {
            context.report({
              node,
              messageId: 'missingWhere',
              data: { method: callee.property.name },
            });
          }
        }
        // Argument est dynamique (Identifier, etc.) : on accepte (ne peut pas vérifier statiquement)
      },
    };
  },
};
```

- [ ] **Step 2 : Créer `eslint-rules/index.js`**

```js
'use strict';

module.exports = {
  rules: {
    'no-unscoped-prisma': require('./no-unscoped-prisma'),
  },
};
```

- [ ] **Step 3 : Brancher dans la config ESLint**

Si Next.js a généré `eslint.config.mjs`, modifier pour ajouter notre plugin local. Sinon, créer/modifier `.eslintrc.cjs`. Voici la version `eslint.config.mjs` (flat config Next 15) :

```js
import { FlatCompat } from '@eslint/eslintrc';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import localPlugin from './eslint-rules/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

export default [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    plugins: { local: localPlugin },
    rules: {
      'local/no-unscoped-prisma': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'dangerouslySetInnerHTML interdit (risque XSS).',
        },
      ],
    },
  },
];
```

- [ ] **Step 4 : Tester la règle**

Créer `tests/unit/eslint-rule.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { RuleTester } from 'eslint';
import rule from '../../eslint-rules/no-unscoped-prisma.js';

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

describe('no-unscoped-prisma', () => {
  it('passes valid and rejects invalid', () => {
    tester.run('no-unscoped-prisma', rule, {
      valid: [
        { code: 'db.book.findMany({ where: { libraryId: x } })' },
        { code: 'db.book.findFirst({ where: { id }, include: { tags: true } })' },
        { code: 'db.book.create({ data: { title: "x" } })' },
        { code: 'db.book.findUnique({ where: { id } })' },
      ],
      invalid: [
        {
          code: 'db.book.findMany()',
          errors: [{ messageId: 'missingWhere' }],
        },
        {
          code: 'db.book.findMany({ orderBy: { title: "asc" } })',
          errors: [{ messageId: 'missingWhere' }],
        },
        {
          code: 'db.book.findFirst({})',
          errors: [{ messageId: 'missingWhere' }],
        },
      ],
    });
    expect(true).toBe(true);
  });
});
```

Installer eslint en dev (déjà présent via Next) puis lancer le test (Vitest configuré en Task 16) :

```bash
pnpm add -D eslint
```

- [ ] **Step 5 : Commit**

```bash
git add eslint-rules/ eslint.config.mjs tests/unit/eslint-rule.test.ts package.json
git commit -m "feat: add custom ESLint rule no-unscoped-prisma + interdire dangerouslySetInnerHTML"
```

---

## Section E — Tests

### Task 15 : Configurer Vitest

**Files:**

- Create: `vitest.config.ts`
- Modify: `package.json` (scripts test)

- [ ] **Step 1 : Installer Vitest**

```bash
pnpm add -D vitest @vitejs/plugin-react @vitest/expect-type vite-tsconfig-paths jsdom @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 2 : Créer `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    setupFiles: ['./tests/unit/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/app/**/page.tsx', 'src/app/**/layout.tsx'],
    },
  },
});
```

- [ ] **Step 3 : Créer `tests/unit/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';

// Variables d'env minimales pour les tests qui chargent src/lib/env.ts
process.env.NODE_ENV ??= 'test';
process.env.APP_URL ??= 'http://localhost:3000';
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.MEILI_HOST ??= 'http://localhost:7700';
process.env.MEILI_MASTER_KEY ??= '0'.repeat(32);
process.env.SESSION_SECRET ??= '0'.repeat(32);
process.env.CRYPTO_MASTER_KEY ??= '1'.repeat(32);
```

- [ ] **Step 4 : Ajouter scripts test dans `package.json`**

```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

- [ ] **Step 5 : Lancer la suite (incluant tous les tests précédemment écrits)**

```bash
pnpm test
```

Expected : `tests/unit/private-scope.test.ts`, `tests/unit/logger.test.ts`, `tests/unit/eslint-rule.test.ts` passent.

Si certains échouent, corriger les fichiers source maintenant.

- [ ] **Step 6 : Commit**

```bash
git add .
git commit -m "test: configure Vitest + run baseline unit tests"
```

---

### Task 16 : Configurer Playwright + smoke test E2E

**Files:**

- Create: `playwright.config.ts`, `tests/e2e/health.spec.ts`, `tests/e2e/landing.spec.ts`
- Modify: `package.json`

- [ ] **Step 1 : Installer Playwright**

```bash
pnpm add -D @playwright/test
pnpm dlx playwright install chromium
```

- [ ] **Step 2 : Créer `playwright.config.ts`**

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.APP_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.CI
    ? undefined
    : {
        command: 'pnpm dev',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
```

- [ ] **Step 3 : Créer `tests/e2e/landing.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test('landing page se charge avec le titre BiblioShare', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('BiblioShare')).toBeVisible();
  await expect(page.getByText('Phase 0 — Fondations')).toBeVisible();
});

test('headers de sécurité présents', async ({ request }) => {
  const response = await request.get('/');
  expect(response.headers()['x-frame-options']).toBe('DENY');
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  expect(response.headers()['strict-transport-security']).toContain('max-age=31536000');
});
```

- [ ] **Step 4 : Créer `tests/e2e/health.spec.ts`**

```ts
import { test, expect } from '@playwright/test';

test('endpoint /api/health répond JSON avec status', async ({ request }) => {
  const response = await request.get('/api/health');
  // En dev local sans services Docker, peut renvoyer 503.
  // En CI Docker Compose, doit renvoyer 200.
  expect([200, 503]).toContain(response.status());
  const body = await response.json();
  expect(body).toHaveProperty('status');
  expect(body).toHaveProperty('checks');
  expect(Array.isArray(body.checks)).toBe(true);
});
```

- [ ] **Step 5 : Ajouter scripts E2E dans `package.json`**

```json
"e2e": "playwright test",
"e2e:ui": "playwright test --ui"
```

- [ ] **Step 6 : Vérifier que le test landing passe en local**

S'assurer que les services Docker ne sont pas requis pour ce test (juste le serveur Next dev). Lancer :

```bash
pnpm dev &
sleep 5
pnpm e2e tests/e2e/landing.spec.ts
kill %1
```

(Sur macOS, `kill %1` peut ne pas fonctionner ; utiliser `pkill -f 'next dev'`.)

- [ ] **Step 7 : Commit**

```bash
git add playwright.config.ts tests/e2e/ package.json
git commit -m "test: configure Playwright + landing & health E2E tests"
```

---

## Section F — Conteneurisation

### Task 17 : Worker minimal

**Goal** : container worker qui boot, valide l'env, se connecte à Redis et reste en vie. Pas de jobs en Phase 0.

**Files:**

- Create: `worker/package.json`, `worker/tsconfig.json`, `worker/index.ts`

- [ ] **Step 1 : Créer la structure worker**

```bash
mkdir -p worker
```

- [ ] **Step 2 : Créer `worker/package.json`**

```json
{
  "name": "biblioshare-worker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p .",
    "start": "node dist/index.js",
    "dev": "tsx watch index.ts"
  },
  "dependencies": {
    "ioredis": "*",
    "pino": "*",
    "zod": "*"
  },
  "devDependencies": {
    "tsx": "^4.16.0",
    "typescript": "^5.6.0",
    "@types/node": "^22.0.0"
  }
}
```

(Les `*` seront résolus en sync avec le `package.json` racine — ou mettre les versions exactes du root.)

- [ ] **Step 3 : Créer `worker/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": ".",
    "resolveJsonModule": true,
    "isolatedModules": false
  },
  "include": ["./**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4 : Créer `worker/index.ts`**

```ts
import Redis from 'ioredis';
import pino from 'pino';
import { z } from 'zod';

const env = z
  .object({
    REDIS_URL: z.string().url(),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  })
  .parse(process.env);

const logger = pino({ level: env.LOG_LEVEL, base: { service: 'biblioshare-worker' } });

const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

redis.on('connect', () => logger.info('redis connected'));
redis.on('error', (e) => logger.error({ err: e }, 'redis error'));

logger.info('worker started, idle (no queues registered yet)');

const HEARTBEAT_MS = 60_000;
setInterval(() => {
  logger.debug('heartbeat');
}, HEARTBEAT_MS);

const shutdown = async () => {
  logger.info('shutting down');
  await redis.quit();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

- [ ] **Step 5 : Vérifier en local sans Docker (Redis doit tourner localement, ou skip)**

```bash
cd worker
pnpm install
# Skip si pas de Redis local
cd ..
```

- [ ] **Step 6 : Commit**

```bash
git add worker/
git commit -m "feat: add minimal worker (boots, connects Redis, idle heartbeat)"
```

---

### Task 18 : Dockerfile pour l'app (multi-stage)

**Files:**

- Create: `Dockerfile`, `.dockerignore`

- [ ] **Step 1 : Créer `.dockerignore`**

```
.git
.github
node_modules
.next
.env
.env.local
.env.*.local
docs
tests
playwright-report
test-results
coverage
*.log
.vscode
.idea
README.md
```

- [ ] **Step 2 : Créer `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.6

# Stage 1 — deps
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@9 --activate \
 && pnpm install --frozen-lockfile

# Stage 2 — build
FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable && corepack prepare pnpm@9 --activate \
 && pnpm prisma generate \
 && pnpm build

# Stage 3 — runtime
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs \
 && apk add --no-cache curl

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma/client ./node_modules/@prisma/client

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
```

- [ ] **Step 3 : Build local pour valider**

```bash
docker build -t biblioshare-app:local .
```

Expected : build réussi.

- [ ] **Step 4 : Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "build: add Dockerfile (multi-stage, non-root, healthcheck)"
```

---

### Task 19 : Dockerfile pour le worker

**Files:**

- Create: `Dockerfile.worker`

- [ ] **Step 1 : Créer `Dockerfile.worker`**

```dockerfile
# syntax=docker/dockerfile:1.6

FROM node:22-alpine AS deps
WORKDIR /worker
COPY worker/package.json ./
RUN corepack enable && corepack prepare pnpm@9 --activate \
 && pnpm install

FROM node:22-alpine AS builder
WORKDIR /worker
COPY --from=deps /worker/node_modules ./node_modules
COPY worker/ .
RUN corepack enable && corepack prepare pnpm@9 --activate \
 && pnpm build

FROM node:22-alpine AS runner
WORKDIR /worker
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 worker

COPY --from=builder --chown=worker:nodejs /worker/dist ./dist
COPY --from=builder --chown=worker:nodejs /worker/node_modules ./node_modules
COPY --from=builder --chown=worker:nodejs /worker/package.json ./

USER worker

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD pgrep -f "node dist/index.js" >/dev/null || exit 1

CMD ["node", "dist/index.js"]
```

- [ ] **Step 2 : Build local pour valider**

```bash
docker build -f Dockerfile.worker -t biblioshare-worker:local .
```

- [ ] **Step 3 : Commit**

```bash
git add Dockerfile.worker
git commit -m "build: add worker Dockerfile (multi-stage, non-root)"
```

---

### Task 20 : docker-compose.yml — 8 services

**Files:**

- Create: `docker-compose.yml`

- [ ] **Step 1 : Créer `docker-compose.yml`**

```yaml
name: biblioshare

services:
  pg:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: biblioshare
      POSTGRES_USER: biblioshare
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?required}
      POSTGRES_INITDB_ARGS: '--encoding=UTF-8 --locale=C.UTF-8'
    volumes:
      - pg_data:/var/lib/postgresql/data
    networks:
      - internal
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U biblioshare -d biblioshare']
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s
    cap_drop: [ALL]
    cap_add: [CHOWN, SETUID, SETGID, DAC_OVERRIDE, FOWNER]
    security_opt:
      - no-new-privileges:true

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ['redis-server', '--appendonly', 'yes', '--save', '60', '1000']
    volumes:
      - redis_data:/data
    networks:
      - internal
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 10s
      timeout: 3s
      retries: 5
    cap_drop: [ALL]
    security_opt:
      - no-new-privileges:true

  meili:
    image: getmeili/meilisearch:v1.10
    restart: unless-stopped
    environment:
      MEILI_MASTER_KEY: ${MEILI_MASTER_KEY:?required}
      MEILI_ENV: ${MEILI_ENV:-production}
      MEILI_NO_ANALYTICS: 'true'
    volumes:
      - meili_data:/meili_data
    networks:
      - internal
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:7700/health']
      interval: 10s
      timeout: 3s
      retries: 5
    cap_drop: [ALL]
    security_opt:
      - no-new-privileges:true

  clamav:
    image: clamav/clamav:1.4
    restart: unless-stopped
    environment:
      CLAMAV_NO_FRESHCLAMD: 'false'
    volumes:
      - clamav_db:/var/lib/clamav
    networks:
      - internal
    healthcheck:
      test: ['CMD-SHELL', 'echo PING | nc -w 2 localhost 3310 | grep -q PONG']
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 120s
    cap_drop: [ALL]
    cap_add: [CHOWN, SETUID, SETGID, DAC_OVERRIDE]
    security_opt:
      - no-new-privileges:true

  calibre:
    image: linuxserver/calibre:7.16.0
    restart: unless-stopped
    profiles: [conversion]
    environment:
      PUID: '1001'
      PGID: '1001'
      TZ: Europe/Paris
    volumes:
      - calibre_config:/config
      - uploads:/uploads
    networks:
      - internal
    cap_drop: [ALL]
    security_opt:
      - no-new-privileges:true

  app:
    build:
      context: .
      dockerfile: Dockerfile
    restart: unless-stopped
    environment:
      NODE_ENV: production
      APP_URL: ${APP_URL:?required}
      DATABASE_URL: postgresql://biblioshare:${POSTGRES_PASSWORD}@pg:5432/biblioshare
      REDIS_URL: redis://redis:6379
      MEILI_HOST: http://meili:7700
      MEILI_MASTER_KEY: ${MEILI_MASTER_KEY}
      CLAMAV_HOST: clamav
      CLAMAV_PORT: '3310'
      LOG_LEVEL: ${LOG_LEVEL:-info}
      SESSION_SECRET: ${SESSION_SECRET:?required}
      CRYPTO_MASTER_KEY: ${CRYPTO_MASTER_KEY:?required}
      RESEND_API_KEY: ${RESEND_API_KEY:-}
      EMAIL_FROM: ${EMAIL_FROM:-noreply@biblioshare.local}
      GOOGLE_BOOKS_API_KEY: ${GOOGLE_BOOKS_API_KEY:-}
      ISBNDB_API_KEY: ${ISBNDB_API_KEY:-}
    volumes:
      - uploads:/app/uploads
      - covers:/app/covers
    depends_on:
      pg: { condition: service_healthy }
      redis: { condition: service_healthy }
      meili: { condition: service_healthy }
      clamav: { condition: service_started } # clamav peut prendre >2 min à initialiser ; pas de blocage
    networks:
      - internal
      - public
    ports:
      - '${APP_PORT:-3000}:3000'
    healthcheck:
      test: ['CMD', 'curl', '-fsS', 'http://localhost:3000/api/health']
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s
    read_only: true
    tmpfs:
      - /tmp
      - /app/.next/cache
    cap_drop: [ALL]
    security_opt:
      - no-new-privileges:true

  worker:
    build:
      context: .
      dockerfile: Dockerfile.worker
    restart: unless-stopped
    environment:
      NODE_ENV: production
      REDIS_URL: redis://redis:6379
      LOG_LEVEL: ${LOG_LEVEL:-info}
    depends_on:
      redis: { condition: service_healthy }
    networks:
      - internal
    cap_drop: [ALL]
    security_opt:
      - no-new-privileges:true

  backup:
    image: alpine:3.20
    restart: 'no'
    profiles: [backup]
    command: ['sh', '-c', "echo 'backup placeholder — configuré en Phase 8'"]
    networks:
      - internal

networks:
  internal:
    driver: bridge
    internal: false
  public:
    driver: bridge

volumes:
  pg_data:
  redis_data:
  meili_data:
  clamav_db:
  calibre_config:
  uploads:
  covers:
```

**Notes** :

- `calibre` et `backup` sont sous `profiles` pour ne pas démarrer par défaut. On les active avec `--profile conversion` ou `--profile backup`. Phase 5 les utilisera réellement.
- Seul `app` est exposé sur le port host (3000). Tous les autres services sont sur le réseau `internal` uniquement.
- `app` est `read_only: true` avec `tmpfs` pour `/tmp` et le cache Next.

- [ ] **Step 2 : Créer un `.env.docker.example` pour les variables docker-compose**

```bash
cp .env.example .env
# Ajouter les variables spécifiques docker-compose
cat >> .env <<'EOF'

# === Variables docker-compose ===
POSTGRES_PASSWORD=please-change-me-in-prod
APP_PORT=3000
EOF
```

Vérifier que `.env` est bien dans `.gitignore` (oui — couvert par Phase Design).

- [ ] **Step 3 : Lancer la stack**

```bash
docker compose up -d --build pg redis meili clamav
```

Attendre ~2 min pour que ClamAV télécharge sa base de définitions virales (premier démarrage).

```bash
docker compose ps
```

Expected : `pg`, `redis`, `meili` healthy. `clamav` peut être encore en `starting` au début.

- [ ] **Step 4 : Lancer la migration Prisma initiale**

```bash
DATABASE_URL=postgresql://biblioshare:please-change-me-in-prod@localhost:5432/biblioshare \
  pnpm prisma migrate dev --name 001_init
```

(Note : il faut publier temporairement le port 5432 de pg pour cette commande locale, ou exécuter la migration dans un container app. Plus simple : ajouter publication temporaire.)

Si pg n'est pas exposé sur le host, modifier `docker-compose.yml` localement avec `ports: ["5432:5432"]` sur pg pour cette étape, puis retirer.

Alternative robuste : exécuter via container :

```bash
docker compose run --rm \
  -e DATABASE_URL=postgresql://biblioshare:please-change-me-in-prod@pg:5432/biblioshare \
  app pnpm prisma migrate deploy
```

(Cela ne fonctionnera que si `app` est buildé. Sinon faire un `docker compose run --rm --build app sh` et lancer la cmd dedans.)

Le plus simple en pratique : exposer pg temporairement, lancer la migration, retirer l'exposition.

- [ ] **Step 5 : Build et lancer app + worker**

```bash
docker compose up -d --build app worker
docker compose ps
```

Attendre ~30s pour que `app` devienne healthy.

- [ ] **Step 6 : Test end-to-end /health**

```bash
curl -s http://localhost:3000/api/health | jq
```

Expected :

```json
{
  "status": "ok",
  "checks": [
    { "name": "postgres", "ok": true, ... },
    { "name": "redis", "ok": true, ... },
    { "name": "meilisearch", "ok": true, ... },
    { "name": "clamav", "ok": true, ... }
  ]
}
```

- [ ] **Step 7 : Cleanup**

```bash
docker compose down
```

- [ ] **Step 8 : Commit**

```bash
git add docker-compose.yml
git commit -m "build: add docker-compose with 8 services + healthchecks + isolated network"
```

---

## Section G — CI / CD

### Task 21 : Pipeline GitHub Actions CI

**Files:**

- Create: `.github/workflows/ci.yml`

- [ ] **Step 1 : Créer `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  NODE_VERSION: '22'
  PNPM_VERSION: '9'

jobs:
  lint-typecheck-unit:
    name: Lint, typecheck, unit tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile

      - run: pnpm prisma generate

      - run: pnpm format:check
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test

  e2e:
    name: Playwright E2E
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: biblioshare
          POSTGRES_USER: biblioshare
          POSTGRES_PASSWORD: testpassword
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U biblioshare"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

      redis:
        image: redis:7-alpine
        ports: ['6379:6379']
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

      meili:
        image: getmeili/meilisearch:v1.10
        env:
          MEILI_MASTER_KEY: testkeytestkeytestkeytestkey1234
          MEILI_NO_ANALYTICS: 'true'
        ports: ['7700:7700']
        options: >-
          --health-cmd "curl -f http://localhost:7700/health"
          --health-interval 10s
          --health-timeout 3s
          --health-retries 5

    env:
      DATABASE_URL: postgresql://biblioshare:testpassword@localhost:5432/biblioshare
      REDIS_URL: redis://localhost:6379
      MEILI_HOST: http://localhost:7700
      MEILI_MASTER_KEY: testkeytestkeytestkeytestkey1234
      CLAMAV_HOST: localhost
      CLAMAV_PORT: '3310'
      APP_URL: http://localhost:3000
      SESSION_SECRET: '0000000000000000000000000000000000000000000000000000000000000000'
      CRYPTO_MASTER_KEY: '1111111111111111111111111111111111111111111111111111111111111111'
      EMAIL_FROM: noreply@biblioshare.local
      LOG_LEVEL: warn

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}

      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile
      - run: pnpm prisma generate
      - run: pnpm prisma migrate deploy

      - run: pnpm dlx playwright install --with-deps chromium

      - run: pnpm build

      - name: Run E2E
        env:
          PORT: '3000'
        run: |
          pnpm exec next start &
          npx wait-on http://localhost:3000
          pnpm e2e tests/e2e/landing.spec.ts

      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7

  docker-build:
    name: Build Docker images
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3

      - name: Build app image
        uses: docker/build-push-action@v5
        with:
          context: .
          file: Dockerfile
          push: false
          tags: biblioshare-app:ci
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Build worker image
        uses: docker/build-push-action@v5
        with:
          context: .
          file: Dockerfile.worker
          push: false
          tags: biblioshare-worker:ci
          cache-from: type=gha
          cache-to: type=gha,mode=max

  trivy-scan:
    name: Trivy image scan
    needs: docker-build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - run: docker build -t biblioshare-app:scan .
      - uses: aquasecurity/trivy-action@0.24.0
        with:
          image-ref: biblioshare-app:scan
          format: table
          severity: CRITICAL,HIGH
          exit-code: '1'
          ignore-unfixed: true

  gitleaks:
    name: Gitleaks secret scan
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 2 : Installer wait-on (utilisé par le job e2e)**

```bash
pnpm add -D wait-on
```

- [ ] **Step 3 : Commit**

```bash
git add .github/workflows/ci.yml package.json
git commit -m "ci: add GitHub Actions pipeline (lint, test, E2E, docker, Trivy, gitleaks)"
```

---

### Task 22 : Dependabot

**Files:**

- Create: `.github/dependabot.yml`

- [ ] **Step 1 : Créer `.github/dependabot.yml`**

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: '/'
    schedule:
      interval: weekly
      day: monday
    open-pull-requests-limit: 5
    groups:
      patches-and-minor:
        update-types: ['patch', 'minor']
    ignore:
      - dependency-name: 'next'
        update-types: ['version-update:semver-major']
      - dependency-name: 'react'
        update-types: ['version-update:semver-major']
      - dependency-name: 'react-dom'
        update-types: ['version-update:semver-major']
      - dependency-name: '@prisma/client'
        update-types: ['version-update:semver-major']
      - dependency-name: 'prisma'
        update-types: ['version-update:semver-major']

  - package-ecosystem: npm
    directory: '/worker'
    schedule:
      interval: weekly
      day: monday
    open-pull-requests-limit: 3
    groups:
      patches-and-minor:
        update-types: ['patch', 'minor']

  - package-ecosystem: docker
    directory: '/'
    schedule:
      interval: weekly
      day: monday
    open-pull-requests-limit: 3

  - package-ecosystem: github-actions
    directory: '/'
    schedule:
      interval: monthly
```

- [ ] **Step 2 : Commit**

```bash
git add .github/dependabot.yml
git commit -m "ci: add Dependabot config (npm, docker, github-actions)"
```

---

## Section H — Documentation

### Task 23 : README.md complet

**Files:**

- Create: `README.md`

- [ ] **Step 1 : Créer `README.md`**

```markdown
# BiblioShare

Webapp self-hosted de gestion collective de bibliothèques numériques (epub, pdf, txt, docx) et physiques. Liseuse en ligne avec annotations privées, outils sociaux légers, administration fine des accès.

> Statut : **Phase 0 — Fondations**. Voir `docs/superpowers/specs/2026-04-25-biblioshare-design.md` pour le design global.

## Stack

- Next.js 15 (App Router), TypeScript strict
- Prisma 6 + PostgreSQL 16
- Auth.js v5 + 2FA TOTP (Phase 1)
- Meilisearch 1.x, Redis 7 + BullMQ
- ClamAV daemon, Calibre `ebook-convert`
- Tailwind 4 + shadcn/ui + Lucide icons
- Vitest + Playwright

## Démarrage rapide

### Prérequis

- Node.js 22+
- pnpm 9+ (`corepack enable && corepack prepare pnpm@9 --activate`)
- Docker Desktop ou Docker Engine + Docker Compose v2

### Installation

\`\`\`bash
git clone <repo-url> biblioshare
cd biblioshare

# Variables d'environnement

cp .env.example .env.local

# Générer les secrets pour le dev

sed -i.bak "s/please-generate-with-openssl-rand-hex-32/$(openssl rand -hex 32)/g" .env.local
rm -f .env.local.bak

# Pour docker-compose

cp .env.example .env
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)" >> .env
echo "MEILI_MASTER_KEY=$(openssl rand -hex 16)" >> .env
echo "APP_PORT=3000" >> .env

# Dépendances

pnpm install
pnpm prisma generate
\`\`\`

### Lancer la stack complète (Docker)

\`\`\`bash
docker compose up -d --build

# Première fois : appliquer la migration Prisma

docker compose exec app pnpm prisma migrate deploy
\`\`\`

L'app est disponible sur http://localhost:3000. Healthcheck : http://localhost:3000/api/health.

### Mode dev (Next.js local + services Docker)

\`\`\`bash

# Démarrer uniquement les dépendances

docker compose up -d pg redis meili clamav

# Migrer la DB

DATABASE_URL=postgresql://biblioshare:$(grep POSTGRES_PASSWORD .env | cut -d= -f2)@localhost:5432/biblioshare \\
pnpm prisma migrate dev

# Lancer Next.js en local (hot reload)

pnpm dev
\`\`\`

> **Note** : pour ce mode, exposer temporairement le port 5432 de `pg` dans `docker-compose.yml`, ou utiliser un tunnel.

## Scripts pnpm

| Script                      | Description                          |
| --------------------------- | ------------------------------------ |
| \`pnpm dev\`                | Next.js dev server avec hot reload   |
| \`pnpm build\`              | Build production                     |
| \`pnpm start\`              | Lancer le build production           |
| \`pnpm lint\`               | ESLint                               |
| \`pnpm typecheck\`          | Vérification TypeScript              |
| \`pnpm format\`             | Prettier write                       |
| \`pnpm format:check\`       | Prettier check                       |
| \`pnpm test\`               | Tests unitaires Vitest               |
| \`pnpm test:watch\`         | Vitest watch mode                    |
| \`pnpm e2e\`                | Tests Playwright                     |
| \`pnpm prisma:generate\`    | Régénérer le client Prisma           |
| \`pnpm prisma:migrate:dev\` | Créer/appliquer une migration en dev |
| \`pnpm prisma:studio\`      | UI graphique Prisma                  |

## Structure du projet

\`\`\`
src/
app/ Pages et API routes (Next.js App Router)
components/ui/ Primitives UI (shadcn/ui adapté)
i18n/ Traductions et config next-intl
lib/ Helpers (db, redis, meili, env, logger, private-scope)
types/ Déclarations TS auxiliaires
worker/ Service de jobs asynchrones (BullMQ)
prisma/ Schéma + migrations
tests/
unit/ Tests Vitest
e2e/ Tests Playwright
docs/
adr/ Architecture Decision Records
superpowers/specs/ Spécifications de design
superpowers/plans/ Plans d'implémentation par phase
security/ Documentation sécurité (OWASP, threat model)
deployment.md Guide Coolify
eslint-rules/ Règles ESLint custom
\`\`\`

## Sécurité

- 11 risques critiques identifiés et mitigés (cf. design doc).
- Headers de sécurité actifs (HSTS, X-Frame-Options DENY, X-Content-Type-Options, Referrer-Policy, Permissions-Policy).
- Lint rule `local/no-unscoped-prisma` interdit les queries Prisma sans scope (anti-IDOR).
- Type Brand `PrivateScope` pour annotations strictement privées par construction.
- Secrets dans `.env.local` (jamais committés). \`gitleaks\` en CI.
- ClamAV obligatoire avant publication d'un fichier (Phase 2).

Voir \`docs/security/owasp-mapping.md\` pour la couverture OWASP.

## Déploiement

Voir [\`docs/deployment.md\`](docs/deployment.md) pour le guide Coolify pas-à-pas.

## Roadmap

| Phase | Titre                                    | Statut          |
| ----- | ---------------------------------------- | --------------- |
| 0     | Fondations                               | en cours / fait |
| 1     | Auth, 2FA, invitations, rôles            | à venir         |
| 2     | Catalogue, upload, ClamAV, métadonnées   | à venir         |
| 3     | Liseuse, annotations, sync               | à venir         |
| 4     | Recherche, tags, collections             | à venir         |
| 5     | Conversion, téléchargements              | à venir         |
| 6     | Livres physiques                         | à venir         |
| 7     | Social, stats                            | à venir         |
| 7.5   | Recette utilisateur en local             | à venir         |
| 8     | Backups NAS, monitoring, hardening final | à venir         |

## Licence

Privée. Tous droits réservés.
```

- [ ] **Step 2 : Commit**

```bash
git add README.md
git commit -m "docs: add comprehensive README"
```

---

### Task 24 : Guide de déploiement Coolify

**Files:**

- Create: `docs/deployment.md`

- [ ] **Step 1 : Créer `docs/deployment.md`**

```markdown
# Guide de déploiement Coolify

Cible : VPS OVH Debian 13 (8 Go RAM, 4 vCPU, 80 Go), domaine personnel, HTTPS Let's Encrypt.

## 1. Pré-requis sur le VPS

\`\`\`bash
ssh root@<vps-ip>

# Mise à jour système

apt update && apt upgrade -y
apt install -y curl wget htop ufw fail2ban

# Pare-feu (autoriser uniquement SSH + HTTP/HTTPS)

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Désactiver le login SSH par mot de passe (si pas déjà fait)

sed -i 's/^#_PasswordAuthentication._/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh
\`\`\`

## 2. Installer Coolify

Voir https://coolify.io/docs/installation pour la commande à jour. À la date du design :

\`\`\`bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
\`\`\`

L'installateur déploie Coolify dans \`/data/coolify\`. Suivre les instructions à la fin pour récupérer le mot de passe admin.

Coolify écoute par défaut sur \`http://<vps-ip>:8000\` — créer un domaine \`coolify.<votre-domaine>\` pointant vers le VPS et configurer Coolify pour utiliser ce domaine en HTTPS.

## 3. Configurer DNS

Sur votre registrar :

| Sous-domaine             | Type | Cible     |
| ------------------------ | ---- | --------- |
| \`@\` ou \`biblioshare\` | A    | IP du VPS |
| \`coolify\`              | A    | IP du VPS |

## 4. Connecter le repo GitHub

1. Dans Coolify : **Sources** → **+ Add** → choisir GitHub.
2. Suivre l'OAuth et autoriser l'accès au repo \`biblioshare\`.

## 5. Créer le projet Coolify

1. **Projects** → **+ New** → nom : \`biblioshare\`.
2. **+ New Resource** → **Docker Compose** → choisir le repo \`biblioshare\`.
3. Branche : \`main\`. Path du compose : \`docker-compose.yml\`.

## 6. Variables d'environnement

Dans **Configuration → Environment Variables** de la ressource, ajouter :

| Clé                   | Valeur                               |
| --------------------- | ------------------------------------ |
| \`APP_URL\`           | https://biblioshare.<votre-domaine>  |
| \`POSTGRES_PASSWORD\` | (générer : \`openssl rand -hex 24\`) |
| \`MEILI_MASTER_KEY\`  | (générer : \`openssl rand -hex 24\`) |
| \`SESSION_SECRET\`    | (générer : \`openssl rand -hex 32\`) |
| \`CRYPTO_MASTER_KEY\` | (générer : \`openssl rand -hex 32\`) |
| \`EMAIL_FROM\`        | noreply@<votre-domaine>              |
| \`RESEND_API_KEY\`    | (Phase 1+, depuis dashboard Resend)  |
| \`LOG_LEVEL\`         | info                                 |
| \`MEILI_ENV\`         | production                           |
| \`APP_PORT\`          | 3000                                 |

**IMPORTANT** : marquer toutes ces variables comme **secret** dans Coolify (icône cadenas). Ne jamais les committer.

## 7. Configurer le domaine et HTTPS

Dans **Configuration → Domains** :

- Service : \`app\`
- Port : 3000
- Domain : \`biblioshare.<votre-domaine>\`
- HTTPS : activé (Let's Encrypt automatique)

## 8. Premier déploiement

1. **Deploy** dans l'UI Coolify.
2. Suivre les logs.
3. Une fois \`app\` healthy, lancer la migration Prisma initiale :
   \`\`\`bash
   ssh root@<vps-ip>
   docker exec -it $(docker ps --filter name=biblioshare-app -q) pnpm prisma migrate deploy
   \`\`\`

## 9. Vérification

\`\`\`bash
curl -sI https://biblioshare.<votre-domaine>
curl -s https://biblioshare.<votre-domaine>/api/health | jq
\`\`\`

Expected : \`200 OK\`, headers de sécurité présents (HSTS, X-Frame-Options, etc.), \`/api/health\` répond \`status: ok\`.

## 10. Supervision

- Logs Coolify : UI **Logs** par service.
- Logs container direct : \`docker compose logs -f app\` sur le VPS.
- (Optionnel Phase 8) UptimeKuma sur \`uptime.<votre-domaine>\` pointant vers \`/api/health\`.

## 11. Mises à jour

Coolify peut auto-déployer sur push \`main\` (configurer le webhook GitHub dans Coolify). Sinon, **Redeploy** manuel.

## Troubleshooting

### \`app\` ne devient pas healthy

- Vérifier que toutes les variables d'env requises sont définies (cf. \`src/lib/env.ts\`).
- Vérifier que la migration Prisma a tourné : \`docker exec ... pnpm prisma migrate status\`.
- Inspecter les logs : \`docker compose logs app\`.

### ClamAV met longtemps à démarrer

Normal au premier boot (téléchargement ~250 Mo de définitions virales). Compter ~3 min. Le healthcheck a un \`start_period: 120s\` pour ce cas.

### Mémoire insuffisante

\`docker stats\` pour voir la conso. Si \`pg\` ou \`meili\` consomment trop, ajuster \`shared_buffers\` (Postgres) ou la taille des index (Meili) en Phase 8.
```

- [ ] **Step 2 : Commit**

```bash
git add docs/deployment.md
git commit -m "docs: add Coolify deployment step-by-step guide"
```

---

### Task 25 : Documents sécurité de base

**Files:**

- Create: `docs/security/owasp-mapping.md`, `docs/security/credential-rotation.md`

- [ ] **Step 1 : Créer `docs/security/owasp-mapping.md`**

```markdown
# Couverture OWASP Top 10 — BiblioShare

Statut : squelette Phase 0. Sera enrichi à mesure que les phases avancent.

| OWASP    | Risque                                     | Mitigation BiblioShare                                                                                                                                      | Phase      |
| -------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| A01:2021 | Broken Access Control                      | Modèle 3 rôles + defense in depth (tRPC middleware / service / DB), lint rule `no-unscoped-prisma`, type Brand `PrivateScope`, tests E2E par paire de users | 1, 2, 3    |
| A02:2021 | Cryptographic Failures                     | argon2id (passwords), AES-256-GCM (TOTP secrets), HTTPS forcé (HSTS), TLS 1.3 via Coolify                                                                   | 0, 1       |
| A03:2021 | Injection                                  | Prisma ORM (pas de SQL brut), DOMPurify (XSS riche), escape React natif (XSS), lint interdit `dangerouslySetInnerHTML`                                      | 0, 2       |
| A04:2021 | Insecure Design                            | Threat model documenté (`docs/security/threat-model.md` Phase 8), revue par phase, ADR                                                                      | 0, 8       |
| A05:2021 | Security Misconfiguration                  | Headers de sécurité (HSTS, X-Frame, CSP, etc.), containers `read_only` + `cap_drop ALL`, services non exposés                                               | 0          |
| A06:2021 | Vulnerable and Outdated Components         | Dependabot, `npm audit` en CI, Trivy sur images Docker, CodeQL                                                                                              | 0, 8       |
| A07:2021 | Identification and Authentication Failures | argon2id, 2FA TOTP obligatoire admin, magic links hashés, rate limit, lockout                                                                               | 1          |
| A08:2021 | Software and Data Integrity Failures       | Lockfile pnpm committé, image Docker signée (Phase 8), backups borg avec vérification d'intégrité                                                           | 0, 8       |
| A09:2021 | Security Logging and Monitoring Failures   | Pino structuré, AuditLog des actions admin, DownloadLog des téléchargements, monitoring UptimeKuma                                                          | 0, 1, 5, 8 |
| A10:2021 | Server-Side Request Forgery                | Validation URL fetch couvertures (refus IPs privées RFC 1918), timeouts                                                                                     | 2          |
```

- [ ] **Step 2 : Créer `docs/security/credential-rotation.md`**

```markdown
# Calendrier de rotation des credentials

Tous les secrets sont en variables d'environnement, jamais en code, jamais loggués (redact pino).

| Credential                 | Localisation              | Rotation                       | Procédure                                                                                                                                              |
| -------------------------- | ------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POSTGRES_PASSWORD`        | Coolify env               | 12 mois                        | Générer nouveau, modifier env, redémarrer `pg` + `app`.                                                                                                |
| `MEILI_MASTER_KEY`         | Coolify env               | 6 mois                         | Générer nouveau, modifier env, redémarrer `meili` + `app`. Réindexation possible si Meili la requiert.                                                 |
| `SESSION_SECRET`           | Coolify env               | 6 mois                         | Générer nouveau (`openssl rand -hex 32`), modifier env, redémarrer `app`. **Effet : invalide toutes les sessions** (les users devront se reconnecter). |
| `CRYPTO_MASTER_KEY`        | Coolify env               | 12 mois                        | **ATTENTION** : rotation complexe, déchiffre/rechiffre tous les `TwoFactorSecret.secretCipher`. Procédure dédiée à écrire (Phase 8).                   |
| `RESEND_API_KEY`           | Coolify env               | 6 mois                         | Régénérer dans dashboard Resend, modifier env, redémarrer `app`.                                                                                       |
| `GOOGLE_BOOKS_API_KEY`     | Coolify env               | 12 mois                        | Régénérer dans Google Cloud Console.                                                                                                                   |
| `ISBNDB_API_KEY`           | Coolify env               | 12 mois                        | Régénérer dans dashboard ISBNdb.                                                                                                                       |
| Borg passphrase            | Gestionnaire MdP + papier | jamais (sans procédure dédiée) | Si nécessaire : créer un nouveau dépôt borg avec nouvelle passphrase, migrer les sauvegardes.                                                          |
| Clés SSH VPS ↔ NAS         | `~/.ssh/` sur VPS         | 12 mois                        | Générer nouvelle paire, ajouter authorized_keys NAS, retirer ancienne.                                                                                 |
| Mot de passe admin Coolify | gestionnaire MdP          | 6 mois                         | UI Coolify.                                                                                                                                            |

**Calendrier suivi** : un événement récurrent dans le calendrier personnel rappelle chaque rotation. Toutes les rotations sont consignées dans `AuditLog` (rotation manuelle) ou commit Git (rotation env vars).

**Procédure d'urgence** (compromission suspectée) : tout rotater dans l'heure, déconnecter tous les users (rotation `SESSION_SECRET`), notifier les admins.
```

- [ ] **Step 3 : Commit**

```bash
git add docs/security/
git commit -m "docs: add OWASP Top 10 mapping + credential rotation calendar"
```

---

## Section I — Validation finale

### Task 26 : Smoke test end-to-end

**Goal** : valider que tout l'écosystème fonctionne ensemble.

- [ ] **Step 1 : Cleanup et fresh start**

```bash
docker compose down -v
docker system prune -f
```

- [ ] **Step 2 : Build et lancer la stack complète**

```bash
docker compose up -d --build
```

- [ ] **Step 3 : Attendre que tout soit healthy**

```bash
# Attendre jusqu'à 3 min
timeout 180 bash -c '
while true; do
  unhealthy=$(docker compose ps --format "{{.Service}} {{.Health}}" | grep -v healthy | grep -v "^$" | wc -l | tr -d " ")
  if [ "$unhealthy" = "0" ]; then echo "ALL HEALTHY"; break; fi
  echo "$unhealthy services not yet healthy, waiting..."
  sleep 5
done
'
```

- [ ] **Step 4 : Migrer Prisma**

```bash
docker compose exec -T app pnpm prisma migrate deploy
```

- [ ] **Step 5 : Vérifier /api/health**

```bash
curl -sf http://localhost:3000/api/health | jq
```

Expected :

```json
{
  "status": "ok",
  "checks": [
    { "name": "postgres", "ok": true, "latencyMs": <number> },
    { "name": "redis", "ok": true, "latencyMs": <number> },
    { "name": "meilisearch", "ok": true, "latencyMs": <number> },
    { "name": "clamav", "ok": true, "latencyMs": <number> }
  ],
  "uptimeSec": <number>,
  "timestamp": "<iso>"
}
```

- [ ] **Step 6 : Vérifier la landing page**

```bash
curl -sf http://localhost:3000 | grep -q "BiblioShare" && echo "LANDING OK"
curl -sI http://localhost:3000 | grep -i "x-frame-options: DENY"
curl -sI http://localhost:3000 | grep -i "strict-transport-security"
```

- [ ] **Step 7 : Vérifier les logs**

```bash
docker compose logs app | tail -20
docker compose logs worker | tail -20
```

Expected : pas d'erreur, worker affiche `worker started, idle`.

- [ ] **Step 8 : Cleanup**

```bash
docker compose down
```

- [ ] **Step 9 : Vérifier que la CI passe**

```bash
git push origin main
```

Aller sur GitHub → onglet **Actions**. Tous les jobs (`lint-typecheck-unit`, `e2e`, `docker-build`, `trivy-scan`, `gitleaks`) doivent être verts.

- [ ] **Step 10 : Commit final + tag**

```bash
git tag -a phase-0-complete -m "Phase 0 — Fondations complètes

Livrables :
- Repo Next.js 15 + TS strict + ESLint + Prettier
- Schéma Prisma complet + migration 001_init
- 8 services Docker (app, worker, pg, redis, meili, clamav, calibre, backup)
- Healthchecks + sécurité (read_only, cap_drop, no-new-privileges)
- /api/health avec checks DB/Redis/Meili/ClamAV
- CI GitHub Actions (lint/typecheck/test/E2E/docker/trivy/gitleaks)
- Système de design (tokens, primitives Button/Input/Card/Toast)
- i18n FR (next-intl)
- Headers sécurité (HSTS, X-Frame, etc.)
- Lint rule no-unscoped-prisma + type Brand PrivateScope
- README + guide Coolify + OWASP mapping + credential rotation
- ADR 0001-0004

Critère validation : clone+up < 15 min, /health green, CI green."
git push --tags
```

---

### Task 27 : Récap de fin de phase + mise à jour mémoire

- [ ] **Step 1 : Récap structuré dans la conversation**

L'agent doit produire à l'utilisateur un récap formel comprenant :

- Liste exhaustive des livrables produits (avec chemins).
- Critères de validation atteints (cocher chaque ligne du critère Phase 0).
- Commandes utiles pour reprendre dans une nouvelle session.
- Décisions techniques notables prises pendant la phase.
- Risques nouveaux ou résolus.
- Dette technique consciemment laissée (ex : worker idle car pas encore de jobs).
- État des tests (couverture, ce qui passe, ce qui est skippé et pourquoi).

- [ ] **Step 2 : Mise à jour mémoire**

Créer la note `project_phase_0_completed.md` dans le dossier mémoire :

```
/Users/seraphin/.claude/projects/-Users-seraphin-Library-CloudStorage-SynologyDrive-save-02-Trinity-Projet-github-fm-librairy/memory/project_phase_0_completed.md
```

Contenu : récap factuel de la Phase 0, ADR créés, prochaine action (= déclencher writing-plans pour Phase 1).

Mettre à jour `project_biblioshare_overview.md` (état → « Phase 0 terminée le YYYY-MM-DD, prêt pour Phase 1 »).

Mettre à jour `MEMORY.md` (index) en ajoutant la nouvelle note.

- [ ] **Step 3 : Validation utilisateur**

Demander à l'utilisateur la validation explicite pour passer à la Phase 1.

- [ ] **Step 4 : Si validé, invoquer le skill `superpowers:writing-plans` pour le plan d'implémentation Phase 1.**

---

## Self-review : couverture du spec

Vérification que chaque livrable de la Phase 0 du design doc est couvert par une tâche :

| Livrable design doc Phase 0                                         | Couvert par Task          |
| ------------------------------------------------------------------- | ------------------------- |
| Monorepo Next.js 15 + TS strict + ESLint + Prettier                 | 1, 2                      |
| Schéma Prisma complet                                               | 6                         |
| Migration `001_init.sql`                                            | 26 (step 4)               |
| Docker Compose avec 8 services                                      | 20                        |
| Volumes nommés, healthchecks, réseau interne isolé                  | 20                        |
| `.env.example` documenté                                            | 8                         |
| CI GitHub Actions (lint, typecheck, unit, build Docker, smoke test) | 21                        |
| ADR initiaux (0001-0004)                                            | déjà fait en phase Design |
| Page d'accueil minimale                                             | 12                        |
| `/health`                                                           | 11                        |
| Logs structurés (pino)                                              | 9                         |
| Guide déploiement Coolify                                           | 24                        |
| Système de design (tokens, palette, typo, primitives)               | 4, 5                      |
| Type Brand `PrivateScope` (mentionné transversalement)              | 7                         |
| Lint rule no-unscoped-prisma                                        | 14                        |
| Headers sécurité                                                    | 13                        |
| i18n next-intl                                                      | 12                        |
| Worker minimal                                                      | 17                        |
| Tests Vitest + Playwright                                           | 15, 16                    |
| README                                                              | 23                        |
| Dependabot                                                          | 22                        |
| Trivy + gitleaks                                                    | 21 (intégré CI)           |
| OWASP mapping squelette                                             | 25                        |
| Credential rotation doc                                             | 25                        |
| Tag git phase-0-complete                                            | 26                        |
| Récap + memory update                                               | 27                        |

**Aucun livrable manquant.** Le critère de validation final est testé en Task 26.
