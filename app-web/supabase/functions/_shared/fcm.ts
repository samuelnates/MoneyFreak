// Firma del JWT del service account de Firebase y envío de push reales vía
// FCM -- compartido entre revisar-alertas-presupuesto (parte 168, primer
// uso) y revisar-onboarding-inactivo (parte 202) para no tener la misma
// lógica de firma RS256 duplicada en dos archivos. Mismo flujo estándar de
// "Service Account JWT Bearer", con Web Crypto (RS256) nativo de Deno, sin
// librería extra.

function base64UrlDesdeBytes(bytes: Uint8Array): string {
  let binario = "";
  bytes.forEach((b) => (binario += String.fromCharCode(b)));
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDesdeTexto(texto: string): string {
  return base64UrlDesdeBytes(new TextEncoder().encode(texto));
}

async function importarLlavePrivada(pem: string): Promise<CryptoKey> {
  const cuerpo = pem.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s+/g, "");
  const binario = atob(cuerpo);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return crypto.subtle.importKey("pkcs8", bytes.buffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

export async function obtenerAccessTokenFCM(serviceAccount: { client_email: string; private_key: string }): Promise<string> {
  const ahora = Math.floor(Date.now() / 1000);
  const header = base64UrlDesdeTexto(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64UrlDesdeTexto(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: ahora,
    exp: ahora + 3600,
  }));
  const llave = await importarLlavePrivada(serviceAccount.private_key);
  const firma = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", llave, new TextEncoder().encode(`${header}.${claims}`));
  const jwt = `${header}.${claims}.${base64UrlDesdeBytes(new Uint8Array(firma))}`;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error(`No se pudo obtener access token de Google: ${JSON.stringify(data)}`);
  return data.access_token;
}

export async function mandarPush(
  accessToken: string,
  projectId: string,
  token: string,
  titulo: string,
  cuerpo: string,
  destino: string
): Promise<boolean> {
  const resp = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: titulo, body: cuerpo },
        data: { destino },
      },
    }),
  });
  if (!resp.ok) {
    const detalle = await resp.text();
    console.warn(`FCM rechazó el push para un token (probablemente inválido/expirado): ${detalle}`);
    return false;
  }
  return true;
}
