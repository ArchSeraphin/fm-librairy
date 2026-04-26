import NextAuth from 'next-auth';
import { authConfig } from './config';

const result = NextAuth(authConfig);
export const { auth, signIn, signOut, handlers } = result;
export const { GET, POST } = result.handlers;
