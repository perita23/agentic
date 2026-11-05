"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { animate, motion, useMotionValue } from "motion/react";

/**
 * A thin bar at the very top that creeps forward when you click a link to another page and completes when the
 * page arrives: the app answers at once, even when the next screen takes a moment.
 */
export function RouteProgress() {
  const pathname = usePathname();
  const scale = useMotionValue(0);
  const opacity = useMotionValue(0);
  const creep = React.useRef<ReturnType<typeof animate> | null>(null);
  const last = React.useRef(pathname);

  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      let u: URL;
      try {
        u = new URL(a.href, location.href);
      } catch {
        return;
      }
      if (u.origin !== location.origin || u.pathname === location.pathname) return;
      creep.current?.stop();
      scale.set(0.04);
      opacity.set(1);
      // Fast at first, then slower and slower: it never reaches the end until the page is there.
      creep.current = animate(scale, 0.88, { duration: 9, ease: [0.1, 0.7, 0.2, 1] });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [scale, opacity]);

  React.useEffect(() => {
    if (last.current === pathname) return;
    last.current = pathname;
    creep.current?.stop();
    void animate(scale, 1, { duration: 0.25, ease: "easeOut" }).then(() => animate(opacity, 0, { duration: 0.3 }));
  }, [pathname, scale, opacity]);

  return (
    <motion.div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 origin-left bg-primary shadow-[0_0_10px_var(--primary)]"
      style={{ scaleX: scale, opacity }}
    />
  );
}
