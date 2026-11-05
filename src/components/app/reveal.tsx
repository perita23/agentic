"use client";

import * as React from "react";
import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react";
import { cn } from "@/lib/utils";

const EASE = [0.22, 0.8, 0.3, 1] as const;

/** A block that rises and fades in when it first appears. */
export function Reveal({ delay = 0, y = 10, className, children, ...rest }: { delay?: number; y?: number } & Omit<HTMLMotionProps<"div">, "initial" | "animate" | "transition">) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={className} initial={reduce ? false : { opacity: 0, y }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay, ease: EASE }} {...rest}>
      {children}
    </motion.div>
  );
}

const container = (gap: number) => ({ hidden: {}, show: { transition: { staggerChildren: gap, delayChildren: 0.04 } } });
const item = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.38, ease: EASE } } };

/** Children (wrapped in `StaggerItem`) appear one after another. */
export function Stagger({ gap = 0.05, className, children }: { gap?: number; className?: string; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={className} variants={container(gap)} initial={reduce ? "show" : "hidden"} animate="show">
      {children}
    </motion.div>
  );
}

export function StaggerItem({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <motion.div className={cn(className)} variants={item}>
      {children}
    </motion.div>
  );
}
