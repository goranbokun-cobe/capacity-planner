import type { Metadata } from "next";
import { Sidebar } from "@/components/Sidebar";
import { AuthProvider } from "@/components/AuthProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "COBE Capacity Planner",
  description: "Weekly capacity planning for COBE digital agency",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex h-screen overflow-hidden bg-gray-50 text-gray-900 antialiased">
        <AuthProvider>
          <Sidebar />
          <main className="flex-1 overflow-y-auto">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
