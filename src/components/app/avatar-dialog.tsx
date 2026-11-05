"use client";

import * as React from "react";
import { motion } from "motion/react";
import { CameraIcon, CheckIcon, ImageUpIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { AVATAR_PRESETS } from "@/lib/avatars";
import { cn } from "@/lib/utils";
import { Avatar, PresetArt, type ProfileData } from "./avatar";
import { errorMessage } from "./common";

const SIZE = 320;

/** Centre-crops a picture to a square and scales it down: a profile photo never needs to be bigger. */
async function squarePhoto(file: File): Promise<{ mime: "image/webp" | "image/jpeg"; data: string; preview: string }> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo procesar la imagen");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  bmp.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.86));
  const real = blob && blob.type === "image/webp" ? blob : await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.88));
  if (!real) throw new Error("No se pudo procesar la imagen");
  const data = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(",")[1] ?? "");
    fr.onerror = () => reject(new Error("No se pudo leer la imagen"));
    fr.readAsDataURL(real);
  });
  return { mime: real.type === "image/webp" ? "image/webp" : "image/jpeg", data, preview: canvas.toDataURL("image/jpeg", 0.8) };
}

/** Choose a predefined avatar or upload your own photo. */
export function AvatarDialog({ open, onOpenChange, profile, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; profile: ProfileData | undefined; onSave: (avatar: ProfileData["avatar"]) => Promise<void> }) {
  const [busy, setBusy] = React.useState(false);
  const [over, setOver] = React.useState(false);
  const [preview, setPreview] = React.useState<{ mime: "image/webp" | "image/jpeg"; data: string; preview: string } | null>(null);
  const input = React.useRef<HTMLInputElement>(null);
  const current = profile?.avatar;

  async function choose(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return void toast.error("Elige una imagen (PNG, JPG, WebP…)");
    try {
      setPreview(await squarePhoto(file));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }
  async function usePhoto() {
    if (!preview) return;
    setBusy(true);
    try {
      const up = await api<{ id: string }>("POST", "/api/uploads", { mime: preview.mime, data: preview.data });
      await onSave({ kind: "photo", id: up.id });
      setPreview(null);
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function pick(id: string) {
    try {
      await onSave({ kind: "preset", id });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setPreview(null); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tu imagen</DialogTitle>
          <DialogDescription>Elige una predeterminada o sube una foto. Se guarda solo en este dispositivo.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue={current?.kind === "photo" ? "photo" : "preset"}>
          <TabsList>
            <TabsTrigger value="preset">Predeterminadas</TabsTrigger>
            <TabsTrigger value="photo">
              <CameraIcon /> Tu foto
            </TabsTrigger>
          </TabsList>
          <TabsContent value="preset" className="pt-3">
            <div className="grid grid-cols-4 gap-3" role="radiogroup" aria-label="Avatares predeterminados">
              {AVATAR_PRESETS.map((p, i) => {
                const on = current?.kind === "preset" && current.id === p.id;
                return (
                  <motion.button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={p.name}
                    title={p.name}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.03, type: "spring", stiffness: 420, damping: 26 }}
                    whileHover={{ scale: 1.08 }}
                    whileTap={{ scale: 0.94 }}
                    onClick={() => void pick(p.id)}
                    className="relative aspect-square cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <span className="block size-full overflow-hidden rounded-full">
                      <PresetArt preset={p} className="size-full" />
                    </span>
                    {on && (
                      <>
                        <motion.span layoutId="avatar-ring" className="absolute -inset-1 rounded-full border-2 border-foreground" transition={{ type: "spring", stiffness: 500, damping: 34 }} />
                        <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute -right-0.5 -bottom-0.5 flex size-5 items-center justify-center rounded-full bg-foreground text-background">
                          <CheckIcon className="size-3" />
                        </motion.span>
                      </>
                    )}
                  </motion.button>
                );
              })}
            </div>
          </TabsContent>
          <TabsContent value="photo" className="grid gap-3 pt-3">
            <input ref={input} type="file" accept="image/*" hidden onChange={(e) => void choose(e.target.files?.[0])} />
            {preview ? (
              <motion.div initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview.preview} alt="Vista previa" className="size-40 rounded-full border object-cover" />
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPreview(null)} disabled={busy}>
                    Elegir otra
                  </Button>
                  <Button size="sm" onClick={usePhoto} disabled={busy}>
                    <CheckIcon /> Usar esta foto
                  </Button>
                </div>
              </motion.div>
            ) : (
              <button
                type="button"
                onClick={() => input.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(true);
                }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(false);
                  void choose(e.dataTransfer.files?.[0]);
                }}
                className={cn("flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-sm text-muted-foreground transition-all hover:border-border-strong hover:text-foreground", over && "scale-[1.02] border-primary bg-primary/5 text-foreground")}
              >
                <motion.span animate={{ y: over ? -4 : 0 }}>
                  <ImageUpIcon className="size-7" />
                </motion.span>
                Arrastra una foto o haz clic para elegirla
                <span className="text-xs">Se recorta en cuadrado y se reduce</span>
              </button>
            )}
            {current?.kind === "photo" && !preview && (
              <div className="flex items-center justify-between gap-3 rounded-lg border p-2">
                <span className="flex items-center gap-2 text-sm">
                  <Avatar profile={profile} size={32} /> Tu foto actual
                </span>
                <Button variant="ghost" size="sm" onClick={() => void onSave(null)}>
                  <Trash2Icon /> Quitar
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
