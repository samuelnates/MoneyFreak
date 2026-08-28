// Alcance completo de "borrar una cuenta" -- compartido entre eliminar-mi-cuenta
// (el usuario se borra a sí mismo) y admin-eliminar-usuario (un admin borra a
// otro usuario). Vivir en un solo lugar evita que las dos funciones se
// desincronicen si en el futuro se agrega una tabla nueva con datos de usuario
// y solo se actualiza una de las dos.
//
// Solo las tablas "padre" -- saldos, bienes_historico y deudas_historico se
// borran solas por ON DELETE CASCADE cuando se borran cuentas/bienes/deudas
// (confirmado en el esquema real), y `referidos` se borra sola por ON DELETE
// CASCADE directo desde auth.users. codigos_acceso_ia NO va aquí: es un
// catálogo compartido entre todos los usuarios, no datos de esta cuenta.
export const TABLAS_A_BORRAR = [
  "gastos",
  "transferencias",
  "presupuestos",
  "ingresos",
  "acciones",
  "score_historico",
  "patrimonio_historico",
  "deudas",
  "bienes",
  "cuentas",
  "accesos_ia_usuarios",
  "reportes_financieros",
  "solicitudes_gasto_pendientes",
  "perfil_financiero",
];
