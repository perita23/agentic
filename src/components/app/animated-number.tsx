"use client";

import * as React from "react";
import { animate, motion, useMotionValue, useTransform } from "motion/react";

/**
 * A number that counts up (or down) to its new value instead of jumping. The text is written straight to the DOM
 * by the motion value, so it costs no React renders while it moves.
 */
export function AnimatedNumber({ value, format = (n: number) => String(Math.round(n)), className }: { value: number; format?: (n: number) => string; className?: string }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, format);
  React.useEffect(() => {
    const run = animate(mv, value, { duration: 0.7, ease: [0.22, 1, 0.36, 1] });
    return () => run.stop();
  }, [value, mv]);
  return <motion.span className={className}>{text}</motion.span>;
}
