// Catálogo de categorías/subcategorías de gasto y ejemplos de clasificación,
// compartidos entre las Edge Functions que interpretan gastos con IA
// (procesar-solicitud-gasto, preguntar-sobre-app). Debe coincidir con
// CATALOGO_GASTOS en index.html — no hay paso de build que lo comparta con
// el cliente, así que cualquier cambio aquí hay que replicarlo ahí a mano.

export const CATALOGO_GASTOS: Record<string, string[]> = {
  "Vivienda": ["Renta o hipoteca", "Mantenimiento", "Servicios (luz, agua, gas)", "Muebles y enseres", "Empleada del hogar"],
  "Transporte": ["Gasolina", "Transporte público", "Uber / taxi", "Mantenimiento del auto", "Estacionamiento", "Crédito de auto"],
  "Alimentación": ["Súper", "Restaurantes", "Café y antojos"],
  "Salud": ["Consultas médicas", "Medicinas", "Seguro médico", "Dental"],
  "Entretenimiento": ["Streaming", "Cine y eventos", "Salidas", "Hobbies", "Vacaciones"],
  "Educación": ["Colegiaturas", "Cursos", "Libros y material"],
  "Cuidado personal": ["Ropa", "Belleza y estética", "Gimnasio"],
  "Mascotas": ["Comida", "Veterinario", "Accesorios"],
  "Servicios y suscripciones": ["Teléfono e internet", "Apps y software", "Otras suscripciones"],
  "Ahorro e inversión": ["Aportación a inversión", "Fondo de emergencia"],
  "Otros": ["Regalos", "Imprevistos", "Varios"],
};

export const CATEGORIAS_VALIDAS = Object.keys(CATALOGO_GASTOS);

// Ejemplos concretos para anclar la clasificación — sin esto el modelo tiende
// a adivinar categorías genéricas o equivocarse entre subcategorías parecidas.
export const EJEMPLOS_CATEGORIZACION = `Ejemplos de cómo clasificar (categoría → subcategoría):
- "tacos", "fui a comer", "restaurante", "pizza" → Alimentación → Restaurantes
- "súper", "walmart", "soriana", "despensa", "chedraui" → Alimentación → Súper
- "café", "starbucks", "antojo" → Alimentación → Café y antojos
- "gasolina", "cargué gasolina", "pemex" → Transporte → Gasolina
- "uber", "didi", "taxi" → Transporte → Uber / taxi
- "renta", "hipoteca" → Vivienda → Renta o hipoteca
- "luz", "agua", "gas", "recibo de servicios" → Vivienda → Servicios (luz, agua, gas)
- "netflix", "spotify", "disney plus", "suscripción" → Servicios y suscripciones → Otras suscripciones
- "internet", "teléfono", "plan celular" → Servicios y suscripciones → Teléfono e internet
- "gimnasio", "gym" → Cuidado personal → Gimnasio
- "ropa", "zapatos" → Cuidado personal → Ropa
- "medicina", "farmacia", "doctor", "consulta" → Salud → Medicinas o Consultas médicas según aplique
- "cine", "boleto", "concierto" → Entretenimiento → Cine y eventos
- "colegiatura", "escuela" → Educación → Colegiaturas`;

export type MedioPagoDisponible = { valor: string; etiqueta: string };

// Compartido por cualquier función que reciba una "fecha sugerida" por un
// modelo de IA y la vaya a usar en una columna `date` de Postgres. El modelo
// no siempre respeta el formato pedido (se vio en producción: devolvió el
// string literal "/null" en vez de null, y otra vez "hoy" en vez de una
// fecha real) -- eso rompe el insert con un error críptico de Postgres
// ("invalid input syntax for type date"). Nunca usar la fecha sugerida sin
// pasar por aquí primero.
export function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function fechaValidaOAhora(valor: string | null | undefined): string {
  if (valor && /^\d{4}-\d{2}-\d{2}$/.test(valor) && !isNaN(new Date(valor).getTime())) return valor;
  return hoyISO();
}
