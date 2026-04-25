# ADR 0001 — Choix de la stack technique

**Date** : 2026-04-25
**Statut** : Accepté
**Décideurs** : Nicolas (avec assistance IA)

## Contexte

Le projet BiblioShare doit être maintenable long terme par un dev solo travaillant avec assistance IA. Il inclut une liseuse en ligne (epub.js, pdf.js — JavaScript par nature), des uploads de fichiers à scanner, une recherche full-text, et une UI accessible pour un public 20-80 ans.

Trois critères dominants : sécurité, facilité de maintenance par une IA de code, performance sur VPS modeste (8 Go RAM / 4 vCPU).

## Décision

**Next.js 15 (App Router) + TypeScript strict + Prisma 6 + PostgreSQL 16 + Meilisearch + Redis/BullMQ.**

UI : Tailwind 4 + shadcn/ui + Radix primitives + Lucide icons.

Stack fullstack en un seul langage (TypeScript) end-to-end, types partagés via Prisma, corpus d'entraînement IA massif sur Next.js + Prisma + Tailwind.

## Alternatives considérées

- **SvelteKit + Drizzle** : code plus court mais corpus IA 5-10x plus petit que Next.js → plus de risque d'hallucinations.
- **Django + DRF + JS pour la liseuse** : deux langages à maintenir, pas de types partagés, plus de boilerplate API.

## Conséquences

**Positives** :
- Un seul langage end-to-end → moins de context switching pour l'IA, types catch les erreurs avant commit.
- Écosystème epub.js/pdf.js natif.
- shadcn/ui = composants accessibles WCAG copiés dans le repo, modifiables.
- Corpus IA massif → propositions IA cohérentes.

**Négatives / risques** :
- Next.js bouge vite (App Router, Server Components évoluent). Mitigation : pin de version, évitement features expérimentales, politique de mise à jour annuelle documentée.
- App Router plus complexe que Pages Router (Server vs Client Components). Mitigation : conventions strictes documentées dans `CLAUDE.md` projet.

**Réversibilité** : changer de framework est lourd. La couche métier (services, helpers, schéma DB) reste portable en TypeScript pur — on peut migrer vers Remix/TanStack Start si Next.js devient problématique.
