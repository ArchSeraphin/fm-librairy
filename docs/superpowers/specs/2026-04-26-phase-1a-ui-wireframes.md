# Phase 1A — Wireframes UI auth

> Spec produit pour Task 18 (implémentation). Aucun code React ici — uniquement des wireframes structurés, choix de composants, classes Tailwind clés et clés i18n. L'implémenteur ne devine rien.

Date : 2026-04-26
Périmètre : 5 écrans + 1 banner + 1 page admin minimale + 1 layout auth.

---

## 1. Design tokens (rappel synthétique)

Tout est déjà défini dans `src/app/globals.css` et `tailwind.config.ts`. Ce spec n'introduit **aucun nouveau token**.

### Palette utilisée

| Rôle                 | Token                                                      | Usage Phase 1A                  |
| -------------------- | ---------------------------------------------------------- | ------------------------------- |
| Fond page auth       | `bg-muted` (220 13% 96%)                                   | `(auth)/layout.tsx`             |
| Fond page admin      | `bg-background` (0 0% 100%)                                | `admin/layout.tsx`              |
| Card                 | `bg-card` + `shadow` (déjà via `<Card>`)                   | tous écrans                     |
| Texte principal      | `text-foreground`                                          | titres, body                    |
| Texte secondaire     | `text-muted-foreground`                                    | descriptions, hints             |
| Accent (CTA, focus)  | `bg-accent` / `text-accent` / `bg-accent/10`               | icône signature, focus ring     |
| Erreur               | `bg-destructive/10 border-destructive/20 text-destructive` | `<Alert variant="destructive">` |
| Succès               | `bg-success/10 text-success`                               | confirmation banner (rare)      |
| Warning (banner 2FA) | `bg-warning/10 border-warning/30` + `text-foreground`      | `<TwoFactorBanner>`             |

### Typographie

| Élément                             | Police     | Classe Tailwind                          |
| ----------------------------------- | ---------- | ---------------------------------------- |
| Titres écrans (CardTitle)           | Geist Sans | `text-xl font-semibold tracking-tight`   |
| Body                                | Geist Sans | `text-sm` ou `text-base`                 |
| Labels formulaires                  | Geist Sans | `text-sm font-medium`                    |
| Codes (TOTP secret, recovery codes) | Geist Mono | `font-mono text-sm tracking-wider`       |
| Wordmark                            | Geist Sans | `text-base font-semibold tracking-tight` |

### Composants shadcn réutilisés

`Button`, `Input`, `Card`/`CardHeader`/`CardTitle`/`CardDescription`/`CardContent`/`CardFooter`, `Toast`/`Toaster` (déjà présents).

### Composants nouveaux requis

Voir §9 — `Alert`, `Label`, `Checkbox`, `OtpInput`, `Stepper`, `BrandMark`.

### Animations

- `animate-slide-up` — sur la `<Card>` au mount de chaque écran auth (entrée discrète).
- `animate-fade-in` — sur les `<Alert>` qui apparaissent après une erreur (sinon le saut de hauteur est brusque).
- Aucune animation sur la banner 2FA — elle doit rester stable visuellement.

### Icônes Lucide utilisées (toutes via `lucide-react`)

`Library` (brand), `LogIn`, `ShieldCheck`, `KeyRound`, `Smartphone`, `LifeBuoy`, `ShieldAlert`, `Loader2`, `Copy`, `Check`, `Download`, `ArrowLeft`, `AlertCircle`, `Eye`, `EyeOff`.

**Aucun emoji nulle part. Jamais.**

---

## 2. Layout auth — `src/app/(auth)/layout.tsx`

### Wireframe

```
┌──────────────────────────────────────┐
│                                      │
│                                      │
│         ┌─[Library icon]─┐           │  ← BrandMark (icône + wordmark)
│         │  BiblioShare   │           │     centré, marge bas 32px (mb-8)
│         └────────────────┘           │
│                                      │
│      ┌────────────────────┐          │
│      │                    │          │
│      │      <Card>        │          │  ← max-w-sm, animate-slide-up
│      │     children       │          │
│      │                    │          │
│      └────────────────────┘          │
│                                      │
│        Accès sur invitation          │  ← footer-note (auth.layout.invite)
│            uniquement                │     mt-6 text-xs text-muted-foreground
│                                      │
└──────────────────────────────────────┘
       fond : bg-muted, p-6
```

### Structure

```
<main className="flex min-h-dvh flex-col items-center justify-center bg-muted p-6">
  <BrandMark className="mb-8" />
  <div className="w-full max-w-sm">{children}</div>
  <p className="mt-6 text-xs text-muted-foreground text-center">
    {t('auth.layout.invite')}
  </p>
</main>
```

### Détails

- `min-h-dvh` (viewport dynamique mobile, pas `min-h-screen`).
- Pas de header, pas de footer admin — purement isolé.
- En dark mode : `bg-muted` change automatiquement (déjà géré par les variables CSS).

### Clés i18n

- `auth.layout.invite` → « Accès sur invitation uniquement. »

---

## 3. Page `/login` — étape 1

### Wireframe

```
┌────────────────────────────────────┐
│  ┌──┐                              │  ← icône carrée 40px bg-accent/10
│  │LI│  Connexion                   │     Lucide LogIn h-5 w-5 text-accent
│  └──┘  Accédez à votre bibliothèque│     CardTitle text-xl + CardDescription
│                                    │
│  ────────────────────────────────  │  ← separator (pas obligatoire, espace)
│                                    │
│  [! Identifiants incorrects...]    │  ← Alert destructive, animate-fade-in
│                                    │     visible uniquement en error state
│  Adresse e-mail                    │  ← <Label>
│  ┌──────────────────────────────┐  │
│  │ vous@exemple.com             │  │  ← <Input type="email" autoComplete="username">
│  └──────────────────────────────┘  │
│                                    │
│  Mot de passe                      │  ← <Label>
│  ┌──────────────────────────┬───┐  │
│  │ ••••••••                 │ 👁 │  │  ← <Input type="password"> + toggle Eye/EyeOff
│  └──────────────────────────┴───┘  │     bouton ghost size-icon en absolu droite
│                                    │
│  ┌──────────────────────────────┐  │
│  │  Se connecter                │  │  ← <Button> default, full-width
│  └──────────────────────────────┘  │     pending → <Loader2 animate-spin>
│                                    │
│  Mot de passe oublié ?             │  ← <Button variant="link"> disabled
│   (Phase 1B)                       │     muted-foreground italic, title=
│                                    │     "Disponible dans une prochaine mise à jour"
└────────────────────────────────────┘
        <Card>, animate-slide-up
```

### Composants

- `<Card>` racine.
- `<CardHeader>` avec : `<div bg-accent/10>` + `<LogIn>` icon, `<CardTitle>`, `<CardDescription>`.
- `<CardContent>` avec : `<form>` natif → `<Alert>` (conditionnel) + 2 `<Label>+<Input>` paires + `<Button>` submit.
- `<CardFooter>` avec : `<Button variant="link" disabled>`.

### Classes Tailwind clés

- Header : `space-y-3` ; bloc icône `flex h-10 w-10 items-center justify-center rounded-md bg-accent/10`.
- Form : `space-y-4`.
- Toggle password : `<button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">` avec wrapper `relative` autour de l'Input.
- Bouton submit : `w-full`.

### États

| État      | Comportement                                                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `idle`    | Form neutre, pas d'Alert.                                                                                                                |
| `pending` | `<Button disabled>` + `<Loader2 className="animate-spin">` à la place du libellé. Champs `disabled`.                                     |
| `error`   | Alert destructive avec `auth.login.error.invalid` au-dessus du form, `aria-live="polite"`. Form reste rempli côté client (pas de reset). |
| `locked`  | Même Alert mais avec `auth.login.error.locked`. (Différenciation côté serveur uniquement après lockout — sinon traité comme `invalid`.)  |

### Interactions

1. Focus initial : champ email (autofocus).
2. Tab order : email → password → toggle visibility → submit.
3. Enter dans n'importe quel champ → submit.
4. Escape : blur du toggle visibility (sinon rien).
5. Submit → `signIn('credentials', { email, password, redirect: false })`. Si `result.error` → état `error`. Sinon → `router.push(callbackUrl ?? '/')` + `router.refresh()`.

### Clés i18n

```
auth.login.title                  → « Connexion »
auth.login.description            → « Accédez à votre bibliothèque »
auth.login.email.label            → « Adresse e-mail »
auth.login.email.placeholder      → « vous@exemple.com »
auth.login.password.label         → « Mot de passe »
auth.login.password.toggleShow    → « Afficher le mot de passe »  (sr-only)
auth.login.password.toggleHide    → « Masquer le mot de passe »   (sr-only)
auth.login.submit                 → « Se connecter »
auth.login.submit.pending         → « Connexion en cours… »
auth.login.forgotPassword         → « Mot de passe oublié ? »
auth.login.forgotPassword.disabled → « Disponible dans une prochaine mise à jour »
auth.login.error.invalid          → « Identifiants incorrects ou compte verrouillé. »
auth.login.error.locked           → « Compte temporairement verrouillé. Réessayez dans quelques minutes. »
```

---

## 4. Page `/login/2fa` — challenge TOTP

### Wireframe

```
┌────────────────────────────────────┐
│  ┌──┐                              │
│  │SC│  Vérification en deux étapes │  ← Lucide ShieldCheck
│  └──┘  Entrez le code à 6 chiffres │
│        de votre application        │
│                                    │
│  [! Code invalide.]                │  ← Alert destructive (conditionnel)
│                                    │
│        ┌─┐┌─┐┌─┐┌─┐┌─┐┌─┐          │  ← <OtpInput length={6}>
│        │ ││ ││ ││ ││ ││ │          │     6 cellules h-12 w-10
│        └─┘└─┘└─┘└─┘└─┘└─┘          │     bordure focus accent, mono
│                                    │
│  ┌──────────────────────────────┐  │
│  │  Vérifier                    │  │  ← submit, full-width
│  └──────────────────────────────┘  │
│                                    │
│  ─────────────────────────────     │  ← divider léger (border-t border-border)
│                                    │
│  Utiliser un code de récupération  │  ← <Button variant="link"> → /login/2fa/backup
│                                    │     centré, text-sm
│  [← Retour à la connexion]         │  ← <Button variant="ghost" size="sm">
│                                    │     ArrowLeft icône, signOut côté client
└────────────────────────────────────┘
```

### Composants

- `<Card>` racine, header standard (icône `ShieldCheck` carrée).
- `<CardContent>` avec `<form>` → Alert conditionnel + `<OtpInput>` + `<Button>` submit.
- `<CardFooter>` avec deux liens : « Utiliser un code de récupération » (link variant) et « Retour à la connexion » (ghost variant + icône `ArrowLeft`).
- Espacement entre form et footer : `border-t border-border` + `pt-4`.

### États

| État          | Comportement                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `idle`        | OtpInput vide, autofocus sur la première cellule. Submit `disabled` tant que < 6 chiffres saisis.                         |
| `pending`     | Cellules `disabled`, bouton `<Loader2>`.                                                                                  |
| `error`       | Alert avec `auth.tfa.error.invalid`, OtpInput se vide (les 6 cellules clear), focus retour cellule 1.                     |
| `auto-submit` | Quand l'utilisateur tape la 6ème cellule, submit déclenché automatiquement (UX standard). Pas besoin de cliquer Vérifier. |

### Interactions OtpInput

- 6 cellules `<input type="text" inputMode="numeric" maxLength={1} pattern="[0-9]">`.
- Saisie chiffre → focus cellule suivante.
- Backspace sur cellule vide → focus cellule précédente + clear.
- Paste sur cellule 1 d'une string 6 chiffres → distribue dans les 6 cellules + auto-submit.
- Flèches gauche/droite → navigation entre cellules.
- `autoComplete="one-time-code"` sur la première cellule (déclenche l'iOS auto-fill SMS/TOTP suggestions).

### Submit

```
trpc.auth.verifyTwoFactor.mutate({ code: '123456' })
  → success → router.push(callbackUrl ?? '/admin'); router.refresh();
  → error TOTP_INVALID → setError + clear cellules + focus cellule 1
  → error RATE_LIMITED → setError avec auth.tfa.error.rateLimited
```

### Clés i18n

```
auth.tfa.title                  → « Vérification en deux étapes »
auth.tfa.description            → « Entrez le code à 6 chiffres de votre application d'authentification »
auth.tfa.submit                 → « Vérifier »
auth.tfa.useBackupCode          → « Utiliser un code de récupération »
auth.tfa.backToLogin            → « Retour à la connexion »
auth.tfa.error.invalid          → « Code invalide. »
auth.tfa.error.rateLimited      → « Trop de tentatives. Réessayez dans quelques minutes. »
```

---

## 5. Page `/login/2fa/backup` — fallback recovery code

### Wireframe

```
┌────────────────────────────────────┐
│  ┌──┐                              │
│  │KR│  Code de récupération        │  ← Lucide KeyRound
│  └──┘  Saisissez l'un de vos       │
│        codes à usage unique        │
│                                    │
│  [! Code invalide ou déjà utilisé.]│  ← Alert destructive (conditionnel)
│                                    │
│  ┌──────────────────────────────┐  │
│  │ XXXX-XXXX                    │  │  ← <Input> font-mono uppercase
│  └──────────────────────────────┘  │     placeholder="XXXX-XXXX"
│                                    │     maxLength=9 (8 chars + tiret)
│  Code à 8 caractères, format       │  ← hint text-xs text-muted-foreground
│  XXXX-XXXX (lettres et chiffres)   │
│                                    │
│  ┌──────────────────────────────┐  │
│  │  Vérifier                    │  │
│  └──────────────────────────────┘  │
│                                    │
│  ─────────────────────────────     │
│                                    │
│  [← Retour au code à 6 chiffres]   │  ← <Button variant="ghost" size="sm">
└────────────────────────────────────┘
```

### Composants

- `<Card>` racine, header standard (icône `KeyRound` carrée).
- Form : `<Input>` simple (pas d'OtpInput segmenté pour 8 chars — c'est trop visuellement, GitHub/Google utilisent un seul champ mono).
- Hint text sous l'input : « Code à 8 caractères… ».
- Footer : retour vers `/login/2fa`.

### Détails Input

```
<Input
  type="text"
  inputMode="text"
  autoComplete="one-time-code"
  autoCapitalize="characters"
  spellCheck={false}
  maxLength={9}                  // 8 chars + tiret optionnel
  pattern="[A-Za-z0-9-]{8,9}"
  className="font-mono uppercase tracking-widest text-center text-base"
  placeholder="XXXX-XXXX"
/>
```

Côté handler : on strip le tiret avant envoi à l'API (`code.replace(/-/g, '').toUpperCase()`).

### États

| État      | Comportement                                                                                                |
| --------- | ----------------------------------------------------------------------------------------------------------- |
| `idle`    | Champ vide, autofocus. Submit `disabled` tant que < 8 chars.                                                |
| `pending` | `disabled` + Loader2.                                                                                       |
| `error`   | Alert avec `auth.backup.error.invalid`. Champ reste rempli (utilisateur peut corriger une faute de frappe). |

### Clés i18n

```
auth.backup.title          → « Code de récupération »
auth.backup.description    → « Saisissez l'un de vos codes à usage unique »
auth.backup.placeholder    → « XXXX-XXXX »
auth.backup.hint           → « Code à 8 caractères, format XXXX-XXXX (lettres et chiffres) »
auth.backup.submit         → « Vérifier »
auth.backup.backToTotp     → « Retour au code à 6 chiffres »
auth.backup.error.invalid  → « Code invalide ou déjà utilisé. »
```

---

## 6. Page `/2fa/setup` — enrolement TOTP

### Wireframe

```
┌────────────────────────────────────┐
│  ┌──┐                              │
│  │SP│  Activer la 2FA              │  ← Lucide Smartphone
│  └──┘  Étape 1 sur 2 — scanner     │
│        le QR code                  │
│                                    │
│  ▓▓ ▓▓ ▓▓                          │  ← Stepper visuel : 2 segments
│  ━━━━━━ ──────                     │     1 plein (accent), 1 vide (border)
│                                    │
│  ┌──────────────────────────┐      │
│  │ ████ ████ ██   ████      │      │
│  │ ██   ████ ████   ██      │      │  ← QR code <Image> 192×192
│  │   ██ ██     ██ ████      │      │     centré, bg-white p-3 border rounded
│  │ ████   ██ ████   ██      │      │
│  │ ██████ ████ ██████       │      │
│  └──────────────────────────┘      │
│                                    │
│  Ou saisir manuellement :          │  ← text-xs text-muted-foreground
│  ┌──────────────────────────┬───┐  │
│  │ JBSWY3DPEHPK3PXP         │ 📋│  │  ← bg-muted font-mono px-3 py-2
│  └──────────────────────────┴───┘  │     bouton Copy à droite (size-icon)
│                                    │
│  Code de vérification              │  ← <Label>
│        ┌─┐┌─┐┌─┐┌─┐┌─┐┌─┐          │
│        │ ││ ││ ││ ││ ││ │          │  ← <OtpInput length={6}>
│        └─┘└─┘└─┘└─┘└─┘└─┘          │
│                                    │
│  [! Code invalide.]                │  ← Alert destructive (conditionnel)
│                                    │
│  ┌──────────────────────────────┐  │
│  │  Confirmer et continuer      │  │  ← submit
│  └──────────────────────────────┘  │
│                                    │
└────────────────────────────────────┘
```

### Composants

- `<Card>` racine, header standard (icône `Smartphone`).
- `<Stepper currentStep={1} totalSteps={2} />` juste sous le header.
- QR code : `<img>` ou Next `<Image>` reçu en data URL depuis `trpc.auth.startTwoFactorSetup`. Contenu : `wrapper bg-white p-3 border rounded-md mx-auto w-fit` (force fond blanc même en dark mode car les QR readers exigent contraste élevé).
- Secret manuel : `<div className="flex items-center gap-2 bg-muted rounded-md px-3 py-2">` avec `<code className="font-mono text-sm tracking-wider flex-1 truncate">` et `<Button variant="ghost" size="icon">` + `<Copy>`/`<Check>` icon (toggle 2s après copie).
- `<OtpInput length={6}>` (même composant que /login/2fa).
- `<Button>` full-width.

### Données initiales

Au mount : `useEffect` → `trpc.auth.startTwoFactorSetup.mutate()` → reçoit `{ qrCodeDataUrl, secret }`. Stocker en state. Ne JAMAIS persister côté client au-delà du mount.

### États

| État         | Comportement                                                                        |
| ------------ | ----------------------------------------------------------------------------------- |
| `loading-qr` | Skeleton sur le bloc QR + secret.                                                   |
| `idle`       | OtpInput vide, submit `disabled` jusqu'à 6 chiffres.                                |
| `pending`    | `<Loader2>`, OtpInput cellules `disabled`.                                          |
| `error`      | Alert + clear OtpInput + focus cellule 1.                                           |
| `success`    | Pas d'écran intermédiaire — redirection immédiate vers `/2fa/setup/recovery-codes`. |

### Submit

```
trpc.auth.confirmTwoFactorSetup.mutate({ code })
  → success → router.push('/2fa/setup/recovery-codes')
  → error → setError
```

### Clés i18n

```
auth.tfaSetup.title              → « Activer la 2FA »
auth.tfaSetup.description        → « Étape 1 sur 2 — scanner le QR code »
auth.tfaSetup.qrCaption          → « Scannez ce code avec votre application d'authentification »
auth.tfaSetup.manualLabel        → « Ou saisir manuellement : »
auth.tfaSetup.copySecret         → « Copier le secret »
auth.tfaSetup.copied             → « Copié »
auth.tfaSetup.codeLabel          → « Code de vérification »
auth.tfaSetup.submit             → « Confirmer et continuer »
auth.tfaSetup.error.invalid      → « Code invalide. Vérifiez l'heure de votre appareil. »
auth.tfaSetup.error.expired      → « La session de configuration a expiré. Recommencez. »
```

---

## 7. Page `/2fa/setup/recovery-codes` — affichage one-shot

### Wireframe

```
┌────────────────────────────────────┐
│  ┌──┐                              │
│  │LB│  Codes de récupération       │  ← Lucide LifeBuoy
│  └──┘  Étape 2 sur 2 — conserver   │
│        ces codes en lieu sûr       │
│                                    │
│  ▓▓ ▓▓ ▓▓                          │  ← Stepper 2/2 : 2 segments pleins
│  ━━━━━━ ━━━━━━                     │
│                                    │
│  [⚠ Ne sera plus jamais affiché.]  │  ← Alert variant="warning"
│   À conserver maintenant.          │     icône AlertCircle
│                                    │
│  ┌─────────────┬─────────────┐     │
│  │ A1B2-C3D4   │ E5F6-G7H8   │     │
│  ├─────────────┼─────────────┤     │  ← grille 2 colonnes × 4 lignes
│  │ J9K0-L1M2   │ N3O4-P5Q6   │     │     chaque cellule : bg-muted rounded-md
│  ├─────────────┼─────────────┤     │     px-3 py-2 font-mono text-sm tracking-wider
│  │ R7S8-T9U0   │ V1W2-X3Y4   │     │     text-center
│  ├─────────────┼─────────────┤     │
│  │ Z5A6-B7C8   │ D9E0-F1G2   │     │
│  └─────────────┴─────────────┘     │
│                                    │
│  ┌──────────┐  ┌──────────────┐   │
│  │ 📋 Copier │  │ ⬇ Télécharger│   │  ← 2 boutons outline, gap-2
│  └──────────┘  └──────────────┘   │     icônes Copy / Download
│                                    │
│  ☐ J'ai sauvegardé ces codes en    │  ← <Checkbox> + label
│    lieu sûr                        │
│                                    │
│  ┌──────────────────────────────┐  │
│  │  Continuer                   │  │  ← <Button> default, disabled tant que
│  └──────────────────────────────┘  │     checkbox non cochée
│                                    │
└────────────────────────────────────┘
```

### Composants

- `<Card>` racine, header standard (icône `LifeBuoy`).
- `<Stepper currentStep={2} totalSteps={2} />`.
- `<Alert variant="warning">` avec icône `AlertCircle` et texte fort.
- Grille codes : `<ul role="list" className="grid grid-cols-2 gap-2">` → `<li>` avec classes mono. **Pas de bouton de copie individuel** par code (UX inutile, on copie tout).
- Boutons actions : `<Button variant="outline" size="sm">` × 2, avec icônes.
- `<Checkbox>` + `<Label>`.
- `<Button>` continue, `disabled={!confirmed}`.

### Logique copie / download

- **Copier** : `navigator.clipboard.writeText(codes.join('\n'))` → toast success « Codes copiés ».
- **Télécharger** : génère un Blob text/plain `\n`-séparé, nom de fichier `biblioshare-recovery-codes-YYYY-MM-DD.txt`, déclenche un `<a download>` éphémère.

### États

| État         | Comportement                                               |
| ------------ | ---------------------------------------------------------- |
| `loading`    | Skeleton grille (8 placeholders).                          |
| `idle`       | Codes affichés, checkbox `unchecked`, Continue `disabled`. |
| `confirmed`  | Checkbox `checked`, Continue activé.                       |
| `submitting` | Continue `<Loader2>`.                                      |
| `done`       | Redirection `/admin` (ou `callbackUrl`).                   |

### Sécurité UX

- Les codes sont fournis par `trpc.auth.confirmTwoFactorSetup` (response one-shot). Si l'utilisateur quitte la page sans cliquer Continue, on les perd. C'est volontaire — afficher un dialog de confirmation au beforeunload :

  ```
  window.addEventListener('beforeunload', (e) => {
    if (!confirmed) e.preventDefault();
  });
  ```

- Pas de capture screenshot bloquée (impossible côté web). Mais on peut au moins éviter l'indexation : pas de title spécifique, robots noindex via `<meta>`. Géré dans `head` de la page.

### Clés i18n

```
auth.recovery.title          → « Codes de récupération »
auth.recovery.description    → « Étape 2 sur 2 — conserver ces codes en lieu sûr »
auth.recovery.warning        → « Ne sera plus jamais affiché. À conserver maintenant. »
auth.recovery.copyAll        → « Copier »
auth.recovery.copied         → « Codes copiés »
auth.recovery.download       → « Télécharger »
auth.recovery.confirm        → « J'ai sauvegardé ces codes en lieu sûr »
auth.recovery.continue       → « Continuer »
```

---

## 8. Composant `<TwoFactorBanner>` et page `/admin`

### 8.1 Banner — wireframe

```
┌────────────────────────────────────────────────────────────────────┐
│ ⚠  2FA obligatoire — il vous reste 5 jours.   [Activer maintenant] │
└────────────────────────────────────────────────────────────────────┘
   bg-warning/10  border-b border-warning/30  px-4 py-3
   icône ShieldAlert text-warning  flex items-center gap-3
```

### Variantes

| Variante         | Conditions                        | Style                                                      | CTA                                   |
| ---------------- | --------------------------------- | ---------------------------------------------------------- | ------------------------------------- |
| `urgent-7d-3d`   | `daysLeft >= 3`                   | `bg-warning/10 border-warning/30`                          | « Activer maintenant » → `/2fa/setup` |
| `critical-3d-1d` | `daysLeft < 3 && daysLeft >= 1`   | `bg-warning/15 border-warning/40` + texte plus fort        | idem                                  |
| `last-day`       | `< 24h restant`                   | `bg-destructive/10 border-destructive/30 text-destructive` | « Activer obligatoirement »           |
| (none)           | `daysLeft < 0` ou 2FA déjà active | banner non rendu (le middleware aura déjà bloqué l'accès)  | —                                     |

### Logique countdown

```ts
// session.user.twoFactorRequiredBy: ISO string from server (server=source of truth)
// Calculated server-side at first GLOBAL_ADMIN session creation: createdAt + 7 days

const daysLeft = Math.ceil(
  (new Date(session.user.twoFactorRequiredBy).getTime() - Date.now()) / 86400000,
);

const variant = daysLeft < 1 ? 'last-day' : daysLeft < 3 ? 'critical' : 'urgent';

// Texte conditionnel :
//   daysLeft >= 1 → « il vous reste {daysLeft} jour(s) »
//   daysLeft < 1  → « il vous reste {hoursLeft}h »
```

### Conditions d'affichage (côté serveur — passé au composant via prop)

Le composant **ne calcule pas** la condition « est-ce qu'on doit afficher ? ». Le layout admin (`src/app/admin/layout.tsx`) fait la query `auth.session()` côté server, vérifie `user.role === 'GLOBAL_ADMIN' && user.twoFactorEnrolledAt === null && new Date(user.twoFactorRequiredBy) > new Date()`, et passe le `requiredBy` en prop. Pas de logique d'affichage côté client.

### Structure

```
<TwoFactorBanner requiredBy={requiredBy} />
  → <div role="alert" aria-live="polite" className="sticky top-0 z-40 ...">
      <div className="container mx-auto flex items-center gap-3 ...">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        <p className="flex-1 text-sm">{i18n.text}</p>
        <Button asChild size="sm" variant="default">
          <Link href="/2fa/setup">{i18n.cta}</Link>
        </Button>
      </div>
    </div>
```

### Clés i18n

```
auth.banner.urgent.daysPlural    → « 2FA obligatoire — il vous reste {count} jours. »
auth.banner.urgent.daysSingular  → « 2FA obligatoire — il vous reste {count} jour. »
auth.banner.lastDay.hours        → « 2FA obligatoire — il vous reste {count}h. »
auth.banner.cta                  → « Activer maintenant »
auth.banner.cta.urgent           → « Activer obligatoirement »
```

### 8.2 Page `/admin` — wireframe

```
┌────────────────────────────────────────────────────────────────────┐
│ [Library] BiblioShare                       Phase 1A   [User menu] │  ← AdminHeader (sticky h-14)
├────────────────────────────────────────────────────────────────────┤
│ ⚠  2FA obligatoire — il vous reste 5 jours.   [Activer maintenant] │  ← TwoFactorBanner (conditionnel)
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│   ┌──────────────────────────────────────────────────────┐         │
│   │  ┌──┐  Bienvenue                                     │         │
│   │  │AD│  Phase 1A — auth seulement                     │         │
│   │  └──┘                                                │         │
│   │                                                      │         │
│   │  Les fonctionnalités de gestion des bibliothèques    │         │
│   │  arriveront en Phase 2 (catalogue) et Phase 3        │         │
│   │  (emprunts).                                         │         │
│   │                                                      │         │
│   │  Pour l'instant, vous pouvez :                       │         │
│   │   • activer la 2FA si ce n'est pas fait              │         │
│   │   • vous déconnecter                                 │         │
│   └──────────────────────────────────────────────────────┘         │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
       bg-background, container mx-auto py-8
```

### Composants `/admin`

- `<AdminLayout>` (`src/app/admin/layout.tsx`) :
  - `<AdminHeader>` sticky : wordmark gauche, badge phase au centre, user menu droit.
  - `<TwoFactorBanner>` conditionnel.
  - `<main className="container mx-auto py-8 px-4">{children}</main>`.
- `<AdminHeader>` :
  - Wordmark identique au `<BrandMark>` mais inline (pas centré).
  - Badge `<Badge variant="secondary">Phase 1A</Badge>` (à créer si manquant — voir §9).
  - User menu : `<DropdownMenu>` (à créer si manquant — Radix `@radix-ui/react-dropdown-menu`) avec items « Mon compte » (disabled), « 2FA » (link), « Déconnexion » (Server Action).

- `<AdminPage>` (`src/app/admin/page.tsx`) : Card « Bienvenue » avec icône signature.

### Note Phase 1A

Pour Phase 1A on peut **simplifier** : pas de `<DropdownMenu>` ni de `<Badge>` — un simple bouton « Déconnexion » dans le header suffit, et le badge devient un `<span className="text-xs text-muted-foreground">Phase 1A</span>`. Décision : **simplification adoptée** (Phase 1B introduira le menu utilisateur complet).

### Clés i18n

```
admin.header.phase           → « Phase 1A »
admin.header.signOut         → « Déconnexion »
admin.welcome.title          → « Bienvenue »
admin.welcome.subtitle       → « Phase 1A — auth seulement »
admin.welcome.body           → « Les fonctionnalités de gestion arriveront en Phase 2 (catalogue) et Phase 3 (emprunts). »
admin.welcome.todoTitle      → « Pour l'instant, vous pouvez : »
admin.welcome.todoEnableTfa  → « Activer la 2FA si ce n'est pas fait »
admin.welcome.todoSignOut    → « Vous déconnecter »
```

---

## 9. Composants nouveaux à créer (Task 18)

| Composant                                    | Fichier                              | Pourquoi                                                                                                | Source                                                                          |
| -------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `Alert` (+ `AlertTitle`, `AlertDescription`) | `src/components/ui/alert.tsx`        | Erreurs inline non-toast (form validation, état serveur). Variants `default`, `destructive`, `warning`. | shadcn/ui « alert » canonique, ajouter variant `warning` (HSL var `--warning`). |
| `Label`                                      | `src/components/ui/label.tsx`        | A11y formulaires — cohérence avec `<Input>`.                                                            | shadcn/ui « label » canonique (Radix).                                          |
| `Checkbox`                                   | `src/components/ui/checkbox.tsx`     | Confirmation recovery codes.                                                                            | shadcn/ui « checkbox » canonique (Radix).                                       |
| `OtpInput`                                   | `src/components/auth/OtpInput.tsx`   | Saisie TOTP 6 chiffres. Pas de dépendance externe — implémenter à la main avec 6 `<input>` + refs.      | Custom (~80 lignes). Voir §4 pour le contrat.                                   |
| `Stepper`                                    | `src/components/ui/stepper.tsx`      | Indicateur 1/2 → 2/2 sur le flow setup TOTP. Très simple : 2 `<div>` + 2 `<span>` numérotés.            | Custom (~30 lignes). Pas de Radix.                                              |
| `BrandMark`                                  | `src/components/brand/BrandMark.tsx` | Wordmark + icône `Library` réutilisable (auth layout, admin header).                                    | Custom (~20 lignes).                                                            |

### Notes d'implémentation Alert

```tsx
// src/components/ui/alert.tsx — variants étendus avec "warning"
const alertVariants = cva(
  'relative w-full rounded-md border px-4 py-3 text-sm [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg+div]:translate-y-[-3px] [&:has(svg)]:pl-11',
  {
    variants: {
      variant: {
        default: 'bg-background text-foreground',
        destructive:
          'border-destructive/30 bg-destructive/10 text-destructive [&>svg]:text-destructive',
        warning: 'border-warning/30 bg-warning/10 text-foreground [&>svg]:text-warning',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);
```

### Notes d'implémentation OtpInput

Contrat externe :

```ts
interface OtpInputProps {
  length: number; // 6 pour TOTP
  value: string; // controlled
  onChange: (next: string) => void;
  onComplete?: (code: string) => void; // appelé quand length atteinte
  disabled?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
}
```

Implémentation :

- `useRef<(HTMLInputElement | null)[]>([])` × length.
- Pour chaque cellule : `<input value={value[i] ?? ''} onChange={...} onKeyDown={...} onPaste={...} />`.
- `onPaste` : capture la string, slice à `length`, distribue, focus dernière cellule, appelle `onComplete` si rempli.
- `onKeyDown Backspace` : si cellule vide, focus cellule précédente.
- Style cellule : `h-12 w-10 rounded-md border border-input bg-transparent text-center font-mono text-lg shadow-sm focus-visible:ring-1 focus-visible:ring-ring`.
- Container : `flex justify-center gap-2`.

### Notes d'implémentation Stepper

```tsx
interface StepperProps {
  currentStep: number; // 1-indexed
  totalSteps: number;
  className?: string;
}

// Render :
// <div className="flex items-center gap-2 text-xs text-muted-foreground">
//   <span>{currentStep} / {totalSteps}</span>
//   <div className="flex gap-1">
//     {Array.from({length: totalSteps}).map((_, i) => (
//       <span
//         key={i}
//         className={cn(
//           'h-1 w-8 rounded-full transition-colors',
//           i < currentStep ? 'bg-accent' : 'bg-border'
//         )}
//       />
//     ))}
//   </div>
// </div>
```

### Notes d'implémentation BrandMark

```tsx
interface BrandMarkProps {
  className?: string;
  showWordmark?: boolean; // default true
  size?: 'sm' | 'md'; // default 'md'
}

// Render :
// <div className={cn('flex items-center gap-2', className)}>
//   <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent/10">
//     <Library className="h-4 w-4 text-accent" aria-hidden="true" />
//   </div>
//   {showWordmark && (
//     <span className="text-base font-semibold tracking-tight">BiblioShare</span>
//   )}
// </div>
```

---

## 10. Cohérence design system — récapitulatif

### Réutilisé sans modification

- Tokens HSL (palette, radius, ring) — aucun ajout.
- Composants existants : `Button`, `Input`, `Card`/`CardHeader`/etc., `Toast`, `Toaster`.
- Animations `animate-slide-up`, `animate-fade-in`.
- Police : Geist Sans + Mono déjà chargées via `src/app/fonts/`.
- Pattern signature « icône carrée bg-accent/10 + titre + description » — repris sur les 5 écrans auth + page admin (exact même classes que `src/app/page.tsx`).

### Étendu (ajouts cohérents avec le système)

- `Alert` — pattern shadcn canonique, ajout d'un variant `warning` qui reuse le token `--warning` déjà défini dans `globals.css` (donc rien de nouveau côté tokens).
- `Label`, `Checkbox` — composants shadcn canoniques, copiés tel quel depuis la doc shadcn (Radix primitives, classes alignées avec `<Input>` et `<Button>`).
- `OtpInput` — composant custom mais **classes Tailwind qui matchent `<Input>`** : même bordure, même focus ring, même radius. Visuellement c'est « un Input segmenté », pas un nouveau langage visuel.
- `Stepper` — utilise `bg-accent` et `bg-border` exclusivement, aucune couleur custom. Très minimal.
- `BrandMark` — encapsule le pattern icône-carrée déjà utilisé sur la home en composant réutilisable (DRY).

### Décisions de simplification Phase 1A

- Pas de `<DropdownMenu>` admin → un simple bouton « Déconnexion » suffit.
- Pas de `<Badge>` → `<span text-xs text-muted-foreground>` pour la mention « Phase 1A ».
- Pas de toast pour les erreurs de form → Alert inline (plus accessible et cohérent avec les patterns auth de Linear/Vercel).
- Pas de skeleton sur les écrans auth → formulaires courts, le `<Loader2>` sur le bouton suffit. Le `/2fa/setup` est l'exception (skeleton sur le bloc QR pendant le fetch initial).

### Ce que Task 18 doit livrer (rappel — pas dans ce spec)

- Implémenter les 6 composants nouveaux (§9).
- Implémenter les 7 écrans (5 auth + admin layout + admin page).
- Câbler `signIn`/`trpc.auth.*` selon les contrats Server Action / tRPC déjà construits en Tasks 11-13.
- Toutes les chaînes via `useTranslations('auth.*')` / `useTranslations('admin.*')` — Task 19 ajoutera les clés au `messages/fr.json`.
- E2E tests Playwright en Task 21 valident les 5 scénarios sur ces écrans.

---

## 11. Hors scope ce spec

- Pas de page `/forgot-password` / `/reset-password` (Phase 1B).
- Pas de page `/invite/:token` (Phase 1B).
- Pas de gestion 2FA dans `/admin/account` (Phase 1B — disable, regenerate codes, etc.).
- Pas de dark-mode toggle UI (la classe `.dark` est branchée, mais aucun toggle utilisateur n'est ajouté en Phase 1A — peut venir en Phase 1B ou plus tard).
- Pas de support webauthn / passkey (Phase 2+).
