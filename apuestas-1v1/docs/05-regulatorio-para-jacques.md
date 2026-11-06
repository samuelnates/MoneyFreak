# 05 · Checklist regulatorio (para Jacques)

> No es asesoría legal: es la lista de preguntas que el producto necesita que alguien con abogado resuelva. Todo lo marcado ❓ bloquea el paso a dinero real.

## Marco que aplica (México)

- **Ley Federal de Juegos y Sorteos** (1947) y su **Reglamento** (2004). Autoridad: **SEGOB – Dirección General de Juegos y Sorteos (DGJS)**.
- No existe un permiso específico "en línea": los operadores en línea trabajan bajo permisos para centros de apuestas remotas / libros foráneos, y la DGJS autoriza cada dominio. Varias fuentes reportan que parte del mercado opera con amparos.
- **IEPS** a juegos con apuesta: **50% desde el 1-ene-2026** (antes 30%), sobre ingresos menos premios; aplica también a operadores extranjeros si el usuario está en México.
- Retenciones a premios: ISR federal y impuesto estatal a premios (varía por estado).
- **PLD (Ley Antilavado)**: los juegos con apuesta son actividad vulnerable → registro ante el SAT/UIF, identificación de clientes, avisos por umbrales.
- **Datos personales**: LFPDPPP → aviso de privacidad; KYC con INE y biometría = datos sensibles.
- **Tiendas**: Apple App Store Review Guideline 5.3.3 y la política de juegos de Google Play exigen licencia y que publique la entidad licenciada.

## Preguntas a resolver

| # | Pregunta | Por qué importa |
|---|---|---|
| 1 | ❓ ¿Permiso propio o **marca blanca** con un permisionario? Costo de entrada, rev-share, plazo | Define capital necesario y tiempo al mercado |
| 2 | ❓ ¿Un exchange **P2P** (la casa no toma postura) cabe en el permiso de apuestas remotas? ¿Hay alguno operando así en México? | Nuestro modelo no es el de un sportsbook clásico |
| 3 | ❓ Base del **IEPS** en P2P: ¿"ingresos" = nuestra comisión, o el total apostado? | Si fuera el total apostado, el negocio no existe |
| 4 | ❓ ¿La comisión causa **IVA**? | Cambia ~14% del ingreso |
| 5 | ❓ ¿Quién retiene ISR / impuesto estatal al premio del ganador y sobre qué monto? | Cambia lo que mostramos como "recibes" |
| 6 | ❓ Requisitos PLD: umbrales de identificación, avisos, oficial de cumplimiento | Define cuándo pedir KYC |
| 7 | ❓ ¿Podemos operar el **modo demo** (fichas sin valor, sin premios en dinero) sin permiso? ¿Y premios en especie / rankings? | Es lo que lanzamos esta semana |
| 8 | ❓ Custodia del dinero de usuarios: ¿cuenta concentradora separada? ¿fideicomiso? | Confianza + posible requisito |
| 9 | ❓ Estructura: tipo de sociedad, socios, domicilio fiscal | Necesario para permiso, banco, Apple/Google |
| 10 | ❓ Términos y condiciones, juego responsable, autoexclusión, mayoría de edad | Requisito de tiendas y de permiso |

## Lo que el producto ya hace a favor del cumplimiento

- Mayoría de edad declarada en el registro (KYC real en fase 2).
- Modo demo explícito en toda la app, fichas sin valor.
- Libro mayor de partida doble inmutable y auditable (cada peso tiene origen y destino).
- La casa nunca toma postura (riesgo cero de contraparte).
- Pantalla de juego responsable; campos de autoexclusión y KYC ya existen en la base de datos.
- Solo eventos con resultado público; apuestas se cierran al inicio del evento.
