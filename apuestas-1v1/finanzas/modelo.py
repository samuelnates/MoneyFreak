"""Modelo de estado de resultados — 12 meses, MXN. Todas las hipótesis arriba.
Correr: python3 modelo.py  (imprime tabla markdown y escribe resultados.json)"""
import json

H = dict(
    usuarios_activos=[150, 300, 550, 850, 1200, 1600, 2100, 2700, 3300, 3900, 4500, 5200],  # MAU
    churn_mensual=0.30,           # % de activos que se van cada mes
    retos_por_usuario=6,          # retos emparejados en los que participa cada activo al mes
    apuesta_promedio=250,         # MXN que pone cada lado
    tasa_comision=0.05,           # % del bote
    iva=0.16,                     # se asume incluido en la comisión (confirmar)
    ieps=0.50,                    # IEPS juegos con apuesta 2026, base = ingresos − premios (≈ comisión)
    deposito_vs_volumen=0.40,     # depósitos nuevos / volumen apostado (el dinero se recicla)
    costo_pago=0.025,             # mezcla SPEI/tarjeta/OXXO sobre depósitos
    fraude_contracargos=0.005,    # sobre depósitos
    costo_retiro=6,               # MXN por retiro SPEI; 1 retiro por activo al mes
    kyc_por_usuario_nuevo=30,     # MXN (~1.5 USD) verificación INE + selfie
    cac=250,                      # MXN por usuario activo nuevo (paid + referidos)
    promos_vs_comision=0.10,      # bonos/promos como % de la comisión
    revshare_licencia=0.15,       # % de comisión neta al permisionario (marca blanca)
    fijos=dict(
        licencia_fija=30000,      # renta mensual marca blanca (hipótesis)
        legal_contable=25000,
        datos_deportivos=4000,    # API de resultados/calendario
        infraestructura=2500,     # Supabase Pro + Cloudflare + correo + monitoreo
        soporte=8000,             # medio tiempo
        herramientas=1500,        # dominios, Apple $99/año, Google $25, diseño, etc. prorrateado
    ),
)

ESCENARIOS = {
    'conservador': {},
    'base': dict(tasa_comision=0.08, costo_pago=0.010, deposito_vs_volumen=0.30, kyc_por_usuario_nuevo=12,
                 churn_mensual=0.25, retos_por_usuario=8, promos_vs_comision=0.06, cac=200),
    'optimista': dict(tasa_comision=0.08, costo_pago=0.008, deposito_vs_volumen=0.25, kyc_por_usuario_nuevo=12,
                      churn_mensual=0.20, retos_por_usuario=12, apuesta_promedio=300, promos_vs_comision=0.05, cac=150),
}
BASE = dict(H)

def mes(i, prev_mau):
    mau = H['usuarios_activos'][i]
    nuevos = max(0, mau - prev_mau * (1 - H['churn_mensual']))
    retos = mau * H['retos_por_usuario'] / 2
    volumen = retos * 2 * H['apuesta_promedio']
    comision = volumen * H['tasa_comision']
    iva = comision * H['iva'] / (1 + H['iva'])
    ingreso_neto = comision - iva
    ieps = ingreso_neto * H['ieps']
    depositos = volumen * H['deposito_vs_volumen']
    var = dict(
        ieps=ieps,
        revshare_licencia=(ingreso_neto - ieps) * H['revshare_licencia'],
        pagos=depositos * H['costo_pago'] + mau * H['costo_retiro'],
        fraude=depositos * H['fraude_contracargos'],
        promos=comision * H['promos_vs_comision'],
        kyc=nuevos * H['kyc_por_usuario_nuevo'],
    )
    margen_contrib = ingreso_neto - sum(var.values())
    marketing = nuevos * H['cac']
    fijos = sum(H['fijos'].values())
    ebitda = margen_contrib - marketing - fijos
    return dict(mes=i + 1, mau=mau, nuevos=round(nuevos), retos=round(retos), volumen=volumen, comision=comision,
                iva=iva, ingreso_neto=ingreso_neto, **var, margen_contribucion=margen_contrib,
                marketing=marketing, fijos=fijos, ebitda=ebitda)

def correr(nombre):
    H.clear(); H.update(BASE); H.update(ESCENARIOS[nombre])
    filas, prev = [], 0
    for i in range(12):
        f = mes(i, prev); filas.append(f); prev = f['mau']
    tot = {k: sum(f[k] for f in filas) for k in filas[0] if k not in ('mes', 'mau')}
    acum, minimo = 0, 0
    for f in filas:
        acum += f['ebitda']; minimo = min(minimo, acum)
    return filas, tot, minimo

RES = {n: correr(n) for n in ESCENARIOS}
filas, tot, minimo = correr('base')

def m(x): return f"{x:,.0f}"
orden = [('volumen', 'Volumen apostado (handle)'), ('comision', f"Comisión bruta ({H['tasa_comision']*100:.0f}% del bote)"), ('iva', '(−) IVA trasladado'),
         ('ingreso_neto', '= Ingreso neto'), ('ieps', '(−) IEPS 50%'), ('revshare_licencia', '(−) Rev-share licencia 15%'),
         ('pagos', '(−) Procesamiento de pagos'), ('fraude', '(−) Fraude / contracargos'), ('promos', '(−) Bonos y promociones'),
         ('kyc', '(−) Verificación de identidad'), ('margen_contribucion', '= Margen de contribución'),
         ('marketing', '(−) Marketing / adquisición'), ('fijos', '(−) Gastos fijos'), ('ebitda', '= EBITDA')]
cols = [0, 5, 11]
print('| Concepto | ' + ' | '.join(f"Mes {c+1}" for c in cols) + ' | Año 1 |')
print('|---|' + '---:|' * (len(cols) + 1))
print('| Usuarios activos | ' + ' | '.join(m(filas[c]['mau']) for c in cols) + ' | — |')
for k, n in orden:
    b = '**' if n.startswith('=') else ''
    print(f'| {b}{n}{b} | ' + ' | '.join(f"{b}{m(filas[c][k])}{b}" for c in cols) + f' | {b}{m(tot[k])}{b} |')
u = filas[-1]
print('\n### Escenario base (tabla de arriba)')
print(f"\nMes 12 por usuario activo: comisión ${u['comision']/u['mau']:.0f}, margen contrib ${u['margen_contribucion']/u['mau']:.0f}")
print(f"Caja mínima acumulada (inversión necesaria año 1): ${m(-minimo)}")
print('\n| Escenario | Comisión/usuario/mes | Margen contrib/usuario/mes | EBITDA mes 12 | EBITDA año 1 | Inversión máx. requerida | Equilibrio operativo | LTV / CAC |')
print('|---|---:|---:|---:|---:|---:|---:|---:|')
out = {}
for n, (fs, t, mn) in RES.items():
    H.clear(); H.update(BASE); H.update(ESCENARIOS[n])
    u = fs[-1]; mc = u['margen_contribucion'] / u['mau']
    be = f"{sum(H['fijos'].values())/mc:,.0f} usuarios" if mc > 0 else 'no existe (pierde por usuario)'
    print(f"| {n} | ${u['comision']/u['mau']:.0f} | ${mc:.0f} | {m(u['ebitda'])} | {m(t['ebitda'])} | {m(-mn)} | {be} | {mc/H['churn_mensual']/H['cac']:.1f}x |")
    out[n] = dict(hipotesis=dict(H), meses=fs, total=t, caja_minima=mn)
json.dump(out, open('resultados.json', 'w'), indent=1, ensure_ascii=False)
