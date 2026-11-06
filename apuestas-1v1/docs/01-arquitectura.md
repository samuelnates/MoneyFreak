# 01 · Arquitectura

## Qué es el producto (en una frase)

Una plataforma donde **dos personas apuestan entre sí** sobre el resultado de un evento. La casa **no toma postura**: guarda el dinero de ambos en custodia (escrow), paga al ganador cuando hay resultado oficial y se queda con una **comisión sobre el bote**.

```
 Ana pone $200 a América ──┐                         ┌──> Ana gana: recibe $380
                           ├──> BOTE $400 en custodia├
 Beto pone $200 a Chivas ──┘                         └──> Casa: $20 de comisión (5%)
```

Esto es un *betting exchange* 1 vs 1 (como Betfair, pero sin libro de órdenes: cada reto es un contrato entre dos personas). Diferencias con una casa de apuestas normal:

| | Casa de apuestas tradicional | Nosotros (P2P) |
|---|---|---|
| ¿Contra quién apuestas? | Contra la casa | Contra otra persona |
| ¿Cómo gana la casa? | Margen en el momio (overround) + que pierdas | Comisión fija, gane quien gane |
| Riesgo de la casa | Alto (puede perder si muchos aciertan) | Casi nulo (nunca pone su dinero) |
| Problema principal | Gestión de riesgo / trading | **Liquidez**: que haya alguien del otro lado |

**Consecuencia de diseño:** lo más importante del producto es que un reto encuentre rival rápido. Por eso el flujo estrella es "Mandar a un amigo" (link por WhatsApp), y el lobby público es secundario.

## Stack elegido (y por qué)

Se reutiliza el stack que ya domina Samuel en Money Freak para ir rápido, pero en **proyectos y cuentas separadas** (ver "Separación de Money Freak" abajo).

| Capa | Tecnología | Por qué |
|---|---|---|
| Web / PWA | HTML + CSS + JS (ES modules), sin framework | Cero build, deploy instantáneo, se instala como app desde el navegador |
| Lógica de dinero (cliente) | `web/js/motor.js` | Mismas reglas que el servidor; permite modo demo offline y tests |
| Backend | **Supabase** (Postgres + Auth + Edge Functions) | Auth lista, RLS, funciones SQL transaccionales para el dinero |
| Dinero (servidor) | Funciones RPC en Postgres con `FOR UPDATE` | El dinero se mueve en una sola transacción; imposible doble gasto |
| Hosting web | Cloudflare Pages | Gratis, CDN global, ya lo usan |
| iOS / Android | **Capacitor** envolviendo la PWA | Una sola base de código para web + 2 tiendas |
| Resultados deportivos | API externa (API-Football / Sportradar / The Odds API) | Liquidación automática y verificable |
| Pagos (fase real) | SPEI vía STP/Conekta/OpenPay + tarjeta + OXXO | SPEI es ~10x más barato que tarjeta |
| KYC (fase real) | Truora / MetaMap / Incode | INE + selfie, obligatorio para retirar |

## Diagrama

```
  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐
  │  Web (PWA)    │  │  iOS (Cap.)   │  │ Android (Cap.)│   ← misma base: apuestas-1v1/web
  └──────┬────────┘  └──────┬────────┘  └──────┬────────┘
         └──────────────────┼──────────────────┘
                            │ supabase-js (HTTPS)
                ┌───────────▼────────────┐
                │        SUPABASE         │
                │  Auth (correo/Google/   │
                │        Apple)           │
                │  Postgres + RLS         │
                │   ├ perfiles/billeteras │
                │   ├ eventos / retos     │
                │   ├ asientos + líneas   │◄── libro mayor partida doble
                │   └ RPC: crear_reto,    │
                │     aceptar_reto,       │
                │     cancelar_reto,      │
                │     resolver_evento     │
                │  Edge Functions:        │
                │   ├ sync-eventos (cron) │──► API deportiva (calendario)
                │   ├ liquidar (cron)     │──► API deportiva (resultados)
                │   ├ webhook-pagos       │◄── STP / Conekta (depósitos)
                │   └ webhook-kyc         │◄── Truora / MetaMap
                └─────────────────────────┘
```

## Modelo de datos

Ver `supabase/migrations/001_esquema.sql` (probado en Postgres 16 con `supabase/pruebas/`).

- **perfiles** — nombre, admin, fecha de nacimiento, estado KYC, autoexclusión.
- **billeteras** — saldo disponible cacheado; `CHECK (saldo >= 0)` hace imposible quedar negativo.
- **eventos** — partido/pelea con 2 opciones, estado `abierto → cerrado → resuelto | anulado`.
- **retos** — creador, lado, monto propio, monto del rival (permite momio propio), privado, rival, estado `abierto → emparejado → liquidado` (o `cancelado / expirado / anulado` con reembolso).
- **asientos + líneas** — contabilidad de partida doble. Cuentas: `u:<id>`, `escrow`, `casa`, `externo`. Cada asiento suma cero. La vista `auditoria_cuadre` debe dar siempre 0; se monitorea con una alerta.

### Reglas de dinero (idénticas en `motor.js` y en SQL)

1. Montos en **centavos enteros** — nunca decimales.
2. Crear reto ⇒ el monto del creador pasa de su saldo a `escrow`.
3. Aceptar ⇒ el monto del rival pasa a `escrow`. Bloqueo de fila: dos personas no pueden aceptar el mismo reto.
4. Resolver ⇒ ganador recibe `bote − comisión`; `casa` recibe la comisión.
5. Empate / suspendido / sin rival ⇒ reembolso total, **sin comisión**.
6. El cliente no puede escribir ninguna tabla de dinero: solo llama RPCs (RLS sin políticas de escritura).

## Resolución de resultados (el "oráculo")

| Fase | Cómo se resuelve |
|---|---|
| MVP (esta semana) | Admin marca el ganador en el Panel de la casa |
| Beta | Edge Function `liquidar` lee la API deportiva cada 10 min y resuelve sola; admin solo revisa excepciones |
| Producción | Dos fuentes de resultados; si no coinciden → cola de revisión manual. Ventana de disputa de 24 h antes de liberar retiros grandes |

**No** recomendamos retos "personalizados" (p. ej. "apuesto a que llego antes") donde los propios usuarios declaran el ganador: generan disputas, fraude y quedan fuera de cualquier permiso. Solo eventos con resultado público verificable.

## Seguridad y antifraude (fase real)

- KYC obligatorio antes del primer retiro (y edad ≥ 18).
- Límite de retiro diario y retención de 24–48 h al primer retiro.
- Detección de colusión: mismas cuentas que siempre se emparejan entre sí, mismo dispositivo/IP en ambos lados, "chip dumping" (pasar dinero de una cuenta a otra perdiendo a propósito).
- Retos solo hasta el inicio del evento (`inicia <= now()` cierra apuestas; nadie apuesta sabiendo el resultado).
- Geocerca: solo usuarios ubicados en México (requisito típico de permiso y de Apple).
- Logs inmutables del libro mayor; reportes de operaciones relevantes (PLD/AML) — los define Jacques.

## Apps iOS / Android

- Se empaqueta la misma web con Capacitor (como Money Freak, carpeta `app-nativa/`).
- **Apple (guía 5.3.3)** y **Google Play** solo aceptan apps de apuestas con dinero real si:
  - las publica **la empresa con licencia** (cuenta de desarrollador a nombre de la persona moral),
  - están geo-restringidas al país del permiso,
  - son gratuitas (sin compras dentro de la app para fichas).
- Por eso: **no publicar desde la cuenta de desarrollador de Money Freak** (un rechazo o sanción por apuestas podría afectar esa app). Mientras no haya empresa ni permiso, la distribución es **PWA** (instalar desde el navegador) y TestFlight / pruebas internas.

## Separación de Money Freak

Este proyecto vive temporalmente en `apuestas-1v1/` dentro del repo de Money Freak, en la rama `claude/apuestas-1v1-mvp`. Al formalizar:
1. Repo propio en GitHub (de la nueva empresa).
2. Proyecto de Supabase **nuevo** (no compartir usuarios ni base con Money Freak).
3. Cuentas de Apple/Google/Cloudflare a nombre de la empresa.

## Roadmap técnico

| Fase | Qué | Dinero |
|---|---|---|
| 0 · MVP (esta semana) | PWA demo, motor probado, admin manual, 1 dispositivo | Fichas sin valor |
| 1 · Beta cerrada | Supabase + login + links reales entre teléfonos + eventos automáticos | Fichas sin valor, ranking/premios no monetarios |
| 2 · Pre-lanzamiento | KYC, límites de juego responsable, geocerca, términos | Fichas |
| 3 · Lanzamiento | Pagos SPEI/tarjeta, retiros, PLD, apps en tiendas | **Real — solo con permiso vigente** |
