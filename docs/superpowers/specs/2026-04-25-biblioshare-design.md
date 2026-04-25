# BiblioShare — Document de design (Phase 0)

**Date** : 2026-04-25
**Statut** : Validé en brainstorming, en attente de revue formelle avant rédaction du plan d'implémentation Phase 0
**Auteur** : Nicolas (avec assistance IA)

---

## 1. Vue d'ensemble

### 1.1 Mission

BiblioShare est une webapp self-hosted permettant à un groupe restreint (50-200 utilisateurs an 1, scaling visé ~500) de gérer collectivement plusieurs bibliothèques contenant des livres numériques (epub, pdf, txt, docx) et physiques. Elle inclut une liseuse en ligne avec annotations privées, des outils sociaux légers (notes, avis), et une administration fine des accès.

### 1.2 Public utilisateur

20 à 80 ans, niveaux techniques très variés. **L'intuitivité de l'UI est non-négociable.**

### 1.3 Devices cibles

Desktop et tablette en priorité (lecture, gestion). Mobile pour recherche ponctuelle. Responsive impératif. WCAG 2.1 AA visé.

### 1.4 Critères de réussite

- Un membre novice (non-tech) accomplit les 5 parcours principaux (login, recherche, lecture, annotation, demande livre physique) sans aide.
- 500 livres et 100 users concurrents tiennent sur 8 Go RAM / 4 vCPU sans dégradation.
- Aucun incident sécurité critique (cf. Section 6) en première année.
- Restauration depuis backup en moins de 2h en cas de sinistre.

### 1.5 Non-objectifs (YAGNI explicite)

- Pas de SaaS multi-tenant (un seul groupe d'utilisateurs partagé sur l'instance).
- Pas de marketplace, pas de paiement.
- Pas de fédération entre instances.
- Pas de mobile app native (PWA suffisante si besoin futur).
- Pas de traduction multilingue au lancement (FR uniquement, structure i18n-ready).
- Pas de WebSocket / temps réel (sync de position en polling suffit).

---

## 2. Architecture & stack

### 2.1 Schéma global

```
                 ┌────────────────────────────────────────┐
Internet ──HTTPS─│  Traefik (Coolify) + Let's Encrypt     │
                 └────────────────────────────────────────┘
                                  │
                                  ▼
              ┌──────────────────────────────────────┐
              │  app  (Next.js 15, Node 22)          │
              │  - SSR + Server Actions + tRPC       │
              │  - lit/écrit DB via Prisma           │
              │  - publie jobs via BullMQ → Redis    │
              └──────────────────────────────────────┘
                  │         │         │         │
                  ▼         ▼         ▼         ▼
              ┌─────┐  ┌──────┐  ┌────────┐  ┌─────────┐
              │ pg  │  │redis │  │ meili  │  │ clamav  │
              │ 16  │  │  7   │  │search  │  │ daemon  │
              └─────┘  └──────┘  └────────┘  └─────────┘
                            │
                            ▼
                  ┌──────────────────────────────┐
                  │  worker  (Node, BullMQ)      │
                  │  - scan ClamAV bloquant      │
                  │  - extraction texte + index  │
                  │  - conversion via calibre    │
                  │  - récup. métadonnées API    │
                  └──────────────────────────────┘
                                │
                                ▼
                    ┌──────────────────────────┐
                    │  calibre (sidecar CLI)   │
                    │  ebook-convert isolé     │
                    └──────────────────────────┘

                    ┌──────────────────────────┐
                    │  backup (cron borgbackup)│
                    │  push SSH → NAS          │
                    └──────────────────────────┘
```

8 services Docker, orchestrés par Coolify. Réseau interne isolé. Aucun service applicatif autre que `app` exposé sur internet.

### 2.2 Stack par couche

| Couche | Choix | Justification |
|---|---|---|
| Framework fullstack | Next.js 15 (App Router) | Corpus IA massif, types end-to-end, écosystème epub.js/pdf.js natif |
| Langage | TypeScript strict | Types partagés back/front, limite hallucinations IA |
| API interne | tRPC + Server Actions | Pas de schéma OpenAPI à maintenir, types end-to-end |
| ORM | Prisma 6 | Migrations claires, types auto, corpus IA |
| Base de données | PostgreSQL 16 + extensions `pgcrypto`, `citext`, `pg_trgm` | Robuste, FTS dispo si besoin secondaire |
| Auth | Auth.js v5 + module 2FA TOTP custom (`otplib`) | Magic links, sessions sécurisées |
| Hash mots de passe | argon2id via `@node-rs/argon2` | Standard moderne, conformité brief |
| Recherche full-text | Meilisearch 1.x | RAM ~300 Mo, simple, performant à notre échelle |
| Cache + queues | Redis 7 (instance unique mutualisée) | BullMQ + cache TanStack |
| Jobs async | BullMQ | Mature, retry policies, dashboard intégré |
| Antivirus | ClamAV daemon (`clamd`) via socket Unix | Standard, scan stream, freshclam quotidien |
| Conversion ebook | Calibre `ebook-convert` (CLI) en container dédié | Standard de facto |
| Liseuse epub | epub.js via wrapper React (`react-reader` adapté) | Référence de l'écosystème |
| Liseuse pdf | pdf.js via `react-pdf` | Référence de l'écosystème |
| UI kit | Tailwind 4 + shadcn/ui (Radix primitives) + Lucide icons | Code copié dans le repo, accessibilité par défaut |
| Stockage fichiers | Filesystem local hors webroot, accès via endpoints authentifiés signés | Pas de S3 nécessaire, abstraction `FileStorage` pour migration future |
| Email | Resend (provider) avec fallback SMTP générique via env | Deliverability, simplicité |
| i18n | `next-intl` | FR par défaut, prêt pour ajout de langues |
| Backup | borgbackup push SSH vers NAS, append-only | Déduplication + chiffrement + intégrité |
| Tests | Vitest (unit) + Playwright (E2E) | Standards de l'écosystème |
| CI | GitHub Actions | Lint, types, tests, build Docker, scan Trivy |
| Logs | pino (JSON structuré) avec redact des secrets | Compatible agrégateurs futurs |
| Monitoring | UptimeKuma (optionnel) + healthchecks Docker | Pragma solo dev |

### 2.3 Décisions d'architecture notables

1. **Email via Resend** plutôt que SMTP self-hosté : deliverability, pas d'enfer DKIM/SPF, fallback SMTP possible.
2. **Borgbackup append-only** plutôt que rsync : déduplication (rétention longue à faible coût), chiffrement, vérification intégrité, **protection ransomware** (le VPS ne peut pas effacer les backups).
3. **Stockage local** plutôt que S3/MinIO : overkill à l'échelle cible. Migration future possible via abstraction `FileStorage`.
4. **Pas de WebSocket** pour la sync de position : `PATCH` toutes les 30s + sur événement (page change, fermeture). Réduit complexité et surface d'attaque.
5. **Un livre appartient à une seule bibliothèque** : déplacement = `UPDATE library_id`, simplification sécurité.
6. **Annotations strictement privées par construction** : type Brand TypeScript `PrivateScope` non-construisible hors helper dédié.

---

## 3. Schéma de base de données

Notation simplifiée Prisma. Schéma complet à formaliser en Phase 0 (`prisma/schema.prisma`).

### 3.1 Domaine Auth & Comptes

```
User
  id               cuid
  email            citext UNIQUE
  emailVerifiedAt  timestamp?
  passwordHash     text                 // argon2id
  displayName      text
  role             enum [GLOBAL_ADMIN, USER]
  status           enum [ACTIVE, SUSPENDED]
  twoFactorEnabled boolean
  locale           text default 'fr'
  createdAt, updatedAt, lastLoginAt

TwoFactorSecret
  userId       FK User UNIQUE
  secretCipher text                     // AES-256-GCM, clé maîtresse env
  backupCodes  text[]                   // hash argon2
  confirmedAt  timestamp?

Session                                 // géré par Auth.js (table standard)

Invitation
  id           cuid
  email        citext
  invitedBy    FK User
  libraryId    FK Library?
  proposedRole enum LibraryRole?
  tokenHash    text UNIQUE              // hashé en DB (jamais en clair)
  expiresAt    timestamp                // 72h
  consumedAt   timestamp?
  consumedBy   FK User?
  createdAt

PasswordResetToken
  userId      FK User
  tokenHash   text UNIQUE
  expiresAt   timestamp                 // 1h
  consumedAt  timestamp?
```

### 3.2 Domaine Bibliothèques & Permissions

```
Library
  id          cuid
  name        text
  slug        text UNIQUE
  description text?
  createdAt, updatedAt

LibraryMember
  userId      FK User
  libraryId   FK Library
  role        enum LibraryRole          // [LIBRARY_ADMIN, MEMBER]
  canRead     boolean default true
  canUpload   boolean default false
  canDownload boolean default true
  joinedAt
  PRIMARY KEY (userId, libraryId)
```

### 3.3 Domaine Livres

```
Book
  id                cuid
  libraryId         FK Library
  title             text
  authors           text[]
  isbn10, isbn13    text?
  publisher, publishedYear, language
  description       text?
  coverPath         text?
  metadataSource    enum [GOOGLE_BOOKS, OPEN_LIBRARY, ISBNDB, MANUAL]
  hasDigital        boolean
  hasPhysical       boolean
  uploadedById      FK User?
  createdAt, updatedAt
  INDEX (libraryId, title), (libraryId, isbn13)

BookFile
  id            cuid
  bookId        FK Book
  format        enum [EPUB, PDF, TXT, DOCX]
  isOriginal    boolean
  storagePath   text
  fileSizeBytes bigint
  sha256        text
  mimeType      text                    // vérifié via libmagic
  scanStatus    enum [PENDING, CLEAN, INFECTED, ERROR]
  scannedAt, indexedAt   timestamp?
  createdAt
  UNIQUE (bookId, format)
  INDEX (sha256)

Tag
  id        cuid
  libraryId FK Library
  name      citext
  UNIQUE (libraryId, name)

BookTag
  bookId, tagId
  PRIMARY KEY (bookId, tagId)
```

### 3.4 Domaine Livres physiques

```
PhysicalCopy
  id              cuid
  bookId          FK Book
  ownerId         FK User
  currentHolderId FK User?
  notes           text?
  createdAt, updatedAt

PhysicalRequest
  id            cuid
  copyId        FK PhysicalCopy
  requesterId   FK User
  status        enum [PENDING, ACCEPTED, DECLINED, CANCELLED, FULFILLED]
  message       text?
  createdAt, respondedAt?
```

### 3.5 Domaine Lecture

```
Annotation
  id           cuid
  userId       FK User
  bookId       FK Book
  format       enum [EPUB, PDF, TXT, DOCX]
  locator      jsonb                    // { cfi: ... } ou { page, rect: ... }
  selectedText text
  noteContent  text?
  color        enum [YELLOW, GREEN, BLUE, PINK, ORANGE]
  createdAt, updatedAt
  INDEX (userId, bookId)

Bookmark
  id        cuid
  userId    FK User
  bookId    FK Book
  format    enum
  locator   jsonb
  label     text?
  createdAt
  INDEX (userId, bookId)

ReadingProgress
  userId       FK User
  bookId       FK Book
  format       enum
  locator      jsonb
  percentage   decimal(5,2)
  lastDevice   text?
  updatedAt
  PRIMARY KEY (userId, bookId)

ReadingSession
  id           cuid
  userId       FK User
  bookId       FK Book
  startedAt, endedAt
  durationSec  int
  startLocator, endLocator   jsonb
```

### 3.6 Domaine Social

```
Rating
  userId, bookId
  stars       smallint check (1..5)
  createdAt, updatedAt
  PRIMARY KEY (userId, bookId)

Review
  id        cuid
  userId    FK User
  bookId    FK Book
  body      text
  status    enum [VISIBLE, HIDDEN_BY_MOD, REMOVED]
  createdAt, updatedAt
  INDEX (bookId, createdAt)
```

### 3.7 Domaine Collections

```
Collection
  id          cuid
  userId      FK User
  name        text
  description text?
  createdAt, updatedAt

CollectionBook
  collectionId, bookId
  position    int
  addedAt
  PRIMARY KEY (collectionId, bookId)
```

### 3.8 Domaine Audit & Logs

```
DownloadLog
  id        cuid
  userId    FK User
  bookId    FK Book
  bookFileId FK BookFile
  ipHash    text                        // hash + sel rotatif 30j
  userAgent text
  createdAt
  INDEX (userId, createdAt), (bookId, createdAt)

AuditLog
  id         cuid
  actorId    FK User
  action     text
  targetType text
  targetId   text
  metadata   jsonb
  ipHash     text
  createdAt
  INDEX (actorId, createdAt), (targetType, targetId)

Notification
  id        cuid
  userId    FK User
  type      enum [PHYSICAL_REQUEST, INVITATION_ACCEPTED, REVIEW_HIDDEN, ...]
  payload   jsonb
  readAt    timestamp?
  createdAt
  INDEX (userId, createdAt) WHERE readAt IS NULL
```

### 3.9 Décisions de modélisation

1. Un livre = une bibliothèque (déplacement = update library_id).
2. Annotations indexées par `(userId, bookId)` mais avec format explicite (CFI epub vs page+rect pdf incompatibles).
3. IPs hashées avec sel rotatif 30j (RGPD-friendly).
4. Pas de soft delete par défaut (suppression réelle pour RGPD), sauf logs avec rétention configurable.
5. Tags scopés par bibliothèque.
6. Séparation `Book` (logique) / `BookFile` (artefact).
7. Recherche full-text dans Meilisearch (DB lean).

---

## 4. Rôles & permissions

### 4.1 Niveaux d'autorité

| Niveau | Source | Portée |
|---|---|---|
| Visiteur | Aucune session | Aucune (sauf landing) |
| Membre | `LibraryMember` row | Une bibliothèque, modulé par `canRead/canUpload/canDownload` |
| Admin de bibliothèque | `LibraryMember.role = LIBRARY_ADMIN` | Une bibliothèque (gestion membres + catalogue) |
| Admin global | `User.role = GLOBAL_ADMIN` | Tout. Bypass automatique. Toujours loggué. 2FA obligatoire. |

### 4.2 Matrice complète

**Synthèse des invariants critiques** :

- **Annotations privées strictement** : aucun rôle (y compris Admin global) ne peut les lire. Enforcement par type Brand TS.
- **Admin de bibliothèque ne peut pas** : promouvoir / rétrograder un autre admin de sa biblio, créer des comptes système, voir les autres bibliothèques.
- **Global Admin** : 2FA forcé, toutes ses actions sont dans `AuditLog`.
- **Tout download** est loggué avant le début du stream (transactionnel).
- **Tout refus de permission** = 403 + entrée AuditLog.

**Matrice détaillée** (légende : `O` autorisé · `—` refusé · `(O)` autorisé sous condition · `LOG` audit log) :

#### Comptes & invitations

| Action | Visiteur | Membre | Admin Biblio | Admin Global |
|---|---|---|---|---|
| Login / logout | O | O | O | O |
| Reset MdP par email | O | O | O | O |
| Activer/désactiver son 2FA | — | O | O | OBLIGATOIRE |
| Modifier son profil | — | O | O | O |
| Créer compte (par invitation) | (O via lien) | — | — | — |
| Inviter un user dans une biblio | — | — | O (sa biblio) LOG | O LOG |
| Créer un compte système | — | — | — | O LOG |
| Suspendre / réactiver un user | — | — | — | O LOG |
| Supprimer un user | — | (O soi-même) | — | O LOG |
| Modifier rôle système d'un user | — | — | — | O LOG |
| Voir liste de tous les users | — | — | — | O |

#### Bibliothèques

| Action | Visiteur | Membre | Admin Biblio | Admin Global |
|---|---|---|---|---|
| Créer une bibliothèque | — | — | — | O LOG |
| Renommer / décrire une biblio | — | — | O (sa biblio) LOG | O LOG |
| Supprimer une biblio | — | — | — | O LOG |
| Lister mes bibliothèques | — | O | O | O (toutes) |
| Voir les membres d'une biblio | — | O (sa biblio) | O (sa biblio) | O |

#### Membres d'une bibliothèque

| Action | Membre | Admin Biblio (sa biblio) | Admin Global |
|---|---|---|---|
| Ajouter un membre existant | — | O LOG | O LOG |
| Retirer un membre | (soi-même) | O (sauf autre admin biblio) LOG | O LOG |
| Promouvoir Membre → Admin Biblio | — | — | O LOG |
| Rétrograder Admin Biblio → Membre | — | — | O LOG |
| Modifier `canUpload` / `canDownload` d'un membre | — | O LOG | O LOG |

#### Livres (catalogue)

| Action | Membre `canRead` | Membre `canUpload` | Admin Biblio | Admin Global |
|---|---|---|---|---|
| Voir le catalogue de la biblio | O | O | O | O |
| Voir détails d'un livre | O | O | O | O |
| Uploader un livre | — | O | O | O |
| Éditer les métadonnées | — | (O si uploader) | O | O |
| Supprimer un livre | — | (O si uploader, dans 24h) | O LOG | O LOG |
| Déplacer un livre vers autre biblio | — | — | (O si admin des deux) LOG | O LOG |
| Lancer une re-scan ClamAV | — | — | O | O |
| Re-récupérer métadonnées via API | — | — | O | O |

#### Lecture & téléchargement

| Action | Membre `canRead` | Membre `canDownload` | Admin Biblio | Admin Global |
|---|---|---|---|---|
| Lire dans la liseuse en ligne | O | O | O | O |
| Télécharger format original | — | O LOG | O LOG | O LOG |
| Demander conversion + télécharger | — | O LOG | O LOG | O LOG |
| Voir logs téléchargement (sa biblio) | — | — | O | O |

#### Annotations, marque-pages, progression, collections

| Action | Membre | Admin Biblio | Admin Global |
|---|---|---|---|
| CRUD ses propres annotations | O | O | O |
| Lire annotations d'autrui | — | — | — *(jamais)* |
| Idem marque-pages, progression, collections | O (siennes) | O (siennes) | O (siennes) |

#### Livres physiques

| Action | Membre | Propriétaire | Détenteur actuel | Admin Biblio | Admin Global |
|---|---|---|---|---|---|
| Voir le statut | O | O | O | O | O |
| Demander à emprunter | O | O | O | O | O |
| Accepter / refuser une demande | — | O | (O notifié) | — | — |
| Mettre à jour le détenteur | — | O | O | O | O |
| Marquer comme rendu | — | O | O | O | O |

#### Social (notes, avis)

| Action | Membre | Admin Biblio | Admin Global |
|---|---|---|---|
| Noter un livre (1-5) | O | O | O |
| Modifier sa note | O | O | O |
| Écrire un avis | O | O | O |
| Modifier / supprimer son avis | O | O | O |
| Masquer un avis (modération) | — | O (sa biblio) LOG | O LOG |
| Voir notes/avis | O | O | O |

#### Tags & collections

| Action | Membre | Admin Biblio | Admin Global |
|---|---|---|---|
| Créer un tag | — | O | O |
| Appliquer un tag à un livre | (O si `canUpload`) | O | O |
| Renommer / supprimer un tag | — | O LOG | O LOG |
| CRUD ses collections personnelles | O | O | O |

#### Audit & logs

| Action | Membre | Admin Biblio | Admin Global |
|---|---|---|---|
| Voir l'audit log global | — | — | O |
| Voir téléchargements de SA biblio | — | O | O |
| Voir SES propres téléchargements | O | O | O |

### 4.3 Implémentation du contrôle (defense in depth, 3 couches)

1. **Couche tRPC procedure** : middleware `requirePermission(perm)` charge `LibraryMember` et vérifie. Toute procédure exposée déclare son besoin.
2. **Couche service** : helper `assertCan*(user, resource)` réutilisable, indépendant de tRPC.
3. **Couche DB** : queries Prisma avec scope toujours présent. Lint rule custom interdit `findMany`/`findFirst` sans `where`.

### 4.4 Tests

Pour chaque ligne de la matrice : un test « happy path » et un test « unauthorized ». Écrits avant l'implémentation (TDD).

---

## 5. Roadmap par phases

### 5.1 Conventions globales

- Phase terminée = tests verts (unit + E2E sur le périmètre), ADR rédigés, doc utilisateur à jour, déploiement Coolify staging validé.
- Pas de feature flag pour cacher du code à moitié fini.
- À la fin de chaque phase : récap structuré + mise à jour mémoire + tag git `phase-<N>-complete`.

### 5.2 Vue d'ensemble

| Phase | Titre | Complexité | Dépendances |
|---|---|---|---|
| 0 | Fondations | M | — |
| 1 | Auth, 2FA, invitations, rôles | L | 0 |
| 2 | Catalogue, upload, ClamAV, métadonnées | L | 1 |
| 3 | Liseuse, annotations, sync | XL | 2 |
| 4 | Recherche, tags, collections | M | 2 (3 utile) |
| 5 | Conversion, téléchargements | M | 2 |
| 6 | Livres physiques | S | 2 |
| 7 | Social, stats | S | 2 (3 pour stats) |
| 7.5 | **Recette utilisateur en local** | S | 7 |
| 8 | Backups NAS, monitoring, hardening final | M | toutes |

### 5.3 Détail des phases

**Phase 0 — Fondations**
- Repo Next.js 15 + TS strict + ESLint + Prettier.
- Schéma Prisma complet + migration `001_init`.
- docker-compose : `app`, `worker`, `pg`, `redis`, `meili`, `clamav`, `calibre`, `backup`. Healthchecks, volumes nommés, réseau isolé.
- `.env.example` documenté.
- CI GitHub Actions : lint, typecheck, unit tests, build Docker, smoke test.
- ADR initiaux : 0001-stack, 0002-storage, 0003-permissions, 0004-backup.
- Page d'accueil minimale + `/health` + logs structurés (pino).
- Guide déploiement Coolify (`docs/deployment.md`).
- Système de design : tokens Tailwind, config shadcn/ui, palette + typo + composants `Button/Input/Card/Toast`.
- **Critère** : clone repo + suivi README → environnement local fonctionnel en < 15 min. Déploiement Coolify validé en HTTPS sur le VPS.

**Phase 1 — Auth, 2FA, invitations, rôles**
- Auth.js v5, magic links invitation (token hashé, 72h), reset password (1h).
- 2FA TOTP : enrolment QR, vérif login, 8 codes secours hashés.
- 2FA forcé Admin global après 7j.
- Sessions httpOnly, sameSite, rotation, expiration.
- Rate limiting login/reset/invitation.
- Module permissions (3 couches), AuditLog branché.
- UI : login, register-from-invitation, reset, profil, gestion 2FA, panel Admin.
- **Tests** : nominaux + cas d'attaque (replay token, énumération, bruteforce, CSRF, fixation).
- **Critère** : flux invitation → création → 2FA → login fonctionnel ; toutes tentatives non autorisées renvoient 403 + AuditLog.

**Phase 2 — Catalogue, upload, ClamAV, métadonnées**
- CRUD bibliothèques + gestion membres.
- Upload : MIME réel (libmagic), 100 Mo max, écriture staging, scan ClamAV bloquant, dédup SHA-256.
- Chaîne fallback métadonnées : Google Books → Open Library → ISBNdb (optionnel).
- Cache local couvertures.
- Édition manuelle métadonnées + tags.
- Vue catalogue avec lazy loading + pagination.
- **Tests** : EICAR bloqué, MIME spoofing rejeté, path traversal bloqué, permissions enforced.
- **Critère** : upload 20 livres réels, métadonnées auto, catalogue navigable, infecté bloqué et tracé.

**Phase 3 — Liseuse, annotations, sync**
- Endpoint `/library/:slug/book/:id/read` authentifié, range requests pdf.
- Wrapper React epub.js + react-pdf, interface annotation unifiée.
- Personnalisation : police, taille, espacement, marges, mode sombre.
- Multi-marque-pages avec libellés.
- Sync : PATCH 30s + change page + sendBeacon close.
- Annotations : 5 couleurs, locator JSON.
- Stats par session (start/end/duration).
- Raccourcis clavier desktop, gestures tablette.
- **Tests** : annotations strictement privées (E2E user A vs B), sync cross-device, pas de leak URL signée, navigation clavier.
- **Critère** : lire un epub 400p, créer 10 annotations, fermer, reprendre sur autre device.
- **Risque** : epubs malformés (epub.js bugs) → epubcheck en background non bloquant + warning UI.

**Phase 4 — Recherche, tags, collections**
- Worker `extract-text` post-scan : epub (JSZip), pdf (pdf-parse), docx (mammoth), txt direct.
- Index Meilisearch par bibliothèque.
- API recherche : q, filtres, pagination, highlights.
- UI recherche globale + recherche par biblio.
- Tags libres avec autocomplete.
- Collections personnelles : CRUD, drag&drop, ajout/retrait.
- **Critère** : recherche par phrase exacte < 200 ms sur 1000 livres, filtres combinables.

**Phase 5 — Conversion, téléchargements**
- Worker `convert-file` : ebook-convert, queue dédiée, timeout 5 min, max 1 conversion concurrente.
- Cache : conversion stockée comme `BookFile` non-original.
- Endpoint `/download` : auth, log avant stream, URLs signées 5 min.
- UI : bouton télécharger avec menu formats, indicateur progression conversion.
- **Critère** : epub original instantané, conversion epub→pdf < 60s pour 300p, second download du pdf instantané (cache).

**Phase 6 — Livres physiques**
- Marquer livre physique, désigner propriétaire et détenteur courant.
- Workflow demande : demande → notif détenteur → accept/refuse → update détenteur.
- Notifications in-app + email optionnel.
- **Critère** : demande, acceptation, transfert tracé.

**Phase 7 — Social, stats**
- Note 1-5 par livre, par user, modifiable.
- Avis publics par livre, modération Admin biblio.
- Dashboard utilisateur : lus / en cours / temps total / top auteurs / historique.
- Dashboard biblio (Admin) : top livres, contributeurs.
- **Critère** : un user voit ses stats 30j, modération avis fonctionnelle.

**Phase 7.5 — Recette utilisateur en local**
- Stack complète déployée localement (poste dev ou LAN), seedée : 50-100 livres, 5-10 users couvrant tous rôles.
- Scénarios documentés : invitation→2FA→première lecture, upload→metadata→annotations, recherche→collection→download converti, demande physique, modération.
- 2-3 testeurs externes, tranches d'âge variées.
- Cahier de recette : bugs / friction UX / suggestions, priorisé.
- Test charge artisanal : 1000 livres + 10 users concurrents (k6 ou autocannon).
- **Critère** : un testeur novice accomplit les 5 parcours principaux sans aide, sans bug bloquant. Liste de friction triée pour Phase 8.

**Phase 8 — Backups NAS, monitoring, hardening final**
- Service `backup` : borgbackup + cron, push SSH NAS, repo chiffré, rétention 7d/4w/12m.
- Couvre dump PG, volume uploads, volume covers, snapshot Meili, config (hors secrets).
- Test restauration documenté et joué.
- UptimeKuma sur services critiques.
- Logs centralisés + logrotate.
- Audit sécurité final : npm audit, Trivy, headers, pen test manuel sur 10 risques critiques.
- Plan rotation credentials documenté.
- Corrections issues recette Phase 7.5.
- Mise en prod sur VPS.
- **Critère** : sinistre simulé (perte VPS) → récupération en < 2h, données intègres.

---

## 6. Analyse des risques sécurité

Synthèse — détail complet par catégorie en Annexe A (à intégrer dans `docs/security/threat-model.md` en Phase 8).

### 6.1 Risques critiques (11 identifiés)

| # | Catégorie | Risque | Phase mitigation |
|---|---|---|---|
| A1 | Auth | Bruteforce login / 2FA | 1 |
| A4 | Auth | Réutilisation magic link / reset token | 1 |
| B1 | Permissions | IDOR cross-bibliothèque | 1+2 |
| B2 | Permissions | Lecture annotations d'autrui | 3 |
| C1 | Upload | Path traversal | 2 |
| C2 | Upload | MIME spoofing | 2 |
| C3 | Upload | Malware uploadé | 2 |
| D1 | Liseuse | XSS via JS embarqué dans epub | 3 |
| D2 | Liseuse | Leak fichier original via URL prédictible | 3, 5 |
| G1 | Backup | Ransomware chiffre aussi backups | 8 |

### 6.2 Catégories couvertes

A. Authentification & sessions (8 risques)
B. Permissions & isolation (5 risques)
C. Upload & traitement fichiers (7 risques)
D. Liseuse & contenu servi (4 risques)
E. APIs externes & secrets (3 risques)
F. Infrastructure & déploiement (6 risques)
G. Backups & reprise (4 risques)
H. Privacy / RGPD (5 risques)

### 6.3 Risques résiduels acceptés

- **R1** Compromission complète du VPS root → mitigation partielle G1 (backups append-only).
- **R2** Compromission d'un Admin global après 2FA → AuditLog rend l'attaque détectable a posteriori.
- **R3** CVE Calibre `ebook-convert` → container isolé, pas de réseau, ressources cap.
- **R4** CVE epub.js / pdf.js → mises à jour suivies, iframe sandbox limite l'impact (D1).

### 6.4 Documents de sécurité à produire

- `docs/security/owasp-mapping.md` — couverture explicite Top 10 (Phase 0 puis enrichi).
- `docs/security/credential-rotation.md` — calendrier (Phase 0).
- `docs/security/incident-response.md` — procédure (Phase 8).
- `docs/security/threat-model.md` — modèle STRIDE formalisé (Phase 8).

---

## 7. Décisions résolues / questions ouvertes

### 7.1 Résolues

| Décision | Choix | Date |
|---|---|---|
| Stack backend/frontend | Next.js 15 App Router fullstack TypeScript | 2026-04-25 |
| ORM | Prisma 6 | 2026-04-25 |
| DB | PostgreSQL 16 | 2026-04-25 |
| Search | Meilisearch | 2026-04-25 |
| Cache + jobs | Redis + BullMQ | 2026-04-25 |
| Antivirus | ClamAV daemon | 2026-04-25 |
| Conversion | Calibre `ebook-convert` | 2026-04-25 |
| Email | Resend (fallback SMTP) | 2026-04-25 |
| Backup | borgbackup append-only vers NAS | 2026-04-25 |
| Stockage | Filesystem local hors webroot | 2026-04-25 |
| Modèle de rôles | 3 rôles (Global Admin / Library Admin / Member) | 2026-04-25 |
| Multi-tenancy | Single-tenant (un seul groupe par instance) | 2026-04-25 |
| Recette | Phase 7.5 dédiée avant hardening final | 2026-04-25 |

### 7.2 Ouvertes (à trancher avant ou pendant la phase concernée)

| Question | Phase | Note |
|---|---|---|
| Compte ISBNdb (clé API payante) ? | 2 | Si non, fallback sur Google Books + Open Library suffit |
| Hébergement Resend ou auto-hébergé Postal ? | 1 | Recommandation Resend (3000 mails / mois gratuits) |
| Nom de domaine final | 0 | À fournir avant déploiement Coolify staging |
| NAS : modèle / chemin SSH / clé dédiée | 8 | À fournir avant Phase 8 |
| Couleurs / logo / identité visuelle | 0 | Si pas de brand, je propose une charte sobre (tokens neutres, accent unique) |

---

## Annexe A — Risques sécurité détaillés

Légende : **[CRITIQUE]** = revue dédiée requise avant merge des phases concernées.

### A. Authentification & sessions

| # | Risque | Mitigation | Phase |
|---|---|---|---|
| A1 | **[CRITIQUE]** Bruteforce login / 2FA | Argon2id (params 19 Mo / 2 itérations / 1 thread minimum), rate limit IP+email sliding window (5 tentatives / 15 min), backoff exponentiel, lockout temporaire à 20 échecs | 1 |
| A2 | Énumération d'emails | Réponses HTTP et timings uniformes, message générique « si l'email existe… », delay artificiel constant | 1 |
| A3 | Vol de session (cookie hijack) | `httpOnly`, `Secure`, `SameSite=Lax`, rotation login/privilege change, expiration absolue 30j / inactive 7j, fingerprint UA | 1 |
| A4 | **[CRITIQUE]** Réutilisation magic link / reset token | Token 32 octets, **stocké hashé** en DB, single-use (`consumedAt`), expirations courtes (72h invitation, 1h reset) | 1 |
| A5 | Contournement 2FA (downgrade) | 2FA vérifié avant session privilégiée, désactivation impose re-auth + MdP, codes secours hashés argon2 | 1 |
| A6 | Vol secret TOTP en DB | `secretCipher` chiffré AES-256-GCM, clé maîtresse en env, nonce unique par enregistrement | 1 |
| A7 | Session fixation | Régénération ID session à chaque login (Auth.js, vérif explicite) | 1 |
| A8 | CSRF | Tokens CSRF Server Actions natifs, `SameSite=Lax`, double-submit pour endpoints sensibles | 1 |

### B. Permissions & isolation

| # | Risque | Mitigation | Phase |
|---|---|---|---|
| B1 | **[CRITIQUE]** Accès cross-bibliothèque (IDOR) | Toute query Prisma scope explicite `library.members.some({ userId })`, lint rule interdit `findMany`/`findFirst` sans `where`, tests E2E par paire users biblios différentes | 1+2 |
| B2 | **[CRITIQUE]** Lecture annotations d'autrui | Type Brand TS `PrivateScope` non-construisible hors `withCurrentUserScope(userId)`, compile error si oubli, test E2E dédié | 3 |
| B3 | Escalade via Admin Biblio | Admin biblio ne peut pas modifier rôle système ni promouvoir d'autres admins de sa biblio, vérif explicite + AuditLog | 1 |
| B4 | Fuite via cache HTTP partagé | `Cache-Control: private, no-store` sur endpoints user-scoped, pas de `user_id` en query string | 3 |
| B5 | Fuite via messages d'erreur | Erreurs uniformes prod (401/403/404 sans détail), stack traces serveur uniquement | toutes |

### C. Upload & traitement de fichiers

| # | Risque | Mitigation | Phase |
|---|---|---|---|
| C1 | **[CRITIQUE]** Path traversal | Nom client ignoré, path `/uploads/{libId}/{bookId}/{format}-{sha[:8]}.{ext}` côté serveur, vérif `path.resolve` reste dans base path | 2 |
| C2 | **[CRITIQUE]** MIME spoofing | Vérif type réel via libmagic (`file-type`) sur premiers octets, rejet si mismatch | 2 |
| C3 | **[CRITIQUE]** Malware uploadé | ClamAV daemon obligatoire pré-publication, fichier en quarantaine `/uploads-staging/` tant que pas `CLEAN`, freshclam quotidien | 2 |
| C4 | Zip bomb / fichier trop gros / pdf hostile | Limite hard 100 Mo à 3 niveaux (Traefik, middleware Next, DB), epub avec ratio max 10x, pdf-parse en sandbox process avec timeout 30s + cap RAM | 2, 4 |
| C5 | XXE / DoS sur parsing XML epub | Parser XML avec entités externes désactivées, limites profondeur DOM | 2, 4 |
| C6 | Injection via métadonnées | Sanitization à l'entrée (DOMPurify côté serveur), escape strict, lint rule interdit `dangerouslySetInnerHTML` | 2 |
| C7 | DoS flood d'uploads | Rate limit upload 10/h/user, BullMQ rate limiter par queue | 2 |

### D. Liseuse & contenu servi

| # | Risque | Mitigation | Phase |
|---|---|---|---|
| D1 | **[CRITIQUE]** XSS via JS embarqué dans epub | epub.js dans iframe `sandbox="allow-same-origin"` UNIQUEMENT (pas `allow-scripts`), CSP stricte iframe, tests epub piégé | 3 |
| D2 | **[CRITIQUE]** Leak fichier original via URL prédictible | URLs signées HMAC + expiration 5 min, liées à session, jamais d'accès direct filesystem via path | 3, 5 |
| D3 | Téléchargement non tracé | `DownloadLog` écrit avant début stream (transactionnel), refus si écriture log échoue | 5 |
| D4 | Cross-origin embed (clickjacking) | `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'` (sauf liseuse self) | 0+3 |

### E. APIs externes & secrets

| # | Risque | Mitigation | Phase |
|---|---|---|---|
| E1 | SSRF via fetch couvertures | Validation URL (refus IPs privées RFC 1918, loopback, link-local) après résolution DNS, timeout 10s | 2 |
| E2 | Fuite clé API | Toutes en env, jamais en code/log, `.env.example` documente, scan gitleaks en CI, rotation 6 mois documentée | 0 |
| E3 | DoS budget API externe | Cache métadonnées en DB, pas de re-fetch sauf demande Admin | 2 |

### F. Infrastructure & déploiement

| # | Risque | Mitigation | Phase |
|---|---|---|---|
| F1 | Headers sécurité oubliés | Helmet-like middleware, CSP stricte avec nonce SSR, HSTS preload, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy minimal, test CI | 0 |
| F2 | Secrets dans logs | pino `redact` sur clés sensibles, pas de stack traces côté client en prod | 0 |
| F3 | DB password faible / réseau Docker exposé | Postgres/Redis/Meili sur réseau Docker interne uniquement, jamais bindés sur host, mots de passe 32+ chars random différents par env | 0 |
| F4 | Container avec privilèges excessifs | `read_only: true` où possible, `cap_drop: [ALL]`, user non-root, pas de `--privileged`, ClamAV isolé sans accès filesystem app | 0+8 |
| F5 | Mise à jour dépendances oubliée | Dependabot, `npm audit` en CI échec si HIGH/CRITICAL, revue mensuelle planifiée | 0+8 |
| F6 | Image Docker contient des CVE | Base `node:22-alpine`, build multi-stage, Trivy en CI échec si CRITICAL, refresh trimestriel | 0 |

### G. Backups & reprise

| # | Risque | Mitigation | Phase |
|---|---|---|---|
| G1 | **[CRITIQUE]** Ransomware chiffre aussi backups | Push append-only vers NAS (`command="borg serve --append-only"`), VPS ne peut pas supprimer/écraser | 8 |
| G2 | Repo borg compromis (clé volée) | Repo chiffré, passphrase indépendante de la clé SSH, double stockage (gestionnaire + papier) | 8 |
| G3 | Backups jamais testés | Test restauration automatisé mensuel, échec → email Admin global | 8 |
| G4 | Rétention insuffisante | 7 quotidiens / 4 hebdo / 12 mensuels | 8 |

### H. Privacy / RGPD

| # | Risque | Mitigation | Phase |
|---|---|---|---|
| H1 | Surveillance des lectures | `ReadingProgress`/`ReadingSession` strictement privés (cf. B2). Stats biblio Admin **anonymisées** | 3, 7 |
| H2 | IPs en clair = données personnelles | Hash + sel rotatif 30j sur `DownloadLog` et `AuditLog` | 0+5 |
| H3 | Droit à l'effacement | Endpoint suppression user avec cascade (annotations, bookmarks, progress, sessions, ratings, reviews), `AuditLog` conservé (durée légale) | 1+8 |
| H4 | Droit à la portabilité | Endpoint export ZIP (annotations, bookmarks, collections, avis, historique en JSON) | 7 |
| H5 | Cookies de tracking | **Aucun**. Pas d'analytics, pas de pixel. Bandeau cookies non nécessaire | 0 |

Cette annexe sera reprise et étoffée dans `docs/security/threat-model.md` (modèle STRIDE formalisé) lors de la Phase 8.
