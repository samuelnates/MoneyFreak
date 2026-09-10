// Autenticación propia de app-inventario: NO usa Supabase Auth. El acceso es
// por palabra clave (ver inv_usuarios_acceso) y el "rol" (viewer/editor) va
// dentro de un token firmado con HMAC-SHA256 que el cliente reenvía como
// Bearer token en cada llamada. Todas las Edge Functions de esta carpeta
// deben llamar a requireSesion() antes de tocar cualquier dato.
//
// Por qué no RLS con el anon key: el "login" aquí es una sola palabra clave
// compartida por rol, no una cuenta individual — no hay un auth.uid() al
// que atarle policies. Es más simple y más seguro concentrar el control de
// acceso en estas funciones (service role key, RLS cerrado a cal y canto
// en las tablas inv_*) que tratar de expresar "viewer vs editor por
// palabra clave" en policies de Postgres.

const TOKEN_TTL_SEGUNDOS = 60 * 60 * 12; // 12 horas

export type Rol = "viewer" | "editor";

export interface SesionPayload {
  sub: string; // id de inv_usuarios_acceso
  nombre: string;
  rol: Rol;
  exp: number; // epoch seconds
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function sha256Hex(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function firmarSesion(datos: { sub: string; nombre: string; rol: Rol }, secret: string): Promise<string> {
  const payload: SesionPayload = { ...datos, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SEGUNDOS };
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const payloadB64 = base64UrlEncode(payloadBytes);
  const key = await hmacKey(secret);
  const firma = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  return `${payloadB64}.${base64UrlEncode(new Uint8Array(firma))}`;
}

export async function verificarSesion(token: string, secret: string): Promise<SesionPayload | null> {
  const partes = token.split(".");
  if (partes.length !== 2) return null;
  const [payloadB64, firmaB64] = partes;
  const key = await hmacKey(secret);
  const firmaValida = await crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlDecode(firmaB64),
    new TextEncoder().encode(payloadB64),
  );
  if (!firmaValida) return null;
  let payload: SesionPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));
  } catch {
    return null;
  }
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

export class ErrorSesion extends Error {
  status: number;
  constructor(mensaje: string, status = 401) {
    super(mensaje);
    this.status = status;
  }
}

// Extrae y valida el Bearer token de la request. Si `rolesPermitidos` se
// pasa, además exige que el rol de la sesión esté en esa lista (ej. solo
// 'editor' para cargar reportes).
export async function requireSesion(
  req: Request,
  secret: string,
  rolesPermitidos?: Rol[],
): Promise<SesionPayload> {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ErrorSesion("missing_authorization", 401);
  const sesion = await verificarSesion(token, secret);
  if (!sesion) throw new ErrorSesion("invalid_or_expired_session", 401);
  if (rolesPermitidos && !rolesPermitidos.includes(sesion.rol)) {
    throw new ErrorSesion("forbidden_role", 403);
  }
  return sesion;
}

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
