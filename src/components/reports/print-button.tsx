"use client";

import { Printer } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Print or save the current page.
 *
 * §16 asks for a clean print-friendly view and explicitly not for PDF generation:
 * *"Do NOT implement PDF generation. Do NOT add PDF dependencies."* So there is no
 * renderer here, no library, and no document built in JavaScript — the browser's
 * own print dialog is the mechanism, and what it prints is the page.
 *
 * That is not a shortcut. A report on this page is already a plain document of
 * headings, paragraphs, quotes and links; the print stylesheet removes the
 * navigation and the controls around it and leaves the document. Anything
 * generated separately could disagree with what a reader saw on screen, and the
 * one thing a printable report must not do is differ from the one that was read.
 *
 * The button marks itself `data-print="hide"`, so the control that opens the
 * dialog is not in the dialog's output.
 */
export function PrintButton() {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      data-print="hide"
      onClick={() => {
        window.print();
      }}
    >
      <Printer aria-hidden className="size-4" />
      Print or save as PDF
    </Button>
  );
}
