"use client";

import { motion, useSpring, useTransform, type SpringOptions } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

interface SpotlightProps {
  className?: string;
  size?: number;
  springOptions?: SpringOptions;
  /**
   * Colour at the centre of the spotlight. Omit to keep the default zinc
   * gradient.
   *
   * This prop is additive. The version of this component that ships on
   * 21st.dev takes `fill`, but the copy this project started from had dropped
   * it while the call site still passed `fill="white"` — which is a type error,
   * not a silently-ignored prop. Adding it here keeps the component's published
   * API rather than editing the caller to match a missing one.
   */
  fill?: string;
}

export function Spotlight({
  className,
  size = 200,
  springOptions = { bounce: 0 },
  fill,
}: SpotlightProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [parentElement, setParentElement] = useState<HTMLElement | null>(null);

  const mouseX = useSpring(0, springOptions);
  const mouseY = useSpring(0, springOptions);

  const spotlightLeft = useTransform(mouseX, (x) => `${x - size / 2}px`);
  const spotlightTop = useTransform(mouseY, (y) => `${y - size / 2}px`);

  useEffect(() => {
    const parent = containerRef.current?.parentElement;

    if (!parent) {
      return;
    }

    // The spotlight is positioned against its parent and tracks the pointer
    // across it, so the parent has to be a positioning context that clips.
    parent.style.position = "relative";
    parent.style.overflow = "hidden";
    setParentElement(parent);
  }, []);

  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      if (!parentElement) {
        return;
      }

      const { left, top } = parentElement.getBoundingClientRect();

      mouseX.set(event.clientX - left);
      mouseY.set(event.clientY - top);
    },
    [mouseX, mouseY, parentElement],
  );

  const handleMouseEnter = useCallback(() => setIsHovered(true), []);
  const handleMouseLeave = useCallback(() => setIsHovered(false), []);

  useEffect(() => {
    if (!parentElement) {
      return;
    }

    parentElement.addEventListener("mousemove", handleMouseMove);
    parentElement.addEventListener("mouseenter", handleMouseEnter);
    parentElement.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      // The three listeners above are removed by *identity*. The original
      // implementation registered `() => setIsHovered(true)` inline and then
      // tried to remove a freshly-written `() => setIsHovered(false)` — a
      // different function object — so `removeEventListener` never matched and
      // every mount leaked a mousemove, a mouseenter and a mouseleave handler
      // on the parent. The `useCallback`s are what make the references stable
      // enough for the removal to actually work.
      parentElement.removeEventListener("mousemove", handleMouseMove);
      parentElement.removeEventListener("mouseenter", handleMouseEnter);
      parentElement.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [parentElement, handleMouseMove, handleMouseEnter, handleMouseLeave]);

  return (
    <motion.div
      ref={containerRef}
      className={cn(
        "pointer-events-none absolute rounded-full blur-xl transition-opacity duration-200",
        // With an explicit `fill` the gradient comes from inline styles below,
        // so the Tailwind gradient (and the `--tw-gradient-stops` it needs) is
        // left off rather than emitted as a broken half of a pair.
        fill === undefined
          ? "bg-[radial-gradient(circle_at_center,var(--tw-gradient-stops),transparent_80%)] from-zinc-50 via-zinc-100 to-zinc-200"
          : undefined,
        isHovered ? "opacity-100" : "opacity-0",
        className,
      )}
      style={{
        width: size,
        height: size,
        left: spotlightLeft,
        top: spotlightTop,
        ...(fill === undefined
          ? {}
          : {
              background: `radial-gradient(circle at center, ${fill}, transparent 80%)`,
            }),
      }}
    />
  );
}
