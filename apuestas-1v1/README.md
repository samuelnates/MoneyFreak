# DUELO (nombre temporal) — apuestas 1 vs 1

Plataforma donde dos personas apuestan entre sí sobre un evento; la casa guarda el bote en custodia y cobra una comisión. **MVP en modo demo (fichas sin valor real).**

Socios: Samuel (producto/tech) · Jacques (regulatorio) · Eduardo e Itai (distribución, marketing, redes).

| Documento | Para quién |
|---|---|
| [01 · Arquitectura](docs/01-arquitectura.md) | Todos / tech |
| [02 · Negocio y estado de resultados](docs/02-negocio-y-estado-de-resultados.md) | Todos — **léanlo antes de poner dinero** |
| [03 · UX / UI](docs/03-ux-ui.md) | Producto, marketing |
| [04 · Plan del MVP y roles](docs/04-plan-mvp-y-roles.md) | Todos |
| [05 · Checklist regulatorio](docs/05-regulatorio-para-jacques.md) | Jacques |

```
apuestas-1v1/
├── web/                  PWA (HTML/CSS/JS sin build) — se empaqueta para iOS/Android con Capacitor
│   ├── js/motor.js       reglas de dinero (partida doble, escrow, comisión) — sin DOM
│   ├── js/almacen.js     persistencia (hoy localStorage; mañana Supabase)
│   ├── js/app.js         pantallas y router
│   ├── js/config.js      marca y modo demo/real
│   └── css/estilos.css   design tokens + componentes
├── supabase/migrations/  esquema Postgres + RLS + RPCs de dinero
├── supabase/pruebas/     prueba del esquema en Postgres local
├── finanzas/modelo.py    estado de resultados (3 escenarios)
└── tests/                tests del motor (node --test)
```

```bash
npm test          # 7 tests del motor
npm run dev       # http://localhost:5173
python3 finanzas/modelo.py
```

Probar el esquema SQL en un Postgres local:
```bash
createdb t1v1
psql -d t1v1 -f supabase/pruebas/stub_supabase.sql -f supabase/migrations/001_esquema.sql
psql -d t1v1 -f supabase/pruebas/prueba_flujo.sql   # debe terminar en "TODO OK"
```
