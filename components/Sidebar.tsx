"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import {
  LayoutDashboard,
  FolderKanban,
  Users,
  Building2,
  GitBranch,
  Camera,
  Settings,
  RefreshCw,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/",          label: "Overview",   icon: LayoutDashboard },
  { href: "/projects",  label: "Projects",   icon: FolderKanban },
  { href: "/teams",     label: "Teams",      icon: Building2 },
  { href: "/people",    label: "People",     icon: Users },
  { href: "/whatif",    label: "What-if",    icon: GitBranch },
  { href: "/snapshots", label: "Snapshots",  icon: Camera },
  { href: "/settings",  label: "Settings",   icon: Settings },
  { href: "/sync",      label: "Sync",       icon: RefreshCw },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();

  return (
    <aside className="flex h-screen w-52 flex-col border-r border-gray-200 bg-white">
      <div className="flex h-14 items-center border-b border-gray-200 px-4">
        <span className="text-sm font-bold tracking-tight text-gray-900">
          COBE Capacity
        </span>
      </div>
      <nav className="flex-1 overflow-y-auto p-2">
        <ul className="space-y-0.5">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/"
              ? pathname === "/"
              : pathname.startsWith(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-blue-50 text-blue-700"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  )}
                >
                  <Icon size={16} />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* User section */}
      <div className="border-t border-gray-200 p-3">
        {session?.user ? (
          <div className="flex items-center gap-2">
            {session.user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={session.user.image}
                alt={session.user.name ?? ""}
                className="h-7 w-7 rounded-full"
              />
            ) : (
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">
                {session.user.name?.[0]?.toUpperCase() ?? "?"}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-gray-800">
                {session.user.name}
              </div>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              title="Sign out"
              className="shrink-0 rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            >
              <LogOut size={14} />
            </button>
          </div>
        ) : (
          <span className="text-xs text-gray-400">v0.1.0 · local mode</span>
        )}
      </div>
    </aside>
  );
}
