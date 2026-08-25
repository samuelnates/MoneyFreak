# Gastos de generación de imagen/vídeo con IA (Kie.ai / fal.ai)

Registro del gasto real en la skill `ai-media-gen` (Kie.ai como proveedor principal,
fal.ai como respaldo). Un intento rechazado por el proveedor antes de generar (error de
parámetros, de aspect ratio, de crédito insuficiente, de política de contenido) **no
consume crédito** — solo cuenta lo que sí llegó a generarse.

## Saldo cargado

| Fecha | Cargado | Créditos | Equivalencia |
|---|---|---|---|
| 2026-08-25 | $5.00 USD | 1000 | 1 crédito ≈ $0.005 USD |

## Gasto por generación

| Fecha | Qué | Modelo | Proveedor | Resultado | Créditos | Costo est. |
|---|---|---|---|---|---|---|
| 2026-08-25 | Imagen de referencia de Freaky (alta calidad, sin recorte) | gpt-image-2 | kie | ✅ éxito | *no capturado* | *pendiente* |
| 2026-08-25 | Draft vídeo presentación Freaky (intento 1, 9:16 fijo) | seedance-2.5 | kie | ❌ rechazado (HTTP 422, aspect ratio) | 0 | $0 |
| 2026-08-25 | Draft vídeo presentación Freaky (intento 1, fallback) | seedance-2.5 | fal | ❌ rechazado (política de contenido, parecido a persona real) | 0 | $0 |
| 2026-08-25 | Draft vídeo presentación Freaky (intento 2, aspect auto) | seedance-2.5 | kie | ❌ rechazado (HTTP 402, sin crédito) | 0 | $0 |
| 2026-08-25 | Draft vídeo presentación Freaky (intento 3, 8s/480p, exitoso) | seedance-2.5 | kie | ✅ éxito | 224 | $1.12 |
| 2026-08-25 | Vídeo final presentación Freaky (15s/720p) | seedance-2.5 | kie | ❌ rechazado (HTTP 402, sin crédito) | 0 | $0 |
| 2026-08-25 | Vídeo final presentación Freaky (12s/720p, exitoso) | seedance-2.5 | kie | ✅ éxito | 756 | $3.78 |

**Gasto acumulado confirmado:** 980 créditos ($4.90) entre el draft (224) y el vídeo final
(756), más el costo aún no capturado de la imagen de referencia.

**Saldo estimado restante:** ~20 créditos (~$0.10) — prácticamente agotado.

**Lección de precio real:** 720p resultó ~2.25x más caro por segundo que 480p (63
créditos/s vs 28 créditos/s). El vídeo de 12s en 720p costó más que toda la carga inicial
menos el draft. Si se necesita más contenido en esta calidad, hay que recargar de nuevo
antes de seguir.

## Cómo se actualiza este archivo

Cada llamada real (no `--dry-run`) a `genmedia.py` con `--json` devuelve `credits_consumed`
cuando el proveedor lo reporta. Después de cada generación exitosa, se añade una fila a la
tabla de arriba con ese número y se resta del saldo estimado.
