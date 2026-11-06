# 02 · Cómo funciona el negocio y estado de resultados

> Modelo reproducible: `finanzas/modelo.py` (hipótesis al inicio del archivo). Cambia un número, corre `python3 finanzas/modelo.py` y se recalcula todo. Cifras en **pesos mexicanos**, mensuales, año 1.

## 1. Cómo gana dinero un exchange 1 vs 1

**Ingreso = volumen apostado × tasa de comisión.**

- Volumen (handle) = suma de lo que ponen ambos lados en retos **emparejados**.
- Un reto sin rival no genera nada (se reembolsa). La métrica clave es la **tasa de emparejamiento**.
- Referencias de mercado: Betfair cobra ~5% de la ganancia neta, Smarkets 2%. Una casa tradicional retiene ~5–10% de lo apostado vía momios. Nosotros cobramos **un % del bote total** (más simple de explicar en pantalla: "si ganas recibes $X").

| Tasa sobre el bote | Equivale a, sobre la ganancia del ganador | Comentario |
|---|---|---|
| 5% | 10% | Competitivo contra casas tradicionales |
| 8% | 16% | Más caro, pero sigue siendo transparente; el modelo indica que hace falta |

## 2. Costos que sí o sí existen

| Concepto | Hipótesis | Fuente / comentario |
|---|---|---|
| **IEPS juegos con apuesta** | **50%** de (ingresos − premios) ≈ 50% de nuestra comisión | Subió de 30% a 50% desde el 1-ene-2026 (Paquete Económico 2026). **Jacques: confirmar la base para un modelo P2P** |
| IVA | 16% (asumido dentro de la comisión) | Confirmar con contador si aplica o es exento |
| Licencia (marca blanca) | 15% de rev-share + $30,000/mes | Hipótesis; operar con un permisionario SEGOB existente. **Jacques cotiza** |
| Pagos | Tarjeta ~3.5% · OXXO ~3% · SPEI ~$5–8 por operación | SPEI-first baja el costo de 2.5% a ~1% de depósitos |
| Fraude / contracargos | 0.5% de depósitos | Sobre todo con tarjeta |
| KYC | $12–30 por usuario verificado | Solo verificar al primer retiro (no al registrarse) abarata mucho |
| Datos deportivos | $4,000/mes | Planes de API-Football / The Odds API; Sportradar es mucho más caro |
| Infraestructura | $2,500/mes | Supabase Pro + Cloudflare + correo. Escala lento |
| Legal + contable | $25,000/mes | PLD, declaraciones de IEPS, contratos |
| Soporte | $8,000/mes | Medio tiempo |
| Marketing (CAC) | $150–250 por usuario activo nuevo | Apuestas en LatAm es de los CAC más caros; los referidos ("reta a un amigo") son el canal barato |
| Sueldos de fundadores | $0 en año 1 | Supuesto explícito |
| Comisión Apple/Google | 0% | Apuestas con dinero real no usan compras in-app |

## 3. Estado de resultados — escenario **base** (12 meses)

Supuestos del escenario base: comisión 8% del bote, apuesta promedio $250 por lado, 8 retos/usuario/mes, depósitos = 30% del volumen (el dinero se recicla), pagos 1% (SPEI-first), KYC $12, churn 25% mensual, CAC $200.

| Concepto | Mes 1 | Mes 6 | Mes 12 | Año 1 |
|---|---:|---:|---:|---:|
| Usuarios activos | 150 | 1,600 | 5,200 | — |
| Volumen apostado (handle) | 300,000 | 3,200,000 | 10,400,000 | 52,700,000 |
| Comisión bruta (8% del bote) | 24,000 | 256,000 | 832,000 | 4,216,000 |
| (−) IVA trasladado | 3,310 | 35,310 | 114,759 | 581,517 |
| **= Ingreso neto** | **20,690** | **220,690** | **717,241** | **3,634,483** |
| (−) IEPS 50% | 10,345 | 110,345 | 358,621 | 1,817,241 |
| (−) Rev-share licencia 15% | 1,552 | 16,552 | 53,793 | 272,586 |
| (−) Procesamiento de pagos | 1,800 | 19,200 | 62,400 | 316,200 |
| (−) Fraude / contracargos | 450 | 4,800 | 15,600 | 79,050 |
| (−) Bonos y promociones | 1,440 | 15,360 | 49,920 | 252,960 |
| (−) Verificación de identidad | 1,800 | 8,400 | 21,900 | 125,850 |
| **= Margen de contribución** | **3,303** | **46,033** | **155,008** | **770,595** |
| (−) Marketing / adquisición | 30,000 | 140,000 | 365,000 | 2,097,500 |
| (−) Gastos fijos | 71,000 | 71,000 | 71,000 | 852,000 |
| **= EBITDA** | **−97,697** | **−164,967** | **−280,992** | **−2,178,905** |

## 4. Tres escenarios

| Escenario | Comisión / usuario / mes | Margen contrib. / usuario / mes | EBITDA mes 12 | EBITDA año 1 | Inversión máx. requerida | Equilibrio operativo* | LTV / CAC |
|---|---:|---:|---:|---:|---:|---:|---:|
| Conservador (5%, tarjeta, KYC a todos) | $75 | **−$16** | −665,912 | −4,190,568 | 4.2 M | no existe | −0.2x |
| Base (8%, SPEI-first) | $160 | $30 | −280,992 | −2,178,905 | 2.2 M | 2,382 usuarios | 0.6x |
| Optimista (8%, 12 retos/mes, $300) | $288 | $70 | +51,570 | −445,116 | 0.5 M | 1,018 usuarios | 2.3x |

\* Usuarios activos para cubrir gastos fijos, sin contar marketing.

## 5. Lo que dicen los números (léanlo los cuatro)

1. **Con 5% de comisión y pagos con tarjeta, el negocio pierde dinero por cada usuario** — antes de gastar un peso en marketing. El IEPS de 50% se lleva la mitad del ingreso neto y los pagos/KYC el resto.
2. Las palancas que lo vuelven viable, en orden de impacto:
   - **Frecuencia**: retos por usuario al mes. Es la variable más poderosa (≈ lineal en ingreso, casi sin costo extra). Diseñar para la recurrencia: ligas semanales, revanchas con un toque, grupos de amigos.
   - **Tasa de comisión** 7–8% en vez de 5%.
   - **SPEI primero**, tarjeta solo como opción secundaria.
   - **KYC solo al retirar** (muchos usuarios nunca retiran).
   - **CAC bajo vía referidos**: cada reto enviado por WhatsApp es adquisición gratis. Un LTV/CAC < 1 significa que pagar publicidad destruye dinero.
3. Necesitan **~$0.5–2.2 M MXN de capital** para el año 1 si se va a dinero real, *más* el costo de la licencia, que es la gran incógnita.
4. La fase demo (fichas sin valor) cuesta casi nada (~$5k/mes en infraestructura + dominio) y sirve para medir lo único que importa antes de invertir: **¿cuántos retos por semana hace un usuario y qué % encuentra rival?**

## 6. KPIs a medir desde el día 1 del MVP

| KPI | Meta para seguir invirtiendo |
|---|---|
| Tasa de emparejamiento (retos aceptados / creados) | > 60% |
| Tiempo hasta encontrar rival | < 2 h |
| Retos por usuario activo por semana | ≥ 2 |
| % de retos que llegan por link de amigo | > 50% |
| Invitados que se registran por cada usuario | ≥ 1 (crecimiento viral) |
| Retención semana 4 | > 30% |

Fuentes consultadas (noviembre 2026): [SIGMA — IEPS apuestas en línea 2026](https://sigma.world/es/news/mexico-impuesto-apuestas-en-linea-2026/), [Focus Gaming News — Senado aprueba aumento IEPS](https://focusgn.com/latinoamerica/el-senado-mexicano-avanza-con-el-aumento-del-ieps-al-juego-online), [Yogonet — del 30% al 50%](https://www.yogonet.com/latinoamerica/noticias/2025/10/16/106267-mexico-la-camara-de-diputados-inicia-el-debate-sobre-la-suba-del-impuesto-a-las-apuestas), [Gamblingmaps — cómo obtener licencia en México](https://gamblingmaps.org/es/regulacion/mexico/operadores/como-obtener-licencia), [Racing Post — comisiones Betfair](https://racingpost.com/news/britain/betfair-exchange-to-introduce-new-commission-system-for-2025-as-premium-charge-is-dropped-a7wbg0v4GCAJ). Cifras de costos de proveedores son estimaciones de mercado: confirmar con cotizaciones reales.
