"use client";

import * as React from "react";
import { FileTextIcon, LoaderCircleIcon, PaperclipIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { errorMessage } from "./common";

const MAX_IMAGES = 6;
const MAX_BYTES = 8 * 1024 * 1024;
/** Pasted text longer than this becomes a "Pegado" chip instead of filling the box. */
export const PASTE_CHARS = 800;
export const PASTE_LINES = 12;
const OK_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export interface ImageAttachment {
  key: string;
  url: string;
  name: string;
  /** Upload id once the server has it. */
  id?: string;
  error?: boolean;
}
export interface PasteAttachment {
  key: string;
  text: string;
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Images and long pasted text attached to a message. */
export function useAttachments() {
  const [images, setImages] = React.useState<ImageAttachment[]>([]);
  const [pastes, setPastes] = React.useState<PasteAttachment[]>([]);
  const count = React.useRef(0);

  const addFiles = React.useCallback(
    async (files: File[]) => {
      const imgs = files.filter((f) => OK_TYPES.includes(f.type));
      if (files.length && !imgs.length) toast.error("Sólo se pueden adjuntar imágenes (PNG, JPG, GIF o WebP)");
      for (const f of imgs) {
        if (f.size > MAX_BYTES) {
          toast.error(`«${f.name || "imagen"}» pesa más de 8 MB`);
          continue;
        }
        const key = `i${++count.current}`;
        let room = true;
        setImages((p) => {
          if (p.length >= MAX_IMAGES) {
            room = false;
            return p;
          }
          return [...p, { key, url: URL.createObjectURL(f), name: f.name || "captura" }];
        });
        await Promise.resolve();
        if (!room) {
          toast.error(`Máximo ${MAX_IMAGES} imágenes por mensaje`);
          break;
        }
        try {
          const r = await api<{ id: string }>("POST", "/api/uploads", { mime: f.type, data: await toBase64(f) });
          setImages((p) => p.map((x) => (x.key === key ? { ...x, id: r.id } : x)));
        } catch (e) {
          toast.error("No se pudo subir la imagen", { description: errorMessage(e) });
          setImages((p) => p.filter((x) => x.key !== key));
        }
      }
    },
    [],
  );

  /** Use as the textarea's onPaste: images become thumbnails, long text becomes a chip. Returns true when handled. */
  const onPaste = React.useCallback(
    (e: React.ClipboardEvent) => {
      const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
      if (files.length) {
        e.preventDefault();
        void addFiles(files);
        return true;
      }
      const text = e.clipboardData.getData("text/plain");
      if (text.length >= PASTE_CHARS || text.split("\n").length >= PASTE_LINES) {
        e.preventDefault();
        setPastes((p) => [...p, { key: `p${++count.current}`, text }]);
        return true;
      }
      return false;
    },
    [addFiles],
  );

  return {
    images,
    pastes,
    addFiles,
    onPaste,
    removeImage: (key: string) => setImages((p) => p.filter((x) => x.key !== key)),
    removePaste: (key: string) => setPastes((p) => p.filter((x) => x.key !== key)),
    clear: () => {
      setImages([]);
      setPastes([]);
    },
    uploading: images.some((i) => !i.id),
    imageIds: images.flatMap((i) => (i.id ? [i.id] : [])),
    any: images.length > 0 || pastes.length > 0,
    /** The message with pasted blocks appended (so Claude receives them in full). */
    withPastes: (text: string) => [text.trim(), ...pastes.map((p) => "```\n" + p.text.replace(/```/g, "ʼʼʼ") + "\n```")].filter(Boolean).join("\n\n"),
  };
}

export type Attachments = ReturnType<typeof useAttachments>;

/** Thumbnails and "Texto pegado" chips above the box. */
export function AttachmentBar({ att, disabled }: { att: Attachments; disabled?: boolean }) {
  const [openPaste, setOpenPaste] = React.useState<string | null>(null);
  if (!att.any) return null;
  const open = att.pastes.find((p) => p.key === openPaste);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {att.images.map((im) => (
          <div key={im.key} className="group relative size-16 overflow-hidden rounded-lg border bg-inset">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={im.url} alt={im.name} className={cn("size-full object-cover", !im.id && "opacity-50")} />
            {!im.id && <LoaderCircleIcon className="absolute inset-0 m-auto size-4 animate-spin" aria-label="Subiendo" />}
            <button type="button" aria-label={`Quitar ${im.name}`} disabled={disabled} onClick={() => att.removeImage(im.key)} className="absolute top-0.5 right-0.5 grid size-5 cursor-pointer place-items-center rounded-full bg-black/70 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
              <XIcon className="size-3" />
            </button>
          </div>
        ))}
        {att.pastes.map((p) => {
          const lines = p.text.split("\n").length;
          return (
            <div key={p.key} className="group relative flex h-16 w-44 items-center gap-2 rounded-lg border bg-inset px-2.5">
              <button type="button" onClick={() => setOpenPaste(openPaste === p.key ? null : p.key)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left">
                <FileTextIcon className="size-5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 text-xs">
                  <span className="block font-medium">Texto pegado</span>
                  <span className="block truncate text-muted-foreground tabular-nums">{lines} líneas · {p.text.length.toLocaleString("es-ES")} car.</span>
                </span>
              </button>
              <button type="button" aria-label="Quitar texto pegado" disabled={disabled} onClick={() => att.removePaste(p.key)} className="absolute top-0.5 right-0.5 grid size-5 cursor-pointer place-items-center rounded-full bg-black/70 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
                <XIcon className="size-3" />
              </button>
            </div>
          );
        })}
      </div>
      {open && <pre className="max-h-40 overflow-auto rounded-md border bg-inset p-2 font-mono text-[11px] break-words whitespace-pre-wrap text-muted-foreground">{open.text.slice(0, 6000)}{open.text.length > 6000 ? "\n…" : ""}</pre>}
    </div>
  );
}

/** Paperclip button that opens the file picker. */
export function AttachButton({ att, disabled }: { att: Attachments; disabled?: boolean }) {
  const input = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={input} type="file" accept={OK_TYPES.join(",")} multiple hidden aria-label="Adjuntar imágenes" onChange={(e) => { void att.addFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
      <button type="button" disabled={disabled} onClick={() => input.current?.click()} title="Adjuntar imágenes (también puedes pegarlas o arrastrarlas)" className="grid size-8 cursor-pointer place-items-center rounded-md border bg-inset text-muted-foreground hover:text-foreground disabled:opacity-50">
        <PaperclipIcon className="size-4" /> <span className="sr-only">Adjuntar imágenes</span>
      </button>
    </>
  );
}

