# 04 · Plan del MVP (esta semana) y roles

## Decisión clave: el MVP es con fichas sin valor

Operar apuestas con dinero real en México sin permiso de la SEGOB (Ley Federal de Juegos y Sorteos) es ilegal, y desde 2026 además se paga IEPS de 50%. Por eso el MVP valida **el comportamiento** (¿la gente reta a sus amigos? ¿repite?) con **fichas demo** mientras Jacques resuelve la parte regulatoria. Cambiar a dinero real es un switch en `config.js` + conectar pagos/KYC, no reescribir la app.

## Roles

| Persona | Rol | Entregable de esta semana |
|---|---|---|
| **Samuel** | Producto, web y apps | MVP demo publicado + backend Supabase + link compartible entre teléfonos |
| **Jacques** | Regulatorio y legal | Ruta de licencia (permiso propio vs marca blanca) con costos; confirmar base de IEPS e IVA; borrador de términos y aviso de privacidad (`docs/05`) |
| **Eduardo** | Distribución y marketing | Lista de 50 personas para la beta + grupo de WhatsApp; 3 piezas de contenido; propuesta de nombre |
| **Itai** | Redes y comunidad | Cuentas en IG/TikTok reservadas (con nombre temporal o handle neutro); calendario de eventos para la beta (qué partidos usamos) |

## Día por día

| Día | Samuel (producto) | Jacques | Eduardo + Itai |
|---|---|---|---|
| 1 | ✅ Arquitectura, motor de dinero con tests, PWA demo funcionando, esquema SQL probado (hecho hoy) | Leer `docs/05`, agendar llamada con 2 permisionarios / abogado de juego | Lluvia de nombres (5 opciones) + checar dominios disponibles |
| 2 | Crear proyecto Supabase nuevo, aplicar `001_esquema.sql`, login por correo (magic link) | Cotizar marca blanca | Lista de beta testers |
| 3 | Conectar la app a Supabase (`almacen.js` → RPCs), links de reto entre teléfonos reales | Confirmar base de IEPS para P2P con contador | Contenido: "cómo funciona" en 30 s |
| 4 | Deploy en Cloudflare Pages (subdominio gratis `*.pages.dev`), cargar eventos de la semana | Borrador de términos y condiciones | Invitar primeros 10 testers |
| 5 | Medir KPIs (emparejamiento, retos/usuario), arreglar lo que salga | Reporte go/no-go regulatorio | Recoger feedback |
| 6–7 | Beta con 20–50 personas en un fin de semana de futbol | — | Mover el grupo, empujar revanchas |

## Qué ya está hecho (día 1)

- `web/` — PWA completa en modo demo: registro (+18), lobby, eventos, crear reto en 3 pasos con momio propio, compartir link, aceptar, cancelar, mis retos, billetera con movimientos, perfil, juego responsable, panel admin con KPIs y resolución de eventos.
- `web/js/motor.js` — reglas de dinero con partida doble. 7 tests incluyendo 500 operaciones aleatorias (`npm test`).
- `supabase/migrations/001_esquema.sql` — tablas, RLS, RPCs con bloqueo de filas. Probado en Postgres 16 local (`supabase/pruebas/`).
- `finanzas/modelo.py` — estado de resultados con 3 escenarios.

## Cómo correrlo

```bash
cd apuestas-1v1
npm test                 # tests del motor
npm run dev              # abre http://localhost:5173  (o: python3 -m http.server 5173 -d web)
python3 finanzas/modelo.py
```

Para probar el 1 vs 1 en un solo teléfono: Perfil → "Cambiar de cuenta (demo)" → "Crear otra cuenta". El **primer** usuario creado en el dispositivo es admin (Panel de la casa).

## Pendiente para formalizar (cuando haya calidad)

- [ ] Nombre definitivo → dominio → correos del dominio
- [ ] Constituir la empresa (S.A.P.I. / S.A. de C.V.) — requisito para permiso y para cuentas de Apple/Google
- [ ] Repo, Supabase, Cloudflare, Apple y Google **a nombre de la empresa** (no de Money Freak)
- [ ] Contrato entre socios (porcentajes, vesting, quién aporta capital)
- [ ] Permiso / marca blanca firmado **antes** de activar `modoDinero: 'real'`
