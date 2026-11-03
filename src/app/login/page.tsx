"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { startAuthentication } from "@simplewebauthn/browser";
import { FingerprintIcon, KeyRoundIcon, LockIcon, TerminalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, fetcher } from "@/lib/api";
import { useLocation } from "@/lib/use-location";
import { BrandMark } from "@/components/app/brand-mark";

/** Only same-app paths are allowed after login (no open redirects). */
function safeNext(n: string | null) {
  return n && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : "/";
}

interface Status {
  passkeys: boolean;
  requirePasskey: boolean;
  localhost: boolean;
}

function Login() {
  const params = useSearchParams();
  const [status, setStatus] = React.useState<Status | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(params.get("reason") === "passkey" ? "Touch ID es obligatorio: el enlace con token ya no basta para entrar." : null);

  React.useEffect(() => {
    fetcher<Status>("/api/auth/status").then(setStatus, () => setStatus({ passkeys: false, requirePasskey: false, localhost: false }));
  }, []);

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const options = await api<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("POST", "/api/auth/passkey/login/options");
      const response = await startAuthentication({ optionsJSON: options });
      await api("POST", "/api/auth/passkey/login/verify", { response });
      window.location.assign(safeNext(params.get("next")));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/NotAllowed|cancel|abort/i.test(msg) ? "Autenticación cancelada." : msg);
    } finally {
      setBusy(false);
    }
  }

  const { port } = useLocation();
  const localhostUrl = `http://localhost${port ? `:${port}` : ""}/login`;

  return (
    <main className="grid min-h-screen place-items-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm rounded-xl border bg-card p-7 shadow-2xl shadow-black/50"
      >
        <div className="mb-6 flex items-center gap-2">
          <BrandMark className="size-9" />
          <span className="text-lg font-semibold">Agentic</span>
          <LockIcon className="ml-auto size-4 text-muted-foreground" />
        </div>
        <h1 className="text-base font-semibold">Inicia sesión</h1>
        <p className="mt-1 text-sm text-muted-foreground">Esta consola controla Claude Code en tu dispositivo, así que está protegida.</p>

        {status?.passkeys && status.localhost && (
          <Button className="mt-6 h-11 w-full text-base" onClick={signIn} disabled={busy} autoFocus>
            <FingerprintIcon className="size-5" /> {busy ? "Esperando a Touch ID…" : "Entrar con Touch ID"}
          </Button>
        )}
        {status?.passkeys && !status.localhost && (
          <p className="mt-6 rounded-md border bg-inset p-3 text-sm">
            <KeyRoundIcon className="mr-1 inline size-4" /> Para usar Touch ID abre{" "}
            <a className="text-link underline" href={localhostUrl}>
              {localhostUrl}
            </a>
          </p>
        )}

        {error && <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}

        <div className="mt-6 border-t pt-4 text-xs leading-relaxed text-muted-foreground">
          {status?.requirePasskey ? (
            <>
              Touch ID es obligatorio. Si has perdido el acceso, ejecuta <code className="rounded bg-secondary px-1 font-mono">npm run reset-auth</code> en el dispositivo.
            </>
          ) : (
            <>
              <TerminalIcon className="mr-1 inline size-3.5" />
              {status?.passkeys ? "O abre" : "Abre"} el enlace que muestra <code className="rounded bg-secondary px-1 font-mono">npm start</code> (o{" "}
              <code className="rounded bg-secondary px-1 font-mono">npm run url</code>).
            </>
          )}
        </div>
      </motion.div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <React.Suspense>
      <Login />
    </React.Suspense>
  );
}
