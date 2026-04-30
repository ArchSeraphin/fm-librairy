# Phase 2A' — Design : upload pipeline + ClamAV + dédup

**Date** : 2026-04-30
**Statut** : Spec validée en brainstorming, prête pour rédaction du plan d'implémentation
**Auteur** : Nicolas (avec assistance IA)
**Phase précédente** : 1D (catalogue `library.books` + UI member) — clôturée 2026-04-30
**Phase suivante** : 2B' (chaîne metadata Google Books / Open Library + cache couvertures)

---

## 1. Objectifs & non-objectifs

### 1.1 Objectifs

Permettre à un membre d'une bibliothèque ayant `canUpload=true` d'attacher un fichier (EPUB/PDF/TXT/DOCX, ≤ 100 MB) à un `Book` existant, avec :

- Validation MIME réelle via magic bytes (pas extension, pas `Content-Type`)
- Hash SHA-256 calculé en streaming pendant l'écriture staging
- Déduplication **par bibliothèque** (`@@unique([libraryId, sha256])`)
- Scan ClamAV bloquant **mais asynchrone** (upload retourne 200 quand le fichier est en staging + scan job enqueue ; le `BookFile` n'est pas exploitable tant que `scanStatus ≠ CLEAN`)
- Quarantaine + AuditLog SECURITY si INFECTED
- UX : badge de statut sur la fiche livre, refresh manuel pour MAJ (pas de polling)
- Tests d'attaque : EICAR, MIME spoofing, path traversal filename, oversize, dedup

### 1.2 Non-objectifs (différé Phase 2B'+ ou plus tard)

- **Upload de couverture** → Phase 2B' (vient de la chaîne metadata)
- **Chaîne metadata externe** (Google Books, Open Library, ISBNdb) → Phase 2B'
- **Tags editing UX** → Phase 2C'
- **Upload combiné à création de Book** (un seul form) — on garde 2 étapes (Book créé sans fichier, fichier ajouté ensuite)
- **Remplacement de fichier** (re-upload même format) — admin doit hard-delete d'abord
- **Bulk upload** (zip multi-livres, CSV) — post-MVP
- **Multi-formats par book simultanés** (EPUB+PDF en parallèle) — Phase 5 conversion s'en charge
- **Polling / SSE pour MAJ statut temps réel** — refresh page suffit (scan = quelques secondes)
- **Extraction texte / index Meili** → Phase 4
- **Téléchargement** (URL signées) → Phase 5
- **Cleanup auto stale PENDING** → Phase 8 hardening

### 1.3 Critère de réussite

Un membre `canUpload` upload un EPUB valide → Server Action retourne 200 → page détail montre badge "En analyse" → après refresh (≤ 10s typique), badge passe à "Disponible". Un EICAR upload → badge "Bloqué" + AuditLog SECURITY visible côté admin. Un fichier déjà présent dans la même biblio → 409 avec lien vers le livre existant.

---

## 2. Décisions verrouillées en brainstorming

1. **Découpage roadmap** : Phase 2 originale (catalogue + upload + ClamAV + metadata) splittée en 2A' (upload, ce doc), 2B' (metadata fetch + cover cache), 2C' (tags UX). Phase 2A original ("Library admin CRUD") absorbé en Phase 1C ; pas re-développé.
2. **Dédup per-library** (option B du brainstorming) : `@@unique([libraryId, sha256])` sur `BookFile`. Interdit la fuite cross-library, accepte la duplication disque (~25 GB max sur 500 livres × 50 MB).
3. **Scan async via worker** : décision portée par le schema existant (`BookFile.scanStatus = PENDING` par défaut). Server Action n'attend pas le scan ; UI affiche statut.
4. **Upload via Next.js Server Action** (pas tRPC, pas route handler) : `next.config.ts` a déjà `serverActions.bodySizeLimit: '100mb'`. Convention projet : forms = server actions (cf. mémoire `project_form_pattern`).
5. **ClamAV via INSTREAM TCP** vers `clamav:3310` (déjà en docker-compose). Pas de mount volume partagé avec ClamAV — uniquement entre `app` et `worker`.
6. **Storage local disque** sous `/data` (volume Docker `library_data` partagé app+worker, à créer). Pas de S3/MinIO en MVP.

---

## 3. Architecture en un coup d'œil

```
[Browser]
    │  multipart form (Server Action)
    ▼
┌──────────────────────────────────────────────────────┐
│ APP — Server Action `uploadBookFile(formData)`       │
│  1. authz : assertMembership(slug) + canUpload       │
│  2. parse FormData (Web stream)                      │
│  3. pipe through sha256-stream → write staging file  │
│  4. file-type magic-byte check (EPUB/PDF/TXT/DOCX)   │
│  5. dedup query (libraryId + sha256)                 │
│  6. INSERT BookFile { scanStatus: PENDING, ... }     │
│  7. enqueue BullMQ 'scan-file' { bookFileId }        │
│  8. return { ok, bookFileId, scanStatus: PENDING }   │
└──────────────────────────────────────────────────────┘
    │ Redis (BullMQ)
    ▼
┌──────────────────────────────────────────────────────┐
│ WORKER — job `scan-file`                             │
│  1. SELECT BookFile WHERE id                          │
│  2. open staging file → INSTREAM clamav:3310         │
│  3a. CLEAN  : mv staging→final                       │
│              UPDATE { scanStatus: CLEAN, scannedAt,  │
│                       storagePath: final }            │
│  3b. INFECTED : rm staging                           │
│              UPDATE { scanStatus: INFECTED }         │
│              AuditLog level=SECURITY                 │
│  3c. ERROR/timeout : retry 3× exp backoff,           │
│              sinon scanStatus=ERROR + DLQ            │
└──────────────────────────────────────────────────────┘
              │
              ▼
        ClamAV daemon
        (clamav:3310 INSTREAM)
```

---

## 4. Data model

### 4.1 Schema delta

`prisma/schema.prisma` — sur `BookFile` :

```prisma
model BookFile {
  // ... champs existants ...

  // Nouveau : empêche le même SHA dans la même biblio
  // (l'index [sha256] existant reste pour les lookups dedup)
  @@unique([libraryId, sha256])
}
```

**Problème** : `BookFile` n'a pas de `libraryId` direct (relation via `bookId → Book.libraryId`). Deux options :

- **(a)** Dénormaliser `libraryId` sur `BookFile` (FK Library + trigger ou app-level). Simple côté query, ajoute un champ.
- **(b)** Garder via `bookId`, faire la dédup en application (query `BookFile JOIN Book WHERE Book.libraryId = ? AND BookFile.sha256 = ?` avant INSERT, dans une transaction).

**Choix : (a)** — Cohérent avec l'ESLint rule `local/no-unscoped-prisma` qui exige `libraryId` explicite sur les modèles cloisonnés. Évite race condition à l'INSERT (DB-level uniqueness > app-level check). Migration ajoute `libraryId` + backfill (probablement zéro lignes en prod : Phase 1D livre `Book` mais pas de `BookFile` créé encore).

### 4.2 Migration

Nom : `20260430_phase_2a_book_file_library_unique`.

```sql
-- Add libraryId to BookFile, backfill, set NOT NULL, add unique constraint
ALTER TABLE "BookFile" ADD COLUMN "libraryId" TEXT;
UPDATE "BookFile" SET "libraryId" = b."libraryId"
  FROM "Book" b WHERE "BookFile"."bookId" = b.id;
ALTER TABLE "BookFile" ALTER COLUMN "libraryId" SET NOT NULL;
ALTER TABLE "BookFile" ADD CONSTRAINT "BookFile_libraryId_fkey"
  FOREIGN KEY ("libraryId") REFERENCES "Library"(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX "BookFile_libraryId_sha256_key"
  ON "BookFile"("libraryId", "sha256");
```

`@@index([sha256])` existant reste (pas un sous-ensemble du unique composite, car les lookups sans `libraryId` n'existent pas en MVP — on peut le retirer si Prisma le réclame, mais low-impact).

### 4.3 Aucune autre modification de modèle

`ScanStatus` enum (PENDING/CLEAN/INFECTED/ERROR), `BookFormat` enum (EPUB/PDF/TXT/DOCX), `BookFile.scannedAt`, `BookFile.storagePath`, `BookFile.fileSizeBytes`, `BookFile.mimeType`, `BookFile.sha256` : tous existent déjà depuis Phase 1D Module A.

---

## 5. Surface API

### 5.1 Server Action

`src/app/library/[slug]/books/[bookId]/upload/actions.ts`

```ts
export async function uploadBookFile(
  formData: FormData
): Promise<UploadResult>;

type UploadResult =
  | { ok: true; bookFileId: string; scanStatus: 'PENDING' }
  | {
      ok: false;
      error:
        | 'UNAUTHORIZED'        // pas membre ou pas canUpload
        | 'INVALID_MIME'         // file-type rejette
        | 'OVERSIZE'             // > 100MB (théoriquement intercepté plus tôt)
        | 'DUPLICATE'            // dedup hit dans cette biblio
        | 'FORMAT_TAKEN'         // ce Book a déjà un BookFile au même format
        | 'INTERNAL_ERROR';
      details?: { existingBookId?: string };
    };
```

Pattern identique à `admin/users/invite/actions.ts` (validation Zod, `getServerSession`, AuditLog, return shape). Form input : `<input type="file" name="file" required />` + hidden `bookId` + `slug`.

### 5.2 tRPC `library.files`

Nouveau router `src/server/trpc/routers/library/files.ts` :

```ts
export const filesRouter = libraryRouter({
  // Lecture pour l'UI (badge statut sur fiche livre)
  get: memberProcedure
    .input(z.object({ bookId: cuid }))
    .query(async ({ ctx, input }) => {
      // returns BookFile[] for the book, scoped to current library
    }),

  // Suppression admin (nettoyer INFECTED ou stale PENDING)
  delete: memberProcedure
    .input(z.object({ id: cuid }))
    .mutation(async ({ ctx, input }) => {
      // requires assertMembership(slug, 'ADMIN')
      // delete from disk + DB row + AuditLog
    }),
});
```

Mounted dans `library/index.ts` aux côtés de `books`.

### 5.3 Pas de tRPC mutation `upload`

L'upload passe **uniquement** par la Server Action (binaire FormData mal supporté par tRPC HTTP par défaut, et la convention projet est server action pour les forms).

---

## 6. UI

### 6.1 Page détail livre (patch)

`src/app/library/[slug]/books/[bookId]/page.tsx` — ajouter une section "Fichier" :

- Si aucun `BookFile` exist pour ce book ET l'user a `canUpload` : montrer `<BookFileUpload />` (formulaire upload)
- Si BookFile exist : montrer `<ScanStatusBadge />` + `fileName` + `fileSize` + (si admin biblio) bouton "Supprimer le fichier"
- Si BookFile.scanStatus = INFECTED : message rouge avec lien admin "Voir audit log"

### 6.2 BookCard (patch)

`src/components/books/BookCard.tsx` — ajouter `<ScanStatusBadge size="sm" />` à côté du titre. Pour les Books sans BookFile : pas de badge (ou badge gris "Pas de fichier" — décision UX, je propose : pas de badge pour pas surcharger la grille).

### 6.3 Nouveaux composants

- `src/components/books/BookFileUpload.tsx` (client component)
  - `<form action={uploadBookFile}>` avec `<input type="file">` + bouton submit
  - useFormStatus pour spinner
  - Toast résultat (success/error mappé sur `UploadResult.error`)
  - Pas de progress bar custom en MVP (browser-native suffit pour 100MB sur LAN)

- `src/components/books/ScanStatusBadge.tsx` (server component)
  - Mappe `ScanStatus` → couleur + label FR :
    - PENDING : neutre + spinner + "En analyse"
    - CLEAN : vert + "Disponible"
    - INFECTED : rouge + "Bloqué (analyse de sécurité)"
    - ERROR : orange + "Erreur d'analyse — réessayer"

### 6.4 Erreurs côté UI

Toast mappings :
- INVALID_MIME → "Format de fichier non supporté. Formats acceptés : EPUB, PDF, TXT, DOCX."
- OVERSIZE → "Fichier trop volumineux (max 100 MB)."
- DUPLICATE → "Ce fichier existe déjà dans cette bibliothèque." + lien vers `existingBookId`
- FORMAT_TAKEN → "Ce livre a déjà un fichier {format}. Demandez à un admin de le supprimer pour le remplacer."
- UNAUTHORIZED → "Vous n'avez pas le droit d'uploader dans cette bibliothèque."
- INTERNAL_ERROR → "Erreur serveur. Réessayez ou contactez un admin."

---

## 7. Permissions

### 7.1 Matrice (delta)

Conforme à `docs/permissions-matrix.md` (5 colonnes officielles, 1 ligne par procédure ou action) :

| Action | GLOBAL_ADMIN | LIBRARY_ADMIN | MEMBER | ANON | PENDING_2FA |
|--------|--------------|---------------|--------|------|-------------|
| `library.files.upload` (Server Action) | ✗ (sauf membre actuel de la biblio + canUpload) | ✓ (7) | ✓ (7) | ✗ | ✗ |
| `library.files.get` | ✗ (sauf membre) | ✓ | ✓ | ✗ | ✗ |
| `library.files.delete` | ✗ (sauf LIBRARY_ADMIN) | ✓ (8) | ✗ | ✗ | ✗ |

(7) Exige `LibraryMember.canUpload = true` pour cet `userId` × `libraryId`. Le flag est orthogonal au rôle (un MEMBER peut être promu uploader, un LIBRARY_ADMIN peut avoir canUpload=false bien que ce soit inhabituel).
(8) Refuse si library archived (`archivedAt != null`).

**Note importante** : `GLOBAL_ADMIN` *en tant que tel* n'a PAS le droit d'uploader dans une biblio dont il n'est pas membre. La logique est library-scoped via `assertMembership`. Un GLOBAL_ADMIN qui veut uploader doit s'ajouter comme membre via `admin.libraries.members.add`.

### 7.2 Implementation

Server Action `uploadBookFile` :
```ts
const member = await assertMembership(slug); // throw 403 si pas membre
if (!member.canUpload) throw new Error('UNAUTHORIZED');
```

`library.files.delete` : `assertMembership(slug, 'ADMIN')`.

Tests permissions ajoutés à `tests/integration/permissions-matrix.test.ts` (matrice anti-drift).

---

## 8. Tests

### 8.1 Unit (`tests/unit/upload/`)

- `mime-validator.test.ts` : rejette .exe magic bytes, accepte EPUB/PDF/TXT/DOCX réels (fixtures), gère stream tronqué
- `sha256-stream.test.ts` : digest correct pour vecteurs connus, `bytesWritten` exact, gère streams vides
- `storage-paths.test.ts` : pas de path traversal possible (filename `../../etc/passwd` → throw), paths générés sous `STORAGE_ROOT`
- `staging-io.test.ts` : orchestre les 3 ci-dessus + cleanup en cas d'erreur (mock fs)

### 8.2 Integration (`tests/integration/`)

- `upload-action.test.ts` : Server Action complète avec DB réelle + ClamAV mocké (toujours CLEAN). Vérifie BookFile créé + job enqueue.
- `upload-action-attacks.test.ts` : INVALID_MIME, OVERSIZE (mock body trop gros), DUPLICATE (insert préalable même sha+lib), FORMAT_TAKEN.
- `scan-file-job.test.ts` : worker job avec ClamAV mocké, vérifie 3 chemins (CLEAN/INFECTED/ERROR), retry policy, AuditLog INFECTED.
- `permissions-matrix.test.ts` : extension à `library.files.{upload,get,delete}` × 5 rôles.

### 8.3 E2E (`tests/e2e/`)

- `book-upload.spec.ts` : upload EPUB valide → badge PENDING → wait 5s → refresh → badge CLEAN. Worker doit tourner en CI (cf. mémoire `feedback_ci_worker`).
- Réutilisation : pas de nouveau spec pour l'attack EICAR — c'est dans `tests/attacks/`.

### 8.4 Attack (`tests/attacks/upload.test.ts`)

- **EICAR** : upload du vrai fichier EICAR (chaîne ASCII standard X5O!P%@AP[4\PZX54...) → ClamAV doit détecter → BookFile.scanStatus = INFECTED + AuditLog SECURITY + staging cleanup
- **MIME spoofing** : binaire .exe Windows renommé `.pdf` → file-type lit le magic byte `MZ` → INVALID_MIME, pas de write staging
- **Path traversal** : filename `../../../etc/passwd.epub` (epub valide en magic bytes mais filename malicieux) → `storage-paths` doit normaliser et empêcher la sortie de STORAGE_ROOT
- **Oversize** : fichier 101 MB → Server Action body limit reject (test peut être fragile selon Next config, fallback : check explicite dans staging-io)
- **Dedup** : upload même fichier 2× dans la même biblio → 2ème = DUPLICATE
- **Cross-lib non-leak** : upload SHA X dans biblio A, puis dans biblio B → 2ème = succès (per-library dedup, pas global)

### 8.5 ESLint rule

Pas de nouvelle rule. `local/no-unscoped-prisma` couvre déjà les queries `BookFile` puisqu'on ajoute `libraryId` au modèle.

---

## 9. Risques & mitigations

| Risque | Mitigation MVP | Renvoyé à |
|--------|----------------|-----------|
| MIME spoofing | `file-type` magic bytes, test attack | — |
| Path traversal filename | `storage-paths` validation `path.resolve` sous STORAGE_ROOT, test attack | — |
| DoS upload concurrent | Cap 100 MB body, **rate-limit upload** 3/min/user via Redis (pattern existant cf. password reset) | Ajouté au scope 2A'.3 |
| Disque plein | Aucune mitigation auto MVP, log warning au démarrage worker | Phase 8 |
| ClamAV down | Job retry 3× exp backoff, puis scanStatus=ERROR + DLQ. Admin peut delete manuellement. | — |
| ClamAV bypass / fichier malformé | INSTREAM timeout → ERROR. App n'ouvre jamais le fichier. | — |
| Stale PENDING (worker mort) | Admin hard-delete manuel via tRPC `library.files.delete` | Phase 8 cron cleanup |
| Race condition dedup | DB-level `@@unique([libraryId, sha256])` (pas check applicatif seul) | — |
| Replacement de fichier | Pas de remplacement direct ; admin delete + nouveau upload | Post-MVP feature |

---

## 10. Découpage en sous-modules

Pattern Phase 1D (modules A→F mergés en non-squash). Ici 5 modules :

| Mod | Titre | Livrables principaux | Dépend |
|-----|-------|----------------------|--------|
| **2A'.0** | Infra + schema | Migration `book_file_library_unique` ; volume Docker `library_data` partagé app+worker ; var env `STORAGE_ROOT=/data` ; mise à jour `.env.example` + `docker-compose.yml` | — |
| **2A'.1** | Libs upload (pure) | `src/lib/upload/{mime-validator,sha256-stream,storage-paths,staging-io}.ts` + tests unit. Aucune intégration DB ou worker. | 2A'.0 |
| **2A'.2** | Worker scan job | `worker/lib/clamav.ts` (INSTREAM), `worker/jobs/scan-file.ts`, register dans `worker/index.ts` avec retry policy ; tests integration avec ClamAV mocké | 2A'.1 |
| **2A'.3** | Server Action + tRPC + rate-limit | `uploadBookFile` action ; router `library.files.{get,delete}` ; rate-limit 3/min/user (Redis token bucket pattern existant) ; tests integration + permissions matrix | 2A'.1, 2A'.2 |
| **2A'.4** | UI + tests E2E + attacks | `BookFileUpload`, `ScanStatusBadge`, patches `BookCard` + page détail ; specs E2E happy path + attaques (`tests/attacks/upload.test.ts`) | 2A'.3 |

Dépendances strictes : 2A'.0 → 2A'.1 → 2A'.2 → 2A'.3 → 2A'.4. Pas de parallélisme propre (chaque module bloque le suivant).

---

## 11. Pattern d'exécution

Comme Phase 1D :
- Branche unique `feat/phase-2a-upload`
- Un commit par module + sous-tâche, conventional commits
- Reviewer pattern : `superpowers:subagent-driven-development` avec implementer → spec-reviewer per task
- À la clôture : tag `phase-2a-complete`, mémoire mise à jour, design 2B' lancé

---

## 12. Annexes

### 12.1 Vecteur de test EICAR

Fichier texte ASCII standard (n'est PAS un vrai virus, mais ClamAV le détecte par signature de test) :

```
X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*
```

Encadré d'un wrapper EPUB minimal pour passer le `file-type` check (ou bien tester directement comme `.txt`).

### 12.2 Protocole INSTREAM ClamAV

Format binaire simple sur TCP :
- Client envoie `zINSTREAM\0`
- Puis chunks `<size:4-byte-BE><data>`
- Termine avec `<size: 0:4-byte-BE>`
- Serveur répond `stream: OK\n` ou `stream: <virus> FOUND\n`

Implémentation cible : ~50 lignes TS sans dépendance externe (juste `node:net`).

### 12.3 Convention paths

```
/data/
  staging/
    <sha256>.<ext>           # éphémère, supprimé après scan
  library/
    <libraryId>/
      <bookId>/
        <sha256>.<ext>       # final, immuable
```

Justification du SHA dans le path final : permet la suppression idempotente, évite collision de noms, simplifie le borg backup (Phase 8).
