import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

const ALLOWED_DOMAIN = "cobeisfresh.com";

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    /** Only allow @cobeisfresh.com accounts through. */
    async signIn({ user }) {
      return user.email?.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`) ?? false;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  secret: process.env.NEXTAUTH_SECRET,
};
