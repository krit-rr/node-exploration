import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import AzureADProvider from "next-auth/providers/azure-ad";
import { JWT } from "next-auth/jwt";
import { DefaultSession } from "next-auth";
import { SessionStrategy } from "next-auth";

interface CustomSession extends DefaultSession {
  provider?: string;
  error?: 'RefreshTokenError';
}

interface CustomToken extends JWT {
  accessToken?: string;
  provider?: string;
}

/**
 * Exchange a refresh token for a fresh access token. Both providers mint
 * access tokens that die after ~1 hour while the session lasts 30 days;
 * without rotation every mailbox call starts failing an hour after sign-in.
 */
async function refreshAccessToken(
  provider: string,
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: number; refreshToken?: string }> {
  const isGoogle = provider === 'google';
  const url = isGoogle
    ? 'https://oauth2.googleapis.com/token'
    : 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

  const body = new URLSearchParams({
    client_id: (isGoogle ? googleClientId : microsoftClientId) ?? '',
    client_secret: (isGoogle ? googleClientSecret : microsoftClientSecret) ?? '',
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    ...(isGoogle
      ? {}
      : { scope: 'openid profile email offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Read' }),
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Token refresh failed: ${data.error ?? response.status}`);
  }
  return {
    accessToken: data.access_token,
    expiresAt: Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600),
    // Providers may rotate the refresh token; keep the old one otherwise.
    refreshToken: data.refresh_token,
  };
}

// Check and log essential environment variables
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const microsoftClientId = process.env.MICROSOFT_CLIENT_ID;
const microsoftClientSecret = process.env.MICROSOFT_CLIENT_SECRET;
const nextAuthSecret = process.env.NEXTAUTH_SECRET;

// Ensure the credentials exist
if (!googleClientId || !googleClientSecret) {
  console.error("Missing Google OAuth credentials. Please check your .env.local file.");
}

if (!microsoftClientId || !microsoftClientSecret) {
  console.error("Missing Microsoft Entra ID credentials. Please check your .env.local file.");
}

export const authOptions: NextAuthOptions = {
  secret: nextAuthSecret,
  session: {
    strategy: "jwt" as SessionStrategy,
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  jwt: {
    secret: process.env.NEXTAUTH_SECRET,
  },
  providers: [
    GoogleProvider({
      clientId: googleClientId || "",
      clientSecret: googleClientSecret || "",
      authorization: {
        params: {
          prompt: "consent",
          access_type: "offline",
          response_type: "code",
          scope: "openid email profile https://www.googleapis.com/auth/gmail.readonly"
        },
      },
    }),
    AzureADProvider({
      id: "microsoft-entra-id",
      clientId: microsoftClientId || "",
      clientSecret: microsoftClientSecret || "",
      tenantId: "common", // Use 'common' for multi-tenant support
      authorization: {
        params: {
          scope: "openid profile email offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Read",
          response_type: "code",
          prompt: "consent"
        }
      },
      client: {
        token_endpoint_auth_method: "client_secret_post"
      },
      checks: ["pkce", "state"],
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name,
          email: profile.email,
          image: null,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }: { token: JWT; account: any }) {
      // Initial sign-in: capture the full token set, including the refresh
      // token and expiry both providers already issue (offline access).
      if (account) {
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token ?? token.refreshToken,
          expiresAt: account.expires_at,
          provider: account.provider,
          error: undefined,
        };
      }

      // Access token still valid (with 60s clock skew): nothing to do.
      if (!token.expiresAt || Date.now() < token.expiresAt * 1000 - 60_000) {
        return token;
      }

      if (!token.refreshToken) {
        return { ...token, error: 'RefreshTokenError' as const };
      }

      try {
        const refreshed = await refreshAccessToken(token.provider ?? '', token.refreshToken);
        return {
          ...token,
          accessToken: refreshed.accessToken,
          expiresAt: refreshed.expiresAt,
          refreshToken: refreshed.refreshToken ?? token.refreshToken,
          error: undefined,
        };
      } catch (error) {
        console.error('Access token refresh failed:', error);
        return { ...token, error: 'RefreshTokenError' as const };
      }
    },
    async session({ session, token }: { session: CustomSession, token: CustomToken }) {
      // The provider access token deliberately stays in the httpOnly JWT
      // cookie: exposing it here would hand a Gmail/Graph bearer token to any
      // script running in the page. Server code reads it via getToken().
      session.provider = token.provider;
      session.error = token.error;
      return session;
    },
    async redirect({ url, baseUrl }: { url: string, baseUrl: string }) {
      // Compare origins, not string prefixes: "https://app.example.com.evil.com"
      // passes a startsWith check against "https://app.example.com".
      try {
        if (new URL(url, baseUrl).origin === new URL(baseUrl).origin) {
          return new URL(url, baseUrl).toString();
        }
      } catch {}
      return `${baseUrl}/contacts`;
    },
  },
  pages: {
    signIn: '/auth',
    error: '/auth/error',
  },
  debug: process.env.AUTH_DEBUG === "true",
};
