import { useState, useEffect, useCallback } from 'react'
import { api, type ProductoDetalle as Detalle, type Ubicacion } from '../api/inventario'
import { beepOk, beepError } from '../utils/beep'

// Estilos de cada tipo de movimiento en el mini-historial
const TIPO_CFG: Record<string, { icon: string; bg: string; color: string; signo: string; label: string }> = {
  entrada:  { icon: '↓', bg: '#E1F5EE', color: '#085041', signo: '+', label: 'Entrada'  },
  salida:   { icon: '↑', bg: '#FAECE7', color: '#712B13', signo: '−', label: 'Salida'   },
  merma:    { icon: '🗑', bg: '#FEF3C7', color: '#92400E', signo: '−', label: 'Merma'    },
  traslado: { icon: '↔', bg: '#E0F2FE', color: '#075985', signo: '',  label: 'Traslado' },
  ajuste:   { icon: '⚖', bg: '#EDE9FE', color: '#5B21B6', signo: '±', label: 'Ajuste'   },
}

const AZUL = '#3B82F6'

function fmtFecha(fecha: string) {
  const d = new Date(fecha.replace(' ', 'T'))
  if (isNaN(d.getTime())) return fecha
  return d.toLocaleString('es-MX', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function ProductoDetalle({ codigo, onClose, onCambio }: {
  codigo: string
  onClose: () => void
  onCambio?: () => void
}) {
  const [det,         setDet]         = useState<Detalle | null>(null)
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([])
  const [cargando,    setCargando]    = useState(true)
  const [error,       setError]       = useState('')
  const [guardando,   setGuardando]   = useState('')                 // qué está guardando ahora
  const [edits,       setEdits]       = useState<Record<string, string>>({})
  const [avanzado,    setAvanzado]    = useState(false)              // mostrar reajuste ×N (peligroso)

  const cargar = useCallback(async () => {
    setError('')
    try {
      const [d, u] = await Promise.all([api.getDetalle(codigo), api.getUbicaciones()])
      setDet(d)
      setUbicaciones(u)
      const base: Record<string, string> = {}
      for (const ub of u) {
        const actual = d.stockPorUbicacion.find(s => s.ubicacion === ub.nombre)?.cantidad ?? 0
        base[ub.nombre] = String(actual)
      }
      // Ubicaciones con stock que NO están en la lista de áreas activas (legado,
      // áreas desactivadas): también deben poder verse y corregirse.
      for (const s of d.stockPorUbicacion) {
        if (!(s.ubicacion in base)) base[s.ubicacion] = String(s.cantidad)
      }
      setEdits(base)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setCargando(false)
    }
  }, [codigo])

  useEffect(() => { cargar() }, [cargar])

  function cantidadActual(ubic: string) {
    return det?.stockPorUbicacion.find(s => s.ubicacion === ubic)?.cantidad ?? 0
  }

  function nudge(ubic: string, delta: number) {
    setEdits(prev => {
      const cur = parseInt(prev[ubic] ?? '0', 10)
      const base = isNaN(cur) ? 0 : cur
      return { ...prev, [ubic]: String(Math.max(0, base + delta)) }
    })
  }

  async function guardarUbic(ubic: string) {
    if (!det || guardando) return
    const nueva  = parseInt(edits[ubic] ?? '', 10)
    const actual = cantidadActual(ubic)
    if (isNaN(nueva) || nueva < 0) { alert('Escribe un número válido (0 o más).'); return }
    if (nueva === actual) return
    if (!window.confirm(`${ubic}: ${actual} → ${nueva} piezas.\n¿Guardar este cambio?`)) return
    setGuardando(ubic)
    try {
      await api.ajustarManual(det.codigo_base, ubic, nueva)
      beepOk()
      // Refresco puntual: actualiza la ficha y SOLO el valor de esta ubicación,
      // conservando lo que el usuario esté tecleando en otras filas.
      const d = await api.getDetalle(codigo)
      setDet(d)
      const nuevoActual = d.stockPorUbicacion.find(s => s.ubicacion === ubic)?.cantidad ?? 0
      setEdits(prev => ({ ...prev, [ubic]: String(nuevoActual) }))
      onCambio?.()
    } catch (e) {
      alert((e as Error).message)
      beepError()
    } finally {
      setGuardando('')
    }
  }

  async function renombrar() {
    if (!det || guardando) return
    const nuevo = window.prompt('Nombre real del producto (no el código):', det.nombre)
    if (nuevo === null) return
    const nombre = nuevo.trim()
    if (nombre.length < 3) { alert('El nombre debe tener al menos 3 letras.'); return }
    if (/^[\d\s.-]+$/.test(nombre)) { alert('El nombre no puede ser solo números (eso es un código).'); return }
    setGuardando('nombre')
    try {
      await api.actualizarNombre(det.codigo_base, nombre)
      beepOk()
      await cargar()
      onCambio?.()
    } catch (e) { alert((e as Error).message); beepError() } finally { setGuardando('') }
  }

  async function vincularCaja() {
    if (!det || guardando) return
    const cajaExistente = det.codigos.find(c => c.tipo === 'caja')
    const cod = window.prompt(`Escanea o escribe el CÓDIGO DE LA CAJA de:\n${det.nombre}`, cajaExistente?.codigo || '')
    if (cod === null) return
    const codCaja = cod.trim()
    if (codCaja.length < 4) { alert('Código de caja inválido.'); return }
    const def = cajaExistente && cajaExistente.unidades > 1
      ? cajaExistente.unidades
      : (det.piezas_por_caja > 1 ? det.piezas_por_caja : 12)
    const ppcStr = window.prompt('¿Cuántas piezas trae cada caja? (ej. 12)', String(def))
    if (ppcStr === null) return
    const ppc = parseInt(ppcStr, 10)
    if (!(ppc >= 2)) { alert('Las piezas por caja deben ser 2 o más.'); return }
    setGuardando('caja')
    try {
      await api.vincularCodigoCaja(det.codigo_base, codCaja, ppc)
      beepOk()
      await cargar()
      onCambio?.()
    } catch (e) { alert((e as Error).message); beepError() } finally { setGuardando('') }
  }

  async function reajusteAvanzado() {
    if (!det || guardando) return
    const factorStr = window.prompt(
      `⚠ REAJUSTE AVANZADO (MULTIPLICA el stock)\n\n` +
      `Úsalo SOLO si contaste CAJAS pero se guardaron como piezas.\n` +
      `Multiplicará TODO el stock actual (${det.stock}) por el número que pongas.\n\n` +
      `Si solo quieres corregir una cantidad (ej. 14 → 11), NO uses esto: usa los\n` +
      `botones de cada ubicación de arriba.\n\n` +
      `¿Por cuánto multiplicar? (ej. 12)`,
      String(det.piezas_por_caja > 1 ? det.piezas_por_caja : 12)
    )
    if (factorStr === null) return
    const factor = parseInt(factorStr, 10)
    if (!(factor >= 2)) { alert('El número debe ser 2 o más.'); return }
    if (!window.confirm(`Se MULTIPLICARÁ: ${det.stock} → ${det.stock * factor} piezas.\n¿Confirmas?`)) return
    setGuardando('reajuste')
    try {
      await api.reinterpretarStock(det.codigo_base, factor)
      beepOk()
      await cargar()
      onCambio?.()
    } catch (e) { alert((e as Error).message); beepError() } finally { setGuardando('') }
  }

  const cajaCod = det?.codigos.find(c => c.tipo === 'caja')
  const indCod  = det?.codigos.find(c => c.tipo === 'individual') ?? det?.codigos[0]

  // Filas del editor: áreas activas + cualquier ubicación con stock que no esté en
  // esa lista (legado/áreas desactivadas), para no ocultar ni volver ineditable stock.
  const areasEditar = det
    ? [
        ...ubicaciones.map(u => ({ key: `u${u.id}`, nombre: u.nombre, color: u.color })),
        ...det.stockPorUbicacion
          .filter(s => !ubicaciones.some(u => u.nombre === s.ubicacion))
          .map(s => ({ key: `x-${s.ubicacion}`, nombre: s.ubicacion, color: s.color })),
      ]
    : []

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#f5f5f3', zIndex: 250,
      display: 'flex', flexDirection: 'column', maxWidth: 480, margin: '0 auto',
    }}>
      {/* Header */}
      <div style={{
        background: AZUL, color: 'white',
        padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
      }}>
        <button onClick={onClose}
          style={{ background: 'none', border: 'none', color: 'white', fontSize: 24, cursor: 'pointer', padding: 0, lineHeight: 1 }}>
          ←
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {det?.nombre ?? 'Cargando...'}
          </p>
          <p style={{ fontSize: 11, opacity: 0.8 }}>Ficha del producto</p>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {cargando && <p style={{ textAlign: 'center', color: AZUL, fontSize: 14, padding: '20px 0' }}>Cargando ficha...</p>}

        {!cargando && error && (
          <div style={{ background: '#FAECE7', borderRadius: 12, padding: '14px 16px' }}>
            <p style={{ color: '#712B13', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>No se pudo abrir la ficha</p>
            <p style={{ color: '#712B13', fontSize: 12, fontFamily: 'monospace', marginBottom: 12 }}>{error}</p>
            <button onClick={() => { setCargando(true); cargar() }}
              style={{ padding: '10px 18px', background: AZUL, color: 'white', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Reintentar
            </button>
          </div>
        )}

        {!cargando && det && (
          <>
            {/* ── Stock total ─────────────────────────────────────────────── */}
            <div style={{ background: 'white', borderRadius: 14, padding: '16px 18px', border: '1px solid rgba(0,0,0,0.06)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: '#5F5E5A', fontWeight: 600 }}>Stock total</span>
                <span>
                  <span style={{ fontSize: 30, fontWeight: 800, color: det.stock > 0 ? '#1D9E75' : '#bbb' }}>{det.stock}</span>
                  <span style={{ fontSize: 12, color: '#aaa', marginLeft: 4 }}>pzas</span>
                </span>
              </div>
              {det.piezas_por_caja > 1 && det.stock > 0 && (
                <p style={{ fontSize: 12, color: AZUL, fontWeight: 600, marginTop: 6 }}>
                  = {Math.floor(det.stock / det.piezas_por_caja)} {Math.floor(det.stock / det.piezas_por_caja) === 1 ? 'caja' : 'cajas'} de {det.piezas_por_caja}
                  {det.stock % det.piezas_por_caja > 0 ? ` + ${det.stock % det.piezas_por_caja} sueltas` : ''}
                </p>
              )}
            </div>

            {/* ── Códigos ─────────────────────────────────────────────────── */}
            <div style={{ background: 'white', borderRadius: 14, padding: '16px 18px', border: '1px solid rgba(0,0,0,0.06)' }}>
              <p style={{ fontSize: 12, color: '#aaa', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 }}>Códigos</p>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: cajaCod ? 10 : 12 }}>
                <div>
                  <p style={{ fontSize: 11, color: '#888', fontWeight: 600 }}>Individual (1 pieza)</p>
                  <p style={{ fontSize: 13, fontFamily: 'monospace', color: '#1a1a18', wordBreak: 'break-all' }}>{indCod?.codigo ?? det.codigo_base}</p>
                </div>
                <span style={{ fontSize: 20 }}>🏷️</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 11, color: '#888', fontWeight: 600 }}>
                    Caja {cajaCod ? `(1 caja = ${cajaCod.unidades} piezas)` : ''}
                  </p>
                  <p style={{ fontSize: 13, fontFamily: 'monospace', color: cajaCod ? '#1a1a18' : '#bbb', wordBreak: 'break-all' }}>
                    {cajaCod ? cajaCod.codigo : 'Sin código de caja'}
                  </p>
                </div>
                <button onClick={vincularCaja} disabled={!!guardando}
                  style={{ flexShrink: 0, background: '#F0F7FF', border: `1px solid ${AZUL}40`, color: AZUL, borderRadius: 8, padding: '8px 12px', cursor: guardando ? 'default' : 'pointer', opacity: guardando ? 0.5 : 1, fontSize: 12, fontWeight: 600 }}>
                  {cajaCod ? '📦 Cambiar' : '📦 Vincular'}
                </button>
              </div>
            </div>

            {/* ── Editar inventario por ubicación ─────────────────────────── */}
            <div style={{ background: 'white', borderRadius: 14, padding: '16px 18px', border: '1px solid rgba(0,0,0,0.06)' }}>
              <p style={{ fontSize: 12, color: '#aaa', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 }}>Inventario por ubicación</p>
              <p style={{ fontSize: 12, color: '#5F5E5A', marginBottom: 14 }}>
                Escribe la cantidad <b>exacta</b> que hay (o usa − / +). Al guardar, el stock queda en ese número.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {areasEditar.map(a => {
                  const actual   = cantidadActual(a.nombre)
                  const valor    = edits[a.nombre] ?? String(actual)
                  const nEdit    = parseInt(valor, 10)
                  const cambiado = valor.trim() !== '' && !isNaN(nEdit) && nEdit !== actual
                  const enCurso  = guardando === a.nombre
                  return (
                    <div key={a.key} style={{
                      border: `1px solid ${a.color}30`, borderRadius: 12, padding: '10px 12px',
                      background: cambiado ? `${a.color}0A` : 'white',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: a.color, flexShrink: 0 }} />
                        <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: '#1a1a18' }}>{a.nombre}</span>
                        <span style={{ fontSize: 11, color: '#aaa' }}>ahora: {actual}</span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button onClick={() => nudge(a.nombre, -1)} disabled={enCurso}
                          style={{ width: 40, height: 40, borderRadius: 10, border: '1.5px solid rgba(0,0,0,0.12)', background: '#fafafa', fontSize: 22, cursor: enCurso ? 'default' : 'pointer', opacity: enCurso ? 0.5 : 1, color: '#712B13', lineHeight: 1 }}>−</button>
                        <input
                          data-manual="true"
                          inputMode="numeric"
                          value={valor}
                          onChange={e => setEdits(prev => ({ ...prev, [a.nombre]: e.target.value.replace(/[^\d]/g, '') }))}
                          style={{
                            flex: 1, minWidth: 0, textAlign: 'center', padding: '9px', fontSize: 18, fontWeight: 700,
                            border: `1.5px solid ${cambiado ? a.color : 'rgba(0,0,0,0.12)'}`, borderRadius: 10,
                            background: 'white', color: '#1a1a18',
                          }}
                        />
                        <button onClick={() => nudge(a.nombre, +1)} disabled={enCurso}
                          style={{ width: 40, height: 40, borderRadius: 10, border: '1.5px solid rgba(0,0,0,0.12)', background: '#fafafa', fontSize: 22, cursor: enCurso ? 'default' : 'pointer', opacity: enCurso ? 0.5 : 1, color: '#085041', lineHeight: 1 }}>+</button>
                        <button
                          onClick={() => guardarUbic(a.nombre)}
                          disabled={!cambiado || enCurso}
                          style={{
                            padding: '0 14px', height: 40, borderRadius: 10, border: 'none', flexShrink: 0,
                            background: cambiado ? a.color : '#e5e5e3', color: cambiado ? 'white' : '#aaa',
                            fontSize: 13, fontWeight: 700, cursor: cambiado && !enCurso ? 'pointer' : 'default',
                          }}>
                          {enCurso ? '...' : 'Guardar'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* ── Nombre / acciones ───────────────────────────────────────── */}
            <div style={{ background: 'white', borderRadius: 14, padding: '16px 18px', border: '1px solid rgba(0,0,0,0.06)' }}>
              <p style={{ fontSize: 12, color: '#aaa', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 }}>Nombre</p>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#1a1a18', marginBottom: 12 }}>{det.nombre}</p>
              <button onClick={renombrar} disabled={!!guardando}
                style={{ width: '100%', padding: '12px', border: `1px solid ${AZUL}40`, borderRadius: 10, background: '#eef6ff', color: AZUL, fontSize: 14, fontWeight: 600, cursor: guardando ? 'default' : 'pointer', opacity: guardando ? 0.5 : 1 }}>
                🏷️ Corregir nombre
              </button>
            </div>

            {/* ── Mini-historial ──────────────────────────────────────────── */}
            <div style={{ background: 'white', borderRadius: 14, padding: '16px 18px', border: '1px solid rgba(0,0,0,0.06)' }}>
              <p style={{ fontSize: 12, color: '#aaa', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 }}>Historial del producto</p>
              {det.movimientos.length === 0 ? (
                <p style={{ fontSize: 13, color: '#aaa', textAlign: 'center', padding: '10px 0' }}>Sin movimientos registrados</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {det.movimientos.map(m => {
                    const cfg = TIPO_CFG[m.tipo] ?? TIPO_CFG.ajuste
                    return (
                      <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                        <div style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, background: cfg.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
                          {cfg.icon}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 13, fontWeight: 600, color: '#1a1a18' }}>
                            {cfg.label}{m.ubicacion ? ` · ${m.ubicacion}` : ''}
                          </p>
                          <p style={{ fontSize: 11, color: '#aaa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {fmtFecha(m.fecha)}{m.notas ? ` · ${m.notas}` : ''}
                          </p>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <p style={{ fontSize: 14, fontWeight: 700, color: cfg.color }}>{cfg.signo}{m.cantidad}</p>
                          {!(m.stock_antes === 0 && m.stock_despues === 0) && (
                            <p style={{ fontSize: 10, color: '#bbb' }}>{m.stock_antes}→{m.stock_despues}</p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* ── Reajuste avanzado (peligroso) — oculto tras un toggle ───── */}
            {!avanzado ? (
              <button onClick={() => setAvanzado(true)}
                style={{ alignSelf: 'center', background: 'none', border: 'none', color: '#aaa', fontSize: 12, textDecoration: 'underline', cursor: 'pointer', padding: '4px 0' }}>
                Opciones avanzadas
              </button>
            ) : (
              <div style={{ background: '#FFF8F3', borderRadius: 14, padding: '14px 16px', border: '1px solid rgba(216,90,48,0.2)' }}>
                <p style={{ fontSize: 12, color: '#B45309', fontWeight: 700, marginBottom: 4 }}>⚠ Reajuste avanzado (×N)</p>
                <p style={{ fontSize: 12, color: '#8a6d3b', marginBottom: 10 }}>
                  Solo si contaste <b>cajas</b> pero se guardaron como piezas. <b>Multiplica</b> el stock.
                  Para cambiar una cantidad normal usa las ubicaciones de arriba.
                </p>
                <button onClick={reajusteAvanzado} disabled={!!guardando}
                  style={{ width: '100%', padding: '11px', border: '1px solid rgba(216,90,48,0.35)', borderRadius: 10, background: 'white', color: '#B45309', fontSize: 13, fontWeight: 600, cursor: guardando ? 'default' : 'pointer', opacity: guardando ? 0.5 : 1 }}>
                  🔧 Multiplicar stock (×piezas por caja)
                </button>
              </div>
            )}

            <div style={{ height: 8 }} />
          </>
        )}
      </div>
    </div>
  )
}
