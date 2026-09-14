"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV_ITEMS, isNavItemActive } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/**
 * Desktop primary navigation.
 *
 * Hidden below `lg`, where `MobileNav` takes over. Both render `NAV_ITEMS`, so
 * the two never disagree about what sections exist.
 */
export function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-svh w-64 shrink-0 flex-col border-r border-border lg:flex">
      <div className="flex h-14 items-center px-5">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-semibold tracking-[0.2em]"
        >
          <span aria-hidden className="text-muted-foreground">
            ◇
          </span>
          ORION
        </Link>
      </div>

      <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3 py-2">
        <ul className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = isNavItemActive(item.href, pathname);
            const Icon = item.icon;

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-secondary font-medium text-secondary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-border px-5 py-4">
        <p className="text-xs text-muted-foreground">
          Phase 2 — application shell. The agent engine is not implemented yet.
        </p>
      </div>
    </aside>
  );
}
