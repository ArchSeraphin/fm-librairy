import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { db } from '../src/lib/db';
import { hashPassword } from '../src/lib/password';
import { recordAudit } from '../src/lib/audit-log';

export interface BootstrapInput {
  email: string;
  password?: string;
  displayName?: string;
  force?: boolean;
}

export interface BootstrapOutput {
  created: boolean;
  promoted: boolean;
  passwordGenerated: string | null;
}

export async function runBootstrap(input: BootstrapInput): Promise<BootstrapOutput> {
  const existing = await db.user.findFirst({ where: { role: 'GLOBAL_ADMIN' } });

  if (existing && !input.force) {
    throw new Error(
      `Un Admin global existe déjà (${existing.email}). Utilisez --force pour promouvoir un user existant.`,
    );
  }

  if (input.force) {
    const target = await db.user.findUnique({ where: { email: input.email } });
    if (!target) {
      throw new Error(`Aucun user avec l'email ${input.email}.`);
    }
    if (target.role === 'GLOBAL_ADMIN') {
      return { created: false, promoted: false, passwordGenerated: null };
    }
    await db.user.update({ where: { id: target.id }, data: { role: 'GLOBAL_ADMIN' } });
    await recordAudit({
      action: 'admin.user.role_changed',
      target: { type: 'USER', id: target.id },
      metadata: { from: target.role, to: 'GLOBAL_ADMIN', source: 'bootstrap_force' },
    });
    return { created: false, promoted: true, passwordGenerated: null };
  }

  const passwordGenerated = input.password ? null : randomBytes(18).toString('base64');
  const password = input.password ?? passwordGenerated!;

  await db.user.create({
    data: {
      email: input.email,
      displayName: input.displayName ?? 'Admin',
      passwordHash: await hashPassword(password),
      role: 'GLOBAL_ADMIN',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });

  return { created: true, promoted: false, passwordGenerated };
}

async function main(): Promise<void> {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  if (!email) {
    console.error('BOOTSTRAP_ADMIN_EMAIL requis');
    process.exit(1);
  }
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  const displayName = process.env.BOOTSTRAP_ADMIN_NAME;
  const force = process.argv.includes('--force');

  try {
    const out = await runBootstrap({ email, password, displayName, force });
    console.log('═══════════════════════════════════════════════');
    if (out.created) {
      console.log('  Compte Admin global créé');
      console.log(`  Email      : ${email}`);
      if (out.passwordGenerated) {
        console.log(`  Password   : ${out.passwordGenerated}`);
        console.log('  À COPIER MAINTENANT — ne sera plus affiché.');
      }
      const deadline = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
      console.log(`  2FA        : à activer obligatoirement avant ${deadline}`);
    } else if (out.promoted) {
      console.log(`  User ${email} promu GLOBAL_ADMIN`);
    } else {
      console.log(`  User ${email} était déjà GLOBAL_ADMIN — aucun changement`);
    }
    console.log('═══════════════════════════════════════════════');
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) void main();
