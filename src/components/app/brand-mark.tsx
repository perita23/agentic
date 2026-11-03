import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * Agentic's mark: a thin, rigid grotesque "A" with the site's gradient on a black
 * app-icon squircle. Same artwork as the macOS icon (desktop/build/icon.svg).
 */
export function BrandMark({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="100 100 824 824" className={cn("size-7 shrink-0", className)} aria-hidden>
      <defs>
        <linearGradient id={id} x1="276" y1="0" x2="748" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f2f2f2" />
          <stop offset=".55" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#ff8a5b" />
        </linearGradient>
      </defs>
      <path d="M512 100c228 0 300 0 356 56s56 128 56 356 0 300-56 356-128 56-356 56-300 0-356-56-56-128-56-356 0-300 56-356 128-56 356-56z" fill="#000" stroke="#fff" strokeOpacity=".16" strokeWidth="10" />
      <path fill={`url(#${id})`} fillRule="evenodd" d="M276 774 470 250H554L748 774H684L630.7 630H393.3L340 774ZM512 309.4 615.9 590H408.1Z" />
    </svg>
  );
}
