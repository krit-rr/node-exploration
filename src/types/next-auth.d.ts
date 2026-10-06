import "next-auth";

declare module "next-auth" {
  interface Session {
    provider?: string;
    error?: "RefreshTokenError";
    user: {
      id?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    /** Unix seconds when accessToken expires. */
    expiresAt?: number;
    provider?: string;
    error?: "RefreshTokenError";
  }
}
