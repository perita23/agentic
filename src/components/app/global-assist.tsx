"use client";

import * as React from "react";
import { useApi } from "@/lib/api";
import { proseField, wordAssist, type Morph } from "@/lib/word-assist";
import { MorphPill } from "./prompt-assist";

/**
 * Word-by-word correction with the local model in every field where you write prose (task titles and descriptions,
 * notes, comments…), not only in the message boxes. Fields that are searches, addresses, paths, keys… are left alone
 * (see `proseField`), and any field can opt out with `data-no-assist`.
 */
export function GlobalWordAssist() {
  const { data } = useApi<{ settings: { enabled: boolean; model: string; autocorrect: string } }>("/api/ollama?probe=0", { revalidateOnFocus: false });
  const s = data?.settings;
  const on = !!s?.enabled && !!s.model && s.autocorrect === "words";
  const [morphs, setMorphs] = React.useState<Morph[]>([]);
  React.useEffect(() => {
    if (!on) return;
    const onInput = (e: Event) => {
      if (proseField(e.target) && !(e as InputEvent).isComposing) wordAssist.schedule(e.target);
    };
    document.addEventListener("input", onInput, true);
    const off = wordAssist.onMorph((f, m) => {
      if (!proseField(f)) return;
      setMorphs((l) => [...l, m]);
      setTimeout(() => setMorphs((l) => l.filter((x) => x.id !== m.id)), 1500);
    });
    return () => {
      document.removeEventListener("input", onInput, true);
      off();
    };
  }, [on]);
  return (
    <>
      {morphs.map((m) => (
        <MorphPill key={m.id} m={m} />
      ))}
    </>
  );
}
