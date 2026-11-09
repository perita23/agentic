import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * Agentic's mark: a frame of Morphy (the orb) at the moment its three blobs form a triangle, on the black app-icon squircle.
 * Same artwork as the macOS icon (desktop/build/icon.svg). The orb itself is untouched; this is only a still of it.
 */
export function BrandMark({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="100 100 824 824" className={cn("size-7 shrink-0", className)} aria-hidden>
      <defs>
        <radialGradient id={`${id}a`} cx=".35" cy=".3" r=".955">
          <stop offset="0" stopColor="#fff" />
          <stop offset=".4" stopColor="#d8ccff" />
          <stop offset="1" stopColor="#8b6cf5" />
        </radialGradient>
        <radialGradient id={`${id}b`} cx=".4" cy=".3" r=".922">
          <stop offset="0" stopColor="#d8ccff" />
          <stop offset=".75" stopColor="#8b6cf5" />
        </radialGradient>
        <radialGradient id={`${id}c`} cx=".4" cy=".3" r=".922">
          <stop offset="0" stopColor="#fff" />
          <stop offset=".65" stopColor="#ff8a5b" />
        </radialGradient>
        <filter id={`${id}f`} x="-45%" y="-45%" width="190%" height="190%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="18.75" result="b" />
          <feColorMatrix in="b" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 18 -7" />
        </filter>
      </defs>
      <path d="M512 100c228 0 300 0 356 56s56 128 56 356 0 300-56 356-128 56-356 56-300 0-356-56-56-128-56-356 0-300 56-356 128-56 356-56z" fill="#000" stroke="#fff" strokeOpacity=".16" strokeWidth="10" />
      <g filter={`url(#${id}f)`}>
        <g transform="translate(219.50 251.75) scale(1.95)">
          <circle cx="150" cy="84" r="63" fill={`url(#${id}a)`} />
          <circle cx="207" cy="183" r="63" fill={`url(#${id}b)`} />
          <circle cx="93" cy="183" r="63" fill={`url(#${id}c)`} />
        </g>
      </g>
    </svg>
  );
}
