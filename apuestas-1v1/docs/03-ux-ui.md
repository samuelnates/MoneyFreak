# 03 · UX / UI

## Principios

1. **Un reto se crea en 3 toques**: ¿quién gana? → ¿cuánto? → publicar. Todo lo demás es opcional.
2. **El dinero siempre visible y en claro**: "Si ganas recibes $380" antes de confirmar. La comisión se muestra, nunca se esconde.
3. **El amigo es el producto**: "Mandar a un amigo" es el botón más importante después de publicar. Un link abre el reto directo (y si no tiene cuenta, se registra y regresa al reto).
4. **Mobile-first, una mano**: navegación abajo, botón central "Retar", botones de 52 px de alto.
5. **Juego responsable visible**, no escondido: aviso de demo, mayoría de edad en el registro, sección propia en Perfil.

## Mapa de pantallas (implementado en `web/js/app.js`)

```
Bienvenida / registro ──► Inicio ─┬─► Evento ──► Crear reto (3 pasos) ──► Detalle de reto ──► Compartir
   (nombre, correo, +18)          │                                          ▲
                                  ├─► Retos esperando rival (carrusel) ──────┘ (Aceptar)
                                  │
 Nav inferior: Inicio · Mis retos · [ + Retar ] · Billetera · Perfil
                       │                          │            ├─► Juego responsable
                       ├ Activos / Historial      ├ Saldo     ├─► Cambiar de cuenta (demo)
                       └ ganados/jugados          ├ Custodia  └─► Panel de la casa (admin)
                                                  └ Movimientos      ├ KPIs (comisión, volumen, emparejamiento, cuadre)
                                                                     ├ Resolver eventos
                                                                     └ Crear evento
```

## Flujo principal: retar a un amigo

| # | Pantalla | Lo que ve / hace | Por qué |
|---|---|---|---|
| 1 | Inicio | Toca "Retar" en *América vs Chivas* | Eventos cercanos primero |
| 2 | Crear · paso 1 | Toca **América** (tarjeta grande) | Elegir lado es emocional, va primero |
| 3 | Crear · paso 2 | Chip **$200** (o escribe monto) | Chips = menos fricción |
| 4 | Crear · paso 3 | "Lo mismo (parejo)" por defecto; "Otro monto" para dar momio | Momio propio sin explicar decimales |
| 5 | Resumen | Bote $400 · Comisión −$20 · **Si ganas recibes $380** | Transparencia total |
| 6 | Detalle | Cara a cara Tú vs "?" + botón **Mandar a un amigo** (share nativo / WhatsApp) | Convierte cada reto en adquisición |
| 7 | Amigo abre link | Se registra (si hace falta) → vuelve al reto → **Aceptar reto · pongo $200** | Cero pasos perdidos |
| 8 | Resultado | Tarjeta con borde verde al ganador; "Ganaste $380" en Mis retos | Cierre claro + revancha (fase 1) |

## Estados de un reto (etiquetas en UI)

| Estado técnico | Etiqueta | Color |
|---|---|---|
| abierto | Esperando rival | verde suave |
| emparejado | En juego | ámbar |
| liquidado | Liquidado + "Ganaste $X" / "Perdiste" | neutro / verde / rojo |
| cancelado | Cancelado | gris |
| expirado | Sin rival · reembolsado | gris |
| anulado | Anulado · reembolsado | gris |

## Sistema de diseño (tokens en `web/css/estilos.css`)

| Token | Oscuro | Claro | Uso |
|---|---|---|---|
| `--bg` | #0b0f14 | #f4f6f9 | Fondo |
| `--superficie` | #141a22 | #ffffff | Tarjetas |
| `--acento` | #3cff8f | #00b85c | Ganar, botón principal, marca |
| `--vivo` | #ffb020 | — | En juego, aviso demo |
| `--peligro` | #ff5c6c | — | Cancelar, perder, errores |
| `--radio` | 16 px | | Tarjetas y botones |

- Tipografía: Inter (400/600/800), números tabulares en montos.
- Modo oscuro y claro automáticos según el sistema.
- Respeta `prefers-reduced-motion` y las zonas seguras del iPhone (notch, barra inferior).
- La marca vive en `web/js/config.js` (nombre temporal **DUELO**) + los tokens de color: renombrar = 2 archivos.

## Siguiente iteración de UX (fase 1)

- **Revancha** con un toque al terminar un reto (palanca #1 de frecuencia).
- **Grupos / ligas de amigos** con tabla semanal.
- Notificaciones push: "Beto aceptó tu reto", "Empieza en 15 min", "Ganaste".
- Login con Google/Apple (ya resuelto en Money Freak, reutilizable).
- Límites de depósito y autoexclusión funcionales.
- Onboarding de 3 tarjetas explicando la custodia (genera confianza: "la casa no puede quedarse con tu dinero").
