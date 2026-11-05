"use client";

import * as React from "react";
import { AVATAR_PRESETS, type AvatarPreset } from "@/lib/avatars";
import { api, refresh, useApi } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface ProfileData {
  name: string;
  avatar: { kind: "preset" | "photo"; id: string } | null;
  createdAt: string;
  stats: { runs: number; completed: number; tokens: number; firstRunAt: string | null };
}

/** The person using the app: name and avatar, with a way to change them (saved at once, shown at once). */
export function useProfile() {
  const { data, mutate } = useApi<ProfileData>("/api/profile", { revalidateOnFocus: false });
  async function save(patch: Partial<Pick<ProfileData, "name" | "avatar">>) {
    await mutate((prev) => (prev ? { ...prev, ...patch } : prev), { revalidate: false });
    try {
      await api("PUT", "/api/profile", patch);
    } finally {
      refresh("/api/profile");
    }
  }
  return { profile: data, save };
}

/** The art of a predefined avatar: its gradient and a pattern in translucent white. */
export function PresetArt({ preset, className }: { preset: AvatarPreset; className?: string }) {
  const gid = "av" + React.useId().replace(/[^a-zA-Z0-9]/g, "");
  const w = { stroke: "rgb(255 255 255 / 0.3)", strokeWidth: 2.2, fill: "none", strokeLinecap: "round" as const };
  const f = "rgb(255 255 255 / 0.24)";
  const art: Record<AvatarPreset["pattern"], React.ReactNode> = {
    rings: [14, 26, 38].map((r) => <circle key={r} cx="46" cy="20" r={r} {...w} />),
    stripes: [-8, 8, 24, 40, 56].map((x) => <path key={x} d={`M${x} 72 L${x + 40} -8`} {...w} strokeWidth="5" />),
    grid: [0, 16, 32, 48, 64].flatMap((n) => [<path key={`v${n}`} d={`M${n} 0V64`} {...w} strokeWidth="1.4" />, <path key={`h${n}`} d={`M0 ${n}H64`} {...w} strokeWidth="1.4" />]),
    waves: [38, 48, 58].map((y, i) => <path key={y} d={`M-4 ${y} q10 -${10 + i * 2} 20 0 t20 0 t20 0 t20 0`} {...w} />),
    dots: [10, 26, 42, 58].flatMap((x) => [10, 26, 42, 58].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="2.6" fill={f} />)),
    diamonds: [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => <path key={`${i}-${j}`} d={`M${12 + i * 20} ${4 + j * 20} l8 8 l-8 8 l-8 -8Z`} {...w} fill={i % 2 === j % 2 ? f : "none"} strokeWidth="1.6" />)),
    sun: [<circle key="s" cx="44" cy="22" r="11" fill={f} />, ...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => <path key={k} d={`M44 22 L${44 + Math.cos((k * Math.PI) / 4) * 30} ${22 + Math.sin((k * Math.PI) / 4) * 30}`} {...w} strokeWidth="1.6" />)],
    peaks: [<path key="a" d="M-4 64 L18 28 L34 50 L46 34 L68 64Z" fill={f} />, <path key="b" d="M-4 64 L12 44 L26 64Z" fill="rgb(255 255 255 / 0.18)" />],
    hex: [0, 1].flatMap((i) => [0, 1, 2].map((j) => <path key={`${i}-${j}`} d="M0 -9 L8 -4.5 L8 4.5 L0 9 L-8 4.5 L-8 -4.5Z" transform={`translate(${14 + j * 18 + (i % 2) * 9} ${14 + i * 18})`} {...w} strokeWidth="1.8" />)),
    cross: [12, 32, 52].flatMap((x) => [12, 32, 52].map((y) => <path key={`${x}-${y}`} d={`M${x - 4} ${y}H${x + 4}M${x} ${y - 4}V${y + 4}`} {...w} strokeWidth="2" />)),
    arcs: [<path key="1" d="M0 0 Q0 40 40 40" {...w} />, <path key="2" d="M0 0 Q0 56 56 56" {...w} />, <path key="3" d="M64 64 Q64 28 28 28" {...w} />, <path key="4" d="M64 64 Q64 12 12 12" {...w} />],
    zigzag: [16, 30, 44, 58].map((y) => <path key={y} d={`M-2 ${y} l9 -8 l9 8 l9 -8 l9 8 l9 -8 l9 8 l9 -8`} {...w} />),
  };
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={preset.from} />
          <stop offset="1" stopColor={preset.to} />
        </linearGradient>
      </defs>
      <rect width="64" height="64" fill={`url(#${gid})`} />
      {art[preset.pattern]}
    </svg>
  );
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Round avatar: the uploaded photo, a predefined one, or the initials over a gradient while none is chosen. */
export function Avatar({ profile, size = 32, className }: { profile?: Pick<ProfileData, "name" | "avatar"> | null; size?: number; className?: string }) {
  const a = profile?.avatar;
  const preset = a?.kind === "preset" ? AVATAR_PRESETS.find((p) => p.id === a.id) : undefined;
  const name = profile?.name?.trim() ?? "";
  const base = cn("relative inline-flex shrink-0 overflow-hidden rounded-full bg-secondary select-none", className);
  const box = { width: size, height: size };
  if (a?.kind === "photo")
    return (
      <span className={base} style={box}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/uploads/${a.id}`} alt="" className="size-full object-cover" draggable={false} />
      </span>
    );
  if (preset)
    return (
      <span className={base} style={box}>
        <PresetArt preset={preset} className="size-full" />
      </span>
    );
  const tone = AVATAR_PRESETS[hash(name || "agentic") % AVATAR_PRESETS.length];
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <span className={cn(base, "items-center justify-center font-semibold text-white")} style={{ ...box, background: `linear-gradient(135deg, ${tone.from}, ${tone.to})`, fontSize: size * 0.4 }}>
      {initials || <svg viewBox="0 0 24 24" className="size-[55%]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" /></svg>}
    </span>
  );
}
