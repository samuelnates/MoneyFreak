// Mismo proyecto de Supabase que app-web/ (Money Freak) por defecto — las
// tablas de este tablero viven aisladas con el prefijo inv_ y sin RLS para
// anon/authenticated (ver supabase/migrations/), así que compartir proyecto
// no expone nada de un lado al otro. Si más adelante se prefiere aislarlo
// del todo, solo hay que cambiar esta URL/llave a un proyecto de Supabase
// nuevo y correr las migraciones de app-inventario/supabase/ ahí.
window.SUPABASE_URL = "https://vtjljpwcyiaaaqbqstvj.supabase.co";
window.SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0amxqcHdjeWlhYWFxYnFzdHZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzMDUyODMsImV4cCI6MjA5OTg4MTI4M30.Uudd19tjIviKMPEf1oL_UOguineAgyQELCAhi_uhCH4";

// Base de las Edge Functions propias de este tablero (inventario-login,
// inventario-datos, inventario-cargar, inventario-alertas, inventario-usuarios).
window.INVENTARIO_FUNCTIONS_BASE = `${window.SUPABASE_URL}/functions/v1`;

window.INVENTARIO_NOMBRE_EMPRESA = "Cole Collection";
