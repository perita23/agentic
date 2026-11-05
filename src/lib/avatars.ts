/** Predefined avatars: a gradient and a pattern each (drawn in SVG, see components/app/avatar.tsx). */
export interface AvatarPreset {
  id: string;
  name: string;
  from: string;
  to: string;
  pattern: "rings" | "stripes" | "grid" | "waves" | "dots" | "diamonds" | "sun" | "peaks" | "hex" | "cross" | "arcs" | "zigzag";
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: "aurora", name: "Aurora", from: "#34d399", to: "#3b82f6", pattern: "waves" },
  { id: "ember", name: "Brasa", from: "#fb923c", to: "#e11d48", pattern: "sun" },
  { id: "orchid", name: "Orquídea", from: "#c084fc", to: "#6366f1", pattern: "rings" },
  { id: "lagoon", name: "Laguna", from: "#22d3ee", to: "#0ea5e9", pattern: "arcs" },
  { id: "moss", name: "Musgo", from: "#a3e635", to: "#16a34a", pattern: "peaks" },
  { id: "sunset", name: "Atardecer", from: "#fde047", to: "#f97316", pattern: "stripes" },
  { id: "rose", name: "Rosa", from: "#f9a8d4", to: "#ec4899", pattern: "dots" },
  { id: "slate", name: "Pizarra", from: "#64748b", to: "#1e293b", pattern: "grid" },
  { id: "ocean", name: "Océano", from: "#38bdf8", to: "#4f46e5", pattern: "zigzag" },
  { id: "peach", name: "Melocotón", from: "#fecaca", to: "#fb7185", pattern: "diamonds" },
  { id: "forest", name: "Bosque", from: "#4ade80", to: "#0f766e", pattern: "hex" },
  { id: "dusk", name: "Crepúsculo", from: "#a78bfa", to: "#be185d", pattern: "cross" },
];

export const AVATAR_IDS = AVATAR_PRESETS.map((p) => p.id);
