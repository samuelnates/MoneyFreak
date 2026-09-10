# Histórico de Ventas vs Inventario — Cole Collection

Herramienta para cargar el reporte mensual de ventas vs inventario (el
`.xlsx` que ya se arma cada mes), construir un histórico en base de datos
mes a mes, y consultarlo con gráficas y filtros — en vez de abrir un Excel
distinto cada vez. Vive dentro de este monorepo (`app-inventario/`) pero es
un producto aparte de Money Freak (`app-web/`): otro dominio de negocio, otro
público, aunque por defecto comparte el mismo proyecto de Supabase para no
tener que dar de alta infraestructura nueva (ver "Aislamiento de datos" abajo).

## Cómo está armado

```
Navegador (index.html, sin build step, JS plano)
   |
   |  fetch() con un Bearer token propio (no Supabase Auth)
   v
Edge Functions de Supabase (Deno)         <-- toda la lógica de negocio vive aquí
   - inventario-login      (palabra clave -> token con rol)
   - inventario-datos      (lectura: dashboard, histórico)
   - inventario-cargar     (validar + guardar una carga mensual)
   - inventario-alertas    (listar/resolver alertas)
   - inventario-usuarios   (administrar accesos)
   |
   |  service role key (RLS cerrado a anon/authenticated)
   v
Postgres (tablas inv_*)
```

El navegador nunca habla directo con Postgres ni con el anon key de
Supabase para leer/escribir estas tablas — todo pasa por las Edge
Functions, que son las únicas que tienen la service role key. Así el
control de "quién puede ver qué" y "quién puede cargar/editar" vive en un
solo lugar (las funciones), no repartido entre RLS y frontend.

### Por qué no Supabase Auth

Se pidió acceso por **palabra clave** (viewers y editores), no cuentas
individuales con correo. `inv_usuarios_acceso` guarda un hash sha-256 de la
palabra clave + un rol; `inventario-login` la valida y devuelve un token
propio (firmado con HMAC-SHA256, 12h de vigencia) que el navegador reenvía
como `Authorization: Bearer <token>` en cada llamada. Ver
`supabase/functions/_shared/auth.ts`.

**Importante al desplegar:** como el token no es un JWT emitido por
Supabase, las 5 Edge Functions deben desplegarse con `verify_jwt: false`
(si no, el gateway de Supabase rechaza el token antes de que llegue al
código). Ver "Desplegar" más abajo.

## Los tres puntos de extensión (el "sistema de plugins")

La idea es que la herramienta crezca con el uso sin tener que reescribir
nada de lo que ya funciona. Hay tres registros pensados para eso:

### 1. Formatos de reporte — `js/parser.js`

`FORMATOS_REPORTE` es un objeto `{ id: { detectar(workbook), parsear(workbook, nombreArchivo) } }`.
Hoy solo existe `cole-collection-v1` (pestañas `Rep <marca>` con bloques de
tiendas). Si el día de mañana cambia el layout del Excel, o llega un reporte
de otra fuente con otra estructura, se agrega un adaptador nuevo al
registro — `detectarFormato()` prueba cada uno hasta encontrar el que
reconoce el archivo, no hay que tocar la pantalla de carga ni el backend.

El parser actual ya es genérico dentro de su formato: detecta cualquier
cantidad de "bloques" de tiendas por pestaña de marca (tiendas propias,
Palacio de Hierro, ecommerce, etc.) buscando la fila que dice
"Uds Vendidas 26" en la columna B, sin asumir cuántos bloques hay. Si un
mes trae un bloque nuevo, no hace falta tocar el código.

### 2. Reglas de validación — `supabase/functions/_shared/validadores_inventario.ts`

`REGLAS_VALIDACION` es un arreglo de funciones puras `(fila, contexto) => Hallazgo[]`.
Hoy incluye:

| Regla | Qué detecta |
|---|---|
| `valores_negativos` | unidades/inventario/costos negativos (crítico) |
| `moi_fuera_de_rango` | meses de inventario > 36 o negativos |
| `variacion_vs_mes_anterior` | una tienda cambia >60% vs su propio mes anterior |
| `atipico_vs_tiendas_similares` | z-score > 2.5 contra las demás tiendas de la misma marca ese mes |
| `anio_vs_anio_extremo` | variación año contra año fuera de -60%/+300% |
| `porcentaje_fuera_de_escala` | margen/descuento que no parece estar en fracción (0.0–1.0) |

Todos los umbrales son constantes al principio del archivo (`UMBRAL_VARIACION_MENSUAL`,
`Z_SCORE_UMBRAL`, etc.) — se ajustan ahí según lo que la experiencia real
del negocio diga que sí es normal y qué no. Agregar una regla nueva es
sumar una función al arreglo `REGLAS_VALIDACION`, no reescribir las demás.
Las alertas se generan en modo *preview* (`dry_run: true`, sin guardar
nada) y otra vez al confirmar (ahí sí se guardan en `inv_alertas`).

### 3. Gráficas — `js/graficas.js`

Helpers reutilizables (`renderSerieMensualPorMarca`, `renderBarrasPorEtiqueta`)
sobre Chart.js con una paleta de colores fija por marca. Sumar una gráfica
nueva es agregar una función más en el mismo archivo y llamarla desde
`js/app.js`, sin tocar el resto del dashboard.

### Columnas nuevas sin migración: `extra` (jsonb)

`inv_metricas_tienda.extra` guarda cualquier campo que mande el parser y
que no tenga su propia columna. Si el reporte agrega una métrica nueva
algún mes, se puede sumar al parser y va directo a `extra` sin necesitar
una migración SQL — se le da su columna propia después, cuando se sepa que
llegó para quedarse.

## Roles

- **Viewer**: dashboard, histórico, alertas (solo lectura).
- **Editor**: todo lo anterior + cargar reportes, resolver alertas, y
  administrar usuarios (crear/desactivar palabras clave) desde la pestaña
  "Usuarios" de la propia app — no hace falta tocar SQL para dar de alta a
  alguien nuevo.

La migración crea un usuario editor semilla para poder entrar la primera
vez: palabra clave **`cole-collection-2026`**. Cámbiala apenas tengas
acceso (crea tu propio usuario editor desde "Usuarios" y desactiva el
semilla).

## Qué guarda hoy y qué queda para después

**Se modela completo** (una fila por tienda × periodo, historizada):
unidades vendidas, ventas/inventario en devolución, costo de ventas,
inventario, costo de inventario, MOI (uds/dev/costo), año vs año,
descuento y margen promedio de venta e inventario, precio promedio —
tanto del año actual como del año anterior tal como vienen en el reporte.
También CEDIS y tránsito por marca, y un backfill rápido de histórico
mensual a nivel marca si el archivo trae una pestaña tipo `graficas_julio`.

**Se guarda en crudo, sin modelar todavía** (`inv_cargas.resumen_bruto`,
jsonb): el contenido completo de la pestaña "Resumen" (traspasos abiertos,
detalle de CEDIS por marca, etc.) — está ahí para auditoría/consulta manual,
pero no tiene tablas ni gráficas propias aún. Es el ejemplo más claro de
"crece con el uso": cuando haga falta consultarlo seguido, se le agrega su
propia tabla (`inv_traspasos`, etc.) y un parser que lo extraiga, sin tocar
nada de lo que ya funciona.

## Desplegar

### 1. Aislamiento de datos

Por defecto (`config.js`) apunta al **mismo proyecto de Supabase** que
Money Freak (`app-web/`) — las tablas usan el prefijo `inv_` y no tienen
ninguna policy de RLS para `anon`/`authenticated`, así que no exponen ni
leen nada de las tablas de Money Freak. Es la opción más rápida para
arrancar. Si se prefiere un proyecto de Supabase totalmente aparte (otro
billing, otro equipo con acceso, cero relación con la app de finanzas
personales), se corre `supabase/migrations/` en un proyecto nuevo y se
cambian `SUPABASE_URL`/`SUPABASE_ANON_KEY` en `config.js` — el resto del
código no cambia.

### 2. Migración SQL

Corre `supabase/migrations/20260910000000_inventario_ventas.sql` contra el
proyecto de Supabase elegido (SQL Editor del dashboard, o
`POST /v1/projects/{ref}/database/query` de la Management API).

### 3. Secret de las Edge Functions

En el dashboard de Supabase → Edge Functions → Secrets (o vía Management
API), agrega:

```
INVENTARIO_JWT_SECRET = <una cadena aleatoria larga, ej. openssl rand -hex 32>
```

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` ya existen automáticamente en
cualquier Edge Function del proyecto.

### 4. Desplegar las Edge Functions

Las 5 carpetas bajo `supabase/functions/` (`inventario-login`,
`inventario-datos`, `inventario-cargar`, `inventario-alertas`,
`inventario-usuarios`), cada una **con `verify_jwt: false`** (ver nota de
arriba). Con el CLI de Supabase:

```
supabase functions deploy inventario-login --no-verify-jwt
supabase functions deploy inventario-datos --no-verify-jwt
supabase functions deploy inventario-cargar --no-verify-jwt
supabase functions deploy inventario-alertas --no-verify-jwt
supabase functions deploy inventario-usuarios --no-verify-jwt
```

(Si el CLI no logra conectar desde tu entorno, se puede desplegar cada
función directo por la Management API con `verify_jwt: false` en el body
del deploy — es lo que ya se ha usado en este repo para las funciones de
`app-web/`, ver `app-web/CONTEXTO_PROYECTO.md`.)

### 5. Frontend estático

`app-inventario/` es HTML/CSS/JS plano, sin build step — se sirve tal cual.
Más simple: un proyecto nuevo de Cloudflare Pages apuntando a esta carpeta
(subdominio propio, ej. `inventario.moneyfreak.app` o un dominio aparte —
es una decisión de negocio, no técnica). También funciona en cualquier otro
hosting estático (Vercel, Netlify, un bucket con hosting habilitado, etc.).

### 6. Primer login

Entra con la palabra clave semilla (`cole-collection-2026`), ve a
"Usuarios" y crea tu propio usuario editor con una palabra clave nueva;
después desactiva el usuario semilla.

## Uso mensual

1. **Editor** entra a "Cargar reporte", suelta el `.xlsx` del mes.
2. La app lo lee en el navegador (no sube el archivo original a ningún
   lado, solo los datos ya estructurados) y muestra una vista previa:
   advertencias de lectura (ej. "la suma de tiendas no cuadra con el total
   del archivo") y alertas de validación (atípicos vs. mes anterior, vs.
   tiendas similares, etc.).
3. Se revisan las alertas y se confirma la carga — ahí sí se guarda todo y
   queda disponible en el dashboard e histórico para viewers y editores.
4. Las alertas quedan abiertas en la pestaña "Alertas" hasta que alguien
   las marque como resueltas (una vez confirmado que el dato es real, no un
   error de captura).

Cargar el mismo periodo dos veces reemplaza los datos de las tiendas que
vengan en el archivo nuevo (upsert por tienda+periodo) — útil si hay que
corregir un archivo con un error después de cargarlo.
