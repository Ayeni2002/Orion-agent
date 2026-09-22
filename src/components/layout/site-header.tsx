"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { isNavItemActive } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/**
 * The links worth surfacing on the public page.
 *
 * Named to avoid colliding with `NAV_ITEMS` in `src/lib/navigation.ts` — that
 * is the full application navigation, this is a subset shown to visitors.
 *
 * `Docs` is here rather than only in the application sidebar because a visitor
 * who has not entered the application yet is exactly the reader the page is
 * for: it states what is and is not built, which is the question someone
 * deciding whether to look further actually has.
 */
const PUBLIC_NAV_ITEMS = [
  { href: "/overview", label: "Overview" },
  { href: "/workspace", label: "Workspace" },
  { href: "/docs", label: "Docs" },
] as const;

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header
      data-print="hide"
      className="sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur"
    >
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-semibold tracking-[0.2em]"
        >
          <span aria-hidden className="text-muted-foreground">
            ◇
          </span>
          ORION
        </Link>

        <nav aria-label="Main" className="flex items-center gap-1">
          {PUBLIC_NAV_ITEMS.map((item) => {
            const isActive = isNavItemActive(item.href, pathname);

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
