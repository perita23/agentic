"use client";

import { motion, useReducedMotion } from "motion/react";

/**
 * The login's art panel: the logo's pieces (heavy slotted leg, hairline leg,
 * overshooting bar) as oversized, slowly drifting brutalist shapes in the
 * Agentic gradient, over a fine grid. Purely decorative.
 */
export function LoginArt() {
  const still = useReducedMotion();
  const loop = (d: number, delay = 0) => (still ? { duration: 0 } : { duration: d, delay, repeat: Infinity, repeatType: "mirror" as const, ease: "easeInOut" as const });

  return (
    <div aria-hidden className="relative h-full w-full overflow-hidden bg-black">
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 800 1000" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="la-g" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#f2f2f2" />
            <stop offset=".55" stopColor="#a78bfa" />
            <stop offset="1" stopColor="#ff8a5b" />
          </linearGradient>
          <linearGradient id="la-g2" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#a78bfa" />
            <stop offset="1" stopColor="#ff8a5b" />
          </linearGradient>
          <pattern id="la-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M40 0H0V40" fill="none" stroke="#fff" strokeOpacity=".05" strokeWidth="1" />
          </pattern>
          <radialGradient id="la-glow" cx=".5" cy=".5" r=".5">
            <stop offset="0" stopColor="#a78bfa" stopOpacity=".35" />
            <stop offset="1" stopColor="#a78bfa" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="800" height="1000" fill="url(#la-grid)" />
        <motion.circle cx="430" cy="470" r="380" fill="url(#la-glow)" animate={{ scale: [1, 1.12, 1] }} transition={loop(9)} />

        {/* The big "A": heavy leg split by a slot, hairline leg, overshooting bar. */}
        <motion.g initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1.2, ease: "easeOut" }}>
          <motion.path d="M90 900 360 160H470L200 900Z" fill="url(#la-g)" animate={{ x: [0, -14, 0] }} transition={loop(7)} />
          <motion.path d="M222 900 492 160H560L290 900Z" fill="url(#la-g)" animate={{ x: [0, 10, 0] }} transition={loop(7, 0.4)} />
          <motion.path d="M690 900 506 160H560L746 900Z" fill="url(#la-g)" animate={{ x: [0, 18, 0] }} transition={loop(8, 0.8)} />
          <motion.rect
            x="230"
            y="640"
            height="34"
            fill="url(#la-g2)"
            initial={{ width: 0 }}
            animate={{ width: [520, 640, 520] }}
            transition={still ? { duration: 0 } : { duration: 6, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" }}
          />
        </motion.g>

        {/* Loose brutalist fragments drifting around. */}
        {[
          { x: 600, y: 120, w: 120, h: 14, d: 11 },
          { x: 60, y: 210, w: 14, h: 120, d: 13 },
          { x: 640, y: 780, w: 90, h: 90, d: 10, o: 0.15 },
          { x: 120, y: 60, w: 60, h: 6, d: 9 },
        ].map((f, i) => (
          <motion.rect
            key={i}
            x={f.x}
            y={f.y}
            width={f.w}
            height={f.h}
            fill="url(#la-g2)"
            opacity={f.o ?? 0.6}
            animate={{ y: [f.y, f.y + 30, f.y], rotate: [0, i % 2 ? 6 : -6, 0] }}
            transition={loop(f.d, i * 0.6)}
          />
        ))}
      </svg>

      <div className="absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-black via-black/85 to-transparent" />
      <div className="absolute inset-x-10 bottom-10 grid gap-2">
        <span className="font-mono text-xs tracking-widest text-white/50 uppercase">Agentic · local</span>
        <p className="max-w-sm text-2xl leading-tight font-semibold tracking-tight text-white">
          Tus agentes de Claude Code, <span className="bg-gradient-to-r from-[#f2f2f2] via-[#a78bfa] to-[#ff8a5b] bg-clip-text text-transparent">bajo control y en tu dispositivo</span>.
        </p>
      </div>
    </div>
  );
}
