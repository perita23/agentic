"use client";

import * as React from "react";
import { CyclingOrb } from "./liquid-orb";

/** Size of the big orb: as large as the panel allows without crowding the caption. */
function useOrbSize() {
  const [size, setSize] = React.useState(420);
  React.useEffect(() => {
    const update = () => setSize(Math.round(Math.max(240, Math.min(window.innerWidth / 2 - 96, window.innerHeight - 340, 620))));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return size;
}

/**
 * The login's art panel: Agentic's orb, large, walking through all of its states (a new one every two or three
 * seconds) over a fine grid and a soft glow. Purely decorative.
 */
export function LoginArt() {
  const size = useOrbSize();
  return (
    <div aria-hidden className="relative h-full w-full overflow-hidden bg-black">
      <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" viewBox="0 0 800 1000">
        <defs>
          <pattern id="la-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M40 0H0V40" fill="none" stroke="#fff" strokeOpacity=".05" strokeWidth="1" />
          </pattern>
          <radialGradient id="la-glow" cx=".5" cy=".5" r=".5">
            <stop offset="0" stopColor="#a78bfa" stopOpacity=".28" />
            <stop offset="1" stopColor="#a78bfa" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="800" height="1000" fill="url(#la-grid)" />
        <circle cx="400" cy="430" r="360" fill="url(#la-glow)" />
      </svg>

      <div className="absolute inset-x-0 top-0 bottom-44 flex items-center justify-center">
        <CyclingOrb size={size} />
      </div>

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
