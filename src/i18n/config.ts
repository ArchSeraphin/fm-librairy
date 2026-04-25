import { getRequestConfig } from 'next-intl/server';

export default getRequestConfig(async () => ({
  locale: 'fr',
  messages: (await import('./messages/fr.json')).default,
}));
