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

**Gasto acumulado confirmado:** 224 créditos ($1.12) del draft de vídeo, más el costo aún
no capturado de la imagen de referencia (probablemente unos pocos créditos, GPT Image 2 en
2K no es gratis pero es bastante más barato que 8s de vídeo).

**Saldo estimado restante:** ~776 créditos (~$3.88), sin contar lo gastado en la imagen.

**Ojo con el presupuesto:** el draft de 8s en 480p (la resolución y duración más baratas
del modelo) ya se comió ~22% del saldo cargado. Ir a la versión final en 720p/15s va a
costar bastante más — antes de lanzarla hay que confirmar que el resultado convence, porque
un segundo intento fallido ahí sí duele.

## Cómo se actualiza este archivo

Cada llamada real (no `--dry-run`) a `genmedia.py` con `--json` devuelve `credits_consumed`
cuando el proveedor lo reporta. Después de cada generación exitosa, se añade una fila a la
tabla de arriba con ese número y se resta del saldo estimado.
