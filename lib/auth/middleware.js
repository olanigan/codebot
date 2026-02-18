import NextAuth from 'next-auth';
import { authConfig } from './edge-config.js';
import { NextResponse } from 'next/server';

const { auth } = NextAuth(authConfig);

export const middleware = auth((req) => {
  const { pathname } = req.nextUrl;

  // API routes use their own centralized auth (checkAuth in api/index.js)
  if (pathname.startsWith('/api')) return;

  // Static assets from public/ — skip auth for common file extensions
  if (/\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?|ttf|eot|mp4|webm)$/i.test(pathname)) {
    return;
  }

  // /login is the only unprotected page (login + first-user setup)
  if (pathname === '/login') {
    if (req.auth) return NextResponse.redirect(new URL('/', req.url));
    return;
  }

  // Everything else requires auth
  if (!req.auth) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
});

export const config = {
  // Exclude all _next internal paths (static chunks, HMR, images, Turbopack dev assets)
  matcher: ['/((?!_next|favicon.ico).*)'],
};
