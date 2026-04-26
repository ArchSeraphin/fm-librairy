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
