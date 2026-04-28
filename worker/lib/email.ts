// Worker-local email transport. Mirrors src/lib/email.ts but reads
// process.env directly (validated upstream in worker/index.ts) and
// skips logger DI (jobs pass their own pino logger when they care).
//
// FR-only Phase 1B; same i18n deferral as src/emails/*.

import nodemailer, { type Transporter } from 'nodemailer';
import { Resend } from 'resend';
import { render } from '@react-email/render';
import * as React from 'react';
import { createHash } from 'node:crypto';

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
  const transport = process.env.EMAIL_TRANSPORT;
  const from = process.env.EMAIL_FROM!;
  if (transport === 'resend') {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) throw new Error('RESEND_API_KEY missing');
    cachedTransport = buildResendTransport(apiKey, from);
  } else {
    const host = process.env.SMTP_HOST;
    if (!host) throw new Error('SMTP_HOST missing');
    cachedTransport = buildSmtpTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 1025),
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      from,
    });
  }
  return cachedTransport;
}

export async function renderEmail<P extends Record<string, unknown>>(
  Component: React.ComponentType<P>,
  props: P,
): Promise<{ html: string; text: string }> {
  const element = React.createElement(Component, props);
  const html = await render(element, { pretty: false });
  const text = await render(element, { plainText: true });
  return { html, text };
}

/**
 * Salted SHA-256 hash of recipient email, truncated to 32 hex chars (128 bits).
 * Intent: log correlation only — NOT authentication. EMAIL_LOG_SALT must remain
 * stable across logs to be useful (rotating it breaks history).
 */
export function hashRecipient(email: string): string {
  const salt = process.env.EMAIL_LOG_SALT!;
  return createHash('sha256').update(`${salt}:${email.toLowerCase()}`).digest('hex').slice(0, 32);
}

export async function sendEmail(msg: EmailMessage): Promise<{ id: string }> {
  const tx = getTransport();
  return tx.send(msg);
}
