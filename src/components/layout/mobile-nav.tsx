"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { NAV_ITEMS, isNavItemActive } from "@/lib/navigation";
import { cn } from "@/lib/utils";

/**
 * Mobile primary navigation.
 *
 * A disclosure panel rather than a drawer: fewer moving parts, no focus trap to
 * get wrong, and it degrades to plain links. Shown below `lg`, where the
 * sidebar is hidden.
 */
export function MobileNav() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  // Close on navigation, so the panel does not sit over the page the user just
  // moved to.
  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  // Escape closes it — expected of anything that overlays content.
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  return (
    <div className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur lg:hidden">
      <div className="flex h-14 items-center justify-between gap-4 px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm font-semibold tracking-[0.2em]"
        >
          <span aria-hidden className="text-muted-foreground">
            ◇
          </span>
          ORION
        </Link>

        <button
          type="button"
          onClick={() => setIsOpen((open) => !open)}
          aria-expanded={isOpen}
          aria-controls="mobile-nav-panel"
          aria-label={isOpen ? "Close navigation" : "Open navigation"}
          className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {isOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      <div
        id="mobile-nav-panel"
        hidden={!isOpen}
        className="border-t border-border px-4 pb-4 sm:px-6"
      >
        <nav aria-label="Primary">
          <ul className="space-y-1 py-2">
            {NAV_ITEMS.map((item) => {
              const isActive = isNavItemActive(item.href, pathname);
              const Icon = item.icon;

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex items-start gap-3 rounded-md px-3 py-2.5 transition-colors",
                      isActive
                        ? "bg-secondary text-secondary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    <Icon className="mt-0.5 size-4 shrink-0" />

                    <span className="space-y-0.5">
                      <span
                        className={cn(
                          "block text-sm",
                          isActive && "font-medium",
                        )}
                      >
                        {item.label}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );
}
