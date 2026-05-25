export { default } from "next-auth/middleware";

/**
 * Protect every route except:
 *  - /login (sign-in page)
 *  - /api/auth/* (NextAuth callbacks)
 *  - Next.js internals (_next/*)
 *  - Favicon
 */
export const config = {
  matcher: [
    "/((?!login|api/auth|_next/static|_next/image|favicon\\.ico).*)",
  ],
};
