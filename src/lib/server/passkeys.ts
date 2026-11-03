import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { z } from "zod";
import { audit } from "./audit";
import {
  createSession,
  putChallenge,
  readAuth,
  rpFromHost,
  takeChallenge,
  updateAuth,
  type StoredPasskey,
  type StoredSession,
} from "./auth";
import { HttpError, parse, text } from "./util";

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64url");
const fromB64 = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));

const responseSchema = z.object({ response: z.record(z.string(), z.unknown()) });
const registerSchema = responseSchema.extend({ name: text(60).trim().min(1).default("Touch ID") });

export const publicPasskey = (p: StoredPasskey) => ({
  id: p.id,
  name: p.name,
  createdAt: p.createdAt,
  lastUsedAt: p.lastUsedAt,
  backedUp: p.backedUp,
  transports: p.transports,
});

/** Options for adding a Touch ID / platform passkey (requires an existing session). */
export async function registrationOptions(dataDir: string, host: string | null) {
  const { rpID } = rpFromHost(host);
  const st = readAuth(dataDir);
  const options = await generateRegistrationOptions({
    rpName: "Agentic",
    rpID,
    userName: "agentic",
    userDisplayName: "Agentic (local)",
    userID: fromB64(st.userId),
    attestationType: "none",
    excludeCredentials: st.passkeys.map((p) => ({ id: p.id, transports: p.transports })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "required", authenticatorAttachment: "platform" },
  });
  return { options, challengeId: putChallenge(options.challenge, "register") };
}

export async function verifyRegistration(dataDir: string, host: string | null, challengeId: string | undefined, body: unknown) {
  const { rpID, origin } = rpFromHost(host);
  const { response, name } = parse(registerSchema, body);
  const expectedChallenge = takeChallenge(challengeId, "register");
  let v;
  try {
    v = await verifyRegistrationResponse({
      response: response as unknown as RegistrationResponseJSON,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (e) {
    throw new HttpError(400, `No se pudo verificar el registro: ${(e as Error).message}`);
  }
  if (!v.verified) throw new HttpError(400, "Registro no verificado");
  const { credential, credentialBackedUp } = v.registrationInfo;
  const pk: StoredPasskey = {
    id: credential.id,
    publicKey: b64(credential.publicKey),
    counter: credential.counter,
    transports: (credential.transports ?? []).map(String),
    name,
    backedUp: credentialBackedUp,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  };
  updateAuth(dataDir, (s) => {
    if (s.passkeys.some((p) => p.id === pk.id)) throw new HttpError(409, "Esa passkey ya está registrada");
    if (s.passkeys.length >= 20) throw new HttpError(400, "Demasiadas passkeys registradas");
    s.passkeys.push(pk);
  });
  audit(dataDir, "passkey.added", { name, backedUp: credentialBackedUp });
  return publicPasskey(pk);
}

/** Options for signing in with a registered passkey (public endpoint). */
export async function authenticationOptions(dataDir: string, host: string | null) {
  const { rpID } = rpFromHost(host);
  const st = readAuth(dataDir);
  if (!st.passkeys.length) throw new HttpError(400, "No hay ninguna passkey registrada");
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: st.passkeys.map((p) => ({ id: p.id, transports: p.transports })),
    userVerification: "required",
  });
  return { options, challengeId: putChallenge(options.challenge, "login") };
}

/** Verify a passkey assertion and open a session. Returns the raw session id. */
export async function verifyAuthentication(dataDir: string, host: string | null, challengeId: string | undefined, body: unknown, userAgent: string): Promise<string> {
  const { rpID, origin } = rpFromHost(host);
  const { response } = parse(responseSchema, body);
  const expectedChallenge = takeChallenge(challengeId, "login");
  const credId = typeof response.id === "string" ? response.id : "";
  const pk = readAuth(dataDir).passkeys.find((p) => p.id === credId);
  if (!pk) throw new HttpError(401, "Passkey no reconocida");
  let v;
  try {
    v = await verifyAuthenticationResponse({
      response: response as unknown as AuthenticationResponseJSON,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: { id: pk.id, publicKey: fromB64(pk.publicKey), counter: pk.counter, transports: pk.transports as never },
      requireUserVerification: true,
    });
  } catch (e) {
    throw new HttpError(401, `Passkey no válida: ${(e as Error).message}`);
  }
  if (!v.verified) throw new HttpError(401, "Passkey no válida");
  updateAuth(dataDir, (s) => {
    const p = s.passkeys.find((x) => x.id === pk.id);
    if (p) {
      p.counter = v.authenticationInfo.newCounter;
      p.lastUsedAt = new Date().toISOString();
    }
  });
  audit(dataDir, "login", { method: "passkey", passkey: pk.name });
  return createSession(dataDir, "passkey", userAgent);
}

export function removePasskey(dataDir: string, id: string) {
  let name = "";
  updateAuth(dataDir, (s) => {
    const p = s.passkeys.find((x) => x.id === id);
    if (!p) throw new HttpError(404, "Passkey no encontrada");
    if (s.requirePasskey && s.passkeys.length === 1) throw new HttpError(409, "Es la única passkey y Touch ID es obligatorio; desactiva el requisito primero");
    name = p.name;
    s.passkeys = s.passkeys.filter((x) => x.id !== id);
  });
  audit(dataDir, "passkey.removed", { name });
}

/** Require passkeys for every login. Only from a passkey session, so you can't lock yourself out. */
export function setRequirePasskey(dataDir: string, on: boolean, current: StoredSession | null) {
  const st = readAuth(dataDir);
  if (on && !st.passkeys.length) throw new HttpError(400, "Registra una passkey antes de exigirla");
  if (on && current?.method !== "passkey" && current?.method !== "desktop") throw new HttpError(409, "Inicia sesión con Touch ID al menos una vez antes de exigirlo");
  updateAuth(dataDir, (s) => {
    s.requirePasskey = on;
    // Turning it on ends every session that was opened with the plain token.
    if (on) s.sessions = s.sessions.filter((x) => x.method !== "token");
  });
  audit(dataDir, "auth.requirePasskey", { on });
}
