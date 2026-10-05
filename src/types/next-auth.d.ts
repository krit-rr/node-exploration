import "next-auth";

declare module "next-auth" {
  interface Session {
    provider?: string;
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
    provider?: string;
  }
}
