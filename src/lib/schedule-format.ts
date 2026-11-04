/** Shared (client + server) wording for schedules. */
export type ScheduleWhen = { kind: "daily"; time: string; days: number[] } | { kind: "interval"; hours: number };

const DAY = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

export function describeWhen(when: ScheduleWhen) {
  if (when.kind === "interval") return when.hours === 1 ? "Cada hora" : `Cada ${when.hours} h`;
  const d = [...when.days].sort();
  const days = d.length === 7 ? "Todos los días" : d.join() === "1,2,3,4,5" ? "Lunes a viernes" : d.join() === "0,6" ? "Fines de semana" : d.map((x) => DAY[x]).join(", ");
  return `${days} a las ${when.time}`;
}

/** "en 3 h", "en 12 min", "mañana 09:00"… */
export function untilText(iso: string | null, now = Date.now()) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now;
  if (ms <= 60_000) return "en un momento";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `en ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `en ${h} h`;
  return new Date(iso).toLocaleString("es-ES", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
