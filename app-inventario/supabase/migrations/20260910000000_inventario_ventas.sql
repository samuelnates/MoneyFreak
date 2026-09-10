-- =========================================================================
-- Herramienta de Histórico de Ventas vs Inventario (Cole Collection)
-- =========================================================================
-- Vive en el mismo proyecto de Supabase que Money Freak (app-web/), pero
-- totalmente aislada: todas las tablas usan el prefijo inv_ y NO tienen
-- policies de RLS para anon/authenticated (RLS queda encendido con cero
-- policies = acceso directo denegado siempre). Todo el acceso pasa por las
-- Edge Functions de app-inventario/, que usan la service role key y validan
-- su propio token firmado (no Supabase Auth: acceso por palabra clave,
-- ver inv_usuarios_acceso).
--
-- Si más adelante se prefiere aislar esto en un proyecto de Supabase propio,
-- este archivo se puede correr tal cual ahí — no depende de ninguna tabla
-- existente de Money Freak.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Catálogo: marcas y tiendas (se auto-crean al cargar un reporte nuevo,
-- no hace falta darlas de alta a mano antes de la primera carga).
-- ---------------------------------------------------------------------

create table if not exists public.inv_marcas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,        -- 'TR', 'JS', 'LO', 'RY', 'VM' (código de la pestaña, ej. "Rep TR")
  nombre text not null,               -- 'TRUE RELIGION' (tal como viene en A2 de la pestaña)
  orden int not null default 0,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

create table if not exists public.inv_tiendas (
  id uuid primary key default gen_random_uuid(),
  marca_id uuid not null references public.inv_marcas(id) on delete cascade,
  canal text not null default 'tiendas',   -- nombre del bloque de origen: 'tiendas', 'tiendas ph', 'ecomm ph', etc.
  codigo text not null,                    -- nombre tal cual viene en columna A, ej. 'TR ECOMMERCE'
  nombre text not null,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  unique (marca_id, canal, codigo)
);

-- ---------------------------------------------------------------------
-- Periodos (un mes calendario) y cargas (cada archivo subido = una carga).
-- ---------------------------------------------------------------------

create table if not exists public.inv_periodos (
  id uuid primary key default gen_random_uuid(),
  anio int not null,
  mes int not null check (mes between 1 and 12),
  etiqueta text not null,             -- 'AGOSTO 2026', tal como viene en el archivo
  fecha date not null,                -- primer día del mes, para ordenar/graficar
  creado_en timestamptz not null default now(),
  unique (anio, mes)
);

create table if not exists public.inv_cargas (
  id uuid primary key default gen_random_uuid(),
  periodo_id uuid not null references public.inv_periodos(id),
  archivo_nombre text,
  cargado_por text,                   -- nombre del usuario editor (inv_usuarios_acceso.nombre)
  formato text not null default 'cole-collection-v1',  -- id del parser/adaptador usado (ver js/parser.js)
  estado text not null default 'procesando'
    check (estado in ('procesando', 'con_alertas', 'aprobada', 'revertida')),
  total_filas int not null default 0,
  total_alertas int not null default 0,
  resumen_bruto jsonb not null default '{}'::jsonb,   -- snapshot de bloques no modelados aún (ej. pestaña Resumen completa), para auditoría/futuras extensiones
  creado_en timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Hecho principal: una fila por tienda x periodo x carga vigente.
-- Recargar el mismo periodo para la misma tienda hace upsert (la carga
-- anterior de ese periodo se marca 'revertida', ver inventario-cargar).
-- ---------------------------------------------------------------------

create table if not exists public.inv_metricas_tienda (
  id uuid primary key default gen_random_uuid(),
  carga_id uuid not null references public.inv_cargas(id) on delete cascade,
  periodo_id uuid not null references public.inv_periodos(id),
  tienda_id uuid not null references public.inv_tiendas(id),
  marca_id uuid not null references public.inv_marcas(id),

  uds_vendidas_actual numeric, uds_vendidas_anterior numeric,
  vta_dev_actual numeric, vta_dev_anterior numeric,
  costo_ventas_actual numeric, costo_ventas_anterior numeric,
  inventario_actual numeric, inventario_anterior numeric,
  inv_dev_actual numeric, inv_dev_anterior numeric,
  costo_inv_actual numeric, costo_inv_anterior numeric,
  moi_uds_actual numeric, moi_dev_actual numeric, moi_cto_actual numeric,
  moi_uds_anterior numeric, moi_dev_anterior numeric, moi_cto_anterior numeric,
  anio_vs_anio numeric,
  desc_prom_vta_actual numeric, desc_prom_vta_anterior numeric,
  margen_prom_vta_actual numeric, margen_prom_vta_anterior numeric,
  desc_prom_inv_actual numeric, desc_prom_inv_anterior numeric,
  margen_prom_inv_actual numeric, margen_prom_inv_anterior numeric,
  pp_vta_actual numeric, pp_vta_anterior numeric,

  extra jsonb not null default '{}'::jsonb,  -- columnas futuras del reporte sin necesidad de migración
  creado_en timestamptz not null default now(),
  unique (periodo_id, tienda_id)
);

create table if not exists public.inv_cedis_transito (
  id uuid primary key default gen_random_uuid(),
  carga_id uuid not null references public.inv_cargas(id) on delete cascade,
  periodo_id uuid not null references public.inv_periodos(id),
  marca_id uuid not null references public.inv_marcas(id),
  tipo text not null check (tipo in ('cedis', 'transito')),
  anio int not null,
  inventario numeric,
  dev_ex_inv numeric,
  costo_total_inv numeric,
  creado_en timestamptz not null default now(),
  unique (periodo_id, marca_id, tipo, anio)
);

-- Backfill rápido de historia mensual a nivel marca, tomado de pestañas
-- históricas tipo "graficas_julio" (Marca/Mes/2026/2025/2024 por costo de
-- inventario). No sustituye inv_metricas_tienda (que es detalle por
-- tienda) — es un atajo para tener años de historia desde la primera carga.
create table if not exists public.inv_historico_marca_mensual (
  id uuid primary key default gen_random_uuid(),
  marca_id uuid not null references public.inv_marcas(id) on delete cascade,
  anio int not null,
  mes int not null check (mes between 1 and 12),
  costo_inventario numeric,
  fuente text not null default 'backfill',   -- 'backfill' (pestaña histórica) | 'carga' (agregado de inv_metricas_tienda)
  carga_id uuid references public.inv_cargas(id) on delete set null,
  creado_en timestamptz not null default now(),
  unique (marca_id, anio, mes, fuente)
);

-- ---------------------------------------------------------------------
-- Validaciones (motor de reglas, ver _shared/validadores_inventario.ts)
-- ---------------------------------------------------------------------

create table if not exists public.inv_alertas (
  id uuid primary key default gen_random_uuid(),
  carga_id uuid references public.inv_cargas(id) on delete cascade,
  periodo_id uuid references public.inv_periodos(id),
  tienda_id uuid references public.inv_tiendas(id),
  marca_id uuid references public.inv_marcas(id),
  regla text not null,                -- id de la regla (ver REGLAS_VALIDACION)
  severidad text not null check (severidad in ('info', 'advertencia', 'critica')),
  campo text,
  valor_actual numeric,
  valor_referencia numeric,
  mensaje text not null,
  resuelta boolean not null default false,
  resuelta_por text,
  resuelta_en timestamptz,
  creado_en timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Acceso: palabra clave -> rol (viewer/editor). Sin Supabase Auth.
-- ---------------------------------------------------------------------

create table if not exists public.inv_usuarios_acceso (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  rol text not null check (rol in ('viewer', 'editor')),
  palabra_clave_hash text not null unique,   -- sha-256 hex de la palabra clave, ver _shared/auth.ts. unique: evita ambigüedad si dos personas eligen la misma.
  activo boolean not null default true,
  ultimo_acceso timestamptz,
  creado_por text,
  creado_en timestamptz not null default now()
);

create table if not exists public.inv_auditoria (
  id uuid primary key default gen_random_uuid(),
  usuario text,
  rol text,
  accion text not null,               -- 'login' | 'carga' | 'resolver_alerta' | 'crear_usuario' | 'desactivar_usuario'
  detalle jsonb not null default '{}'::jsonb,
  creado_en timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- RLS encendido, sin policies: cierra el paso a anon/authenticated. Solo
-- la service role key (usada exclusivamente dentro de las Edge Functions)
-- puede leer/escribir.
-- ---------------------------------------------------------------------

alter table public.inv_marcas enable row level security;
alter table public.inv_tiendas enable row level security;
alter table public.inv_periodos enable row level security;
alter table public.inv_cargas enable row level security;
alter table public.inv_metricas_tienda enable row level security;
alter table public.inv_cedis_transito enable row level security;
alter table public.inv_historico_marca_mensual enable row level security;
alter table public.inv_alertas enable row level security;
alter table public.inv_usuarios_acceso enable row level security;
alter table public.inv_auditoria enable row level security;

create index if not exists idx_inv_metricas_periodo on public.inv_metricas_tienda(periodo_id);
create index if not exists idx_inv_metricas_tienda on public.inv_metricas_tienda(tienda_id);
create index if not exists idx_inv_metricas_marca on public.inv_metricas_tienda(marca_id);
create index if not exists idx_inv_cedis_transito_periodo on public.inv_cedis_transito(periodo_id);
create index if not exists idx_inv_historico_marca on public.inv_historico_marca_mensual(marca_id, anio, mes);
create index if not exists idx_inv_alertas_carga on public.inv_alertas(carga_id);
create index if not exists idx_inv_alertas_resuelta on public.inv_alertas(resuelta) where not resuelta;
create index if not exists idx_inv_usuarios_activo on public.inv_usuarios_acceso(activo);

-- ---------------------------------------------------------------------
-- Primer usuario editor, para poder entrar la primera vez. CAMBIA esta
-- palabra clave apenas tengas acceso (Configuración -> Usuarios) y borra
-- o desactiva esta fila semilla.
-- Palabra clave semilla: "cole-collection-2026" (hash sha-256 de ese texto).
-- ---------------------------------------------------------------------

insert into public.inv_usuarios_acceso (nombre, rol, palabra_clave_hash, creado_por)
values (
  'Administrador inicial',
  'editor',
  encode(digest('cole-collection-2026', 'sha256'), 'hex'),
  'migración inicial'
)
on conflict do nothing;
