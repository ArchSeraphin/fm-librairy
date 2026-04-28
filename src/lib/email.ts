import nodemailer, { type Transporter } from 'nodemailer';
import { Resend } from 'resend';
import { render } from '@react-email/render';
import React from 'react';
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

export async function renderEmail<P extends Record<string, unknown>>(
  Component: React.ComponentType<P>,
  props: P,
): Promise<{ html: string; text: string }> {
  const element = React.createElement(Component, props);
  const html = await render(element, { pretty: false });
  const text = await render(element, { plainText: true });
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
