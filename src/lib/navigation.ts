import {
  BookOpen,
  FileText,
  Folder,
  LayoutDashboard,
  Search,
  Settings,
  Sparkles,
} from "lucide-react";
import type { ComponentType } from "react";

/**
 * The application's primary navigation.
 *
 * Declared once so the desktop sidebar and the mobile navigation cannot drift
 * apart: both render this list and differ only in how they present it. Adding
 * a section is a change to this file, not to two components.
 *
 * `icon` is typed structurally rather than with the icon library's own exported
 * type, so replacing that library later is a change here and nowhere else.
 */
export interface NavItem {
  href: string;
  label: string;
  /** Shown only where there is room for it — currently the mobile menu. */
  description: string;
  icon: ComponentType<{ className?: string }>;
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    href: "/overview",
    label: "Overview",
    description: "Your research at a glance",
    icon: LayoutDashboard,
  },
  {
    href: "/workspace",
    label: "Workspace",
    description: "Give Orion an objective",
    icon: Sparkles,
  },
  {
    href: "/projects",
    label: "Projects",
    description: "Organise research into projects",
    icon: Folder,
  },
  {
    href: "/research",
    label: "Research",
    description: "Findings gathered by Orion",
    icon: Search,
  },
  {
    href: "/reports",
    label: "Reports",
    description: "Structured results you can read",
    icon: FileText,
  },
  {
    href: "/docs",
    label: "Docs",
    description: "What Orion is and how it is built",
    icon: BookOpen,
  },
  {
    href: "/settings",
    label: "Settings",
    description: "Account, preferences and AI",
    icon: Settings,
  },
];

/**
 * Whether a nav item should render as the current page.
 *
 * Uses a segment-boundary check rather than a bare `startsWith`, so `/research`
 * does not match `/reports` — a prefix collision that would otherwise highlight
 * the wrong item as sections are added.
 */
export function isNavItemActive(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
