# Guide de déploiement Coolify

Cible : VPS OVH Debian 13 (8 Go RAM, 4 vCPU, 80 Go), domaine personnel, HTTPS Let's Encrypt.

## 1. Pré-requis sur le VPS

```bash
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
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh
```

## 2. Installer Coolify

Voir https://coolify.io/docs/installation pour la commande à jour. À la date du design :

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

L'installateur déploie Coolify dans `/data/coolify`. Suivre les instructions à la fin pour récupérer le mot de passe admin.

Coolify écoute par défaut sur `http://<vps-ip>:8000` — créer un domaine `coolify.<votre-domaine>` pointant vers le VPS et configurer Coolify pour utiliser ce domaine en HTTPS.

## 3. Configurer DNS

Sur votre registrar :

| Sous-domaine         | Type | Cible     |
| -------------------- | ---- | --------- |
| `@` ou `biblioshare` | A    | IP du VPS |
| `coolify`            | A    | IP du VPS |

## 4. Connecter le repo GitHub

1. Dans Coolify : **Sources** → **+ Add** → choisir GitHub.
2. Suivre l'OAuth et autoriser l'accès au repo `biblioshare`.

## 5. Créer le projet Coolify

1. **Projects** → **+ New** → nom : `biblioshare`.
2. **+ New Resource** → **Docker Compose** → choisir le repo `biblioshare`.
3. Branche : `main`. Path du compose : `docker-compose.yml`.

## 6. Variables d'environnement

Dans **Configuration → Environment Variables** de la ressource, ajouter :

| Clé                 | Valeur                              |
| ------------------- | ----------------------------------- |
| `APP_URL`           | https://biblioshare.<votre-domaine> |
| `POSTGRES_PASSWORD` | (générer : `openssl rand -hex 24`)  |
| `MEILI_MASTER_KEY`  | (générer : `openssl rand -hex 24`)  |
| `SESSION_SECRET`    | (générer : `openssl rand -hex 32`)  |
| `CRYPTO_MASTER_KEY` | (générer : `openssl rand -hex 32`)  |
| `EMAIL_FROM`        | noreply@<votre-domaine>             |
| `RESEND_API_KEY`    | (Phase 1+, depuis dashboard Resend) |
| `LOG_LEVEL`         | info                                |
| `MEILI_ENV`         | production                          |
| `APP_PORT`          | 3000                                |

> **Contraintes runtime** : `SESSION_SECRET` et `CRYPTO_MASTER_KEY` exigent min 32 chars, `MEILI_MASTER_KEY` min 16 chars (validés par `src/lib/env.ts`). `openssl rand -hex N` produit `2*N` chars hex, donc `-hex 32` = 64 chars conformes.

**IMPORTANT** : marquer toutes ces variables comme **secret** dans Coolify (icône cadenas). Ne jamais les committer.

## 7. Configurer le domaine et HTTPS

Dans **Configuration → Domains** :

- Service : `app`
- Port : 3000
- Domain : `biblioshare.<votre-domaine>`
- HTTPS : activé (Let's Encrypt automatique)

## 8. Premier déploiement

1. **Deploy** dans l'UI Coolify.
2. Suivre les logs.
3. Une fois `app` healthy, lancer la migration Prisma initiale depuis le VPS :
   ```bash
   ssh root@<vps-ip>
   docker exec -it $(docker ps --filter name=biblioshare-app -q) pnpm prisma:migrate:deploy
   ```

> **Note EROFS** : si la commande échoue avec `read-only filesystem`, c'est attendu — le container `app` est `read_only: true` (cf. `docker-compose.yml`). Workaround : exécuter la migration depuis l'hôte en se connectant directement à la DB (`DATABASE_URL=postgresql://biblioshare:<password>@127.0.0.1:5432/biblioshare pnpm prisma:migrate:deploy`), ce qui exige d'exposer temporairement le port 5432 du service `pg` ou de tunneler via SSH (`ssh -L 5432:localhost:5432 root@<vps-ip>`).

## 9. Vérification

```bash
curl -sI https://biblioshare.<votre-domaine>
curl -s https://biblioshare.<votre-domaine>/api/health | jq
```

Expected : `200 OK`, headers de sécurité présents (HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy), `/api/health` répond `status: ok`.

## 10. Supervision

- Logs Coolify : UI **Logs** par service.
- Logs container direct : `docker compose logs -f app` sur le VPS.
- (Optionnel Phase 8) UptimeKuma sur `uptime.<votre-domaine>` pointant vers `/api/health`.

## 11. Mises à jour

Coolify peut auto-déployer sur push `main` (configurer le webhook GitHub dans Coolify). Sinon, **Redeploy** manuel.

## Troubleshooting

### `app` ne devient pas healthy

- Vérifier que toutes les variables d'env requises sont définies (cf. `src/lib/env.ts`).
- Vérifier que la migration Prisma a tourné : `docker exec ... pnpm prisma migrate status`.
- Inspecter les logs : `docker compose logs app`.

### ClamAV met longtemps à démarrer

Normal au premier boot (téléchargement ~250 Mo de définitions virales). Compter ~3 min. Le healthcheck a un `start_period: 120s` pour ce cas.

### Mémoire insuffisante

`docker stats` pour voir la conso. Si `pg` ou `meili` consomment trop, ajuster `shared_buffers` (Postgres) ou la taille des index (Meili) en Phase 8.
