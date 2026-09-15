import { useState, useCallback, useRef, useEffect } from 'react'
import { api, type SolicitudResurtido } from '../api/inventario'
import { useBarcodeScan } from '../hooks/useBarcodeScan'
import { beepScan, beepOk, beepError } from '../utils/beep'
import ContadorCantidad from '../components/ContadorCantidad'

// Solicitudes de resurtido: el panel del admin (o el teléfono) pide "lleva N pzas de
// Bodega a Casita 1". Eso NO mueve stock. Aquí el de bodega escanea el producto para
// confirmar que es el correcto, dice cuántas piezas movió y registra el TRASLADO real
// (inventario_bodega); después la solicitud se marca hecha.
type Paso = 'lista' | 'detalle' | 'exito' | 'error'

// Colores de la pestaña (ámbar) — el resto son los mismos del index.css
const AMBAR      = '#B45309'
const AMBAR_DARK = '#78350F'
const AMBAR_BG   = '#FEF3C7'

// Las fechas vienen como ISO con Z pero SON hora CDMX → se pintan con timeZone UTC
function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' })
  } catch {
    return ''
  }
}

// Piezas con las que arranca el contador: lo pedido, topado por lo que hay en el origen.
function inicialDe(s: SolicitudResurtido): number {
  const stock = Math.max(0, Number(s.stock_origen) || 0)
  return Math.max(0, Math.min(Number(s.cantidad) || 0, stock))
}

export default function Resurtido() {
  const [paso,          setPaso]          = useState<Paso>('lista')
  const [solicitudes,   setSolicitudes]   = useState<SolicitudResurtido[]>([])
  const [cargandoLista, setCargandoLista] = useState(false)
  const [errorLista,    setErrorLista]    = useState('')
  const [solicitud,     setSolicitud]     = useState<SolicitudResurtido | null>(null)
  const [cargando,      setCargando]      = useState(false)
  const [error,         setError]         = useState('')
  const [inputManual,   setInputManual]   = useState('')
  // Resultado del último escaneo: ok = es el producto de la solicitud
  const [validacion,    setValidacion]    = useState<{ ok: boolean; texto: string } | null>(null)
  const [piezas,        setPiezas]        = useState(1)
  const [exito,         setExito]         = useState<{ titulo: string; sub: string; nota: string; stock: number | null } | null>(null)
  // El hook global y el input pueden disparar el MISMO escaneo en el mismo tick
  // (Enter). busyRef es síncrono: el segundo disparo se descarta.
  const busyRef        = useRef(false)
  const registrandoRef = useRef(false)
  const solicitudRef   = useRef<SolicitudResurtido | null>(null)
  const scanTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  solicitudRef.current = solicitud

  // ── Lista: carga + refresco automático cada 30 s ───────────────────────────
  const cargarLista = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargandoLista(true)
    try {
      const lista = await api.getResurtidosPendientes()
      setSolicitudes(Array.isArray(lista) ? lista : [])
      setErrorLista('')
    } catch (e) {
      setErrorLista((e as Error).message)
    } finally {
      if (!silencioso) setCargandoLista(false)
    }
  }, [])

  useEffect(() => {
    if (paso !== 'lista') return
    cargarLista()
    const t = setInterval(() => cargarLista(true), 30000)
    return () => clearInterval(t)
  }, [paso, cargarLista])

  useEffect(() => () => {
    if (scanTimerRef.current) clearTimeout(scanTimerRef.current)
  }, [])

  async function abrirSolicitud(id: number) {
    if (cargando) return
    setCargando(true)
    setError('')
    setValidacion(null)
    setInputManual('')
    try {
      const s = await api.getResurtido(id)
      // Pudo cerrarse entre refrescos (la concilió el admin o la hizo otro TC52)
      if (s.estado !== 'pendiente') {
        setSolicitud(null)
        throw new Error(s.estado === 'hecha'
          ? `La solicitud #${id} ya está hecha${s.hecha_por ? ` (la cerró ${s.hecha_por})` : ''}`
          : `La solicitud #${id} ya está cancelada`)
      }
      setSolicitud(s)
      setPiezas(inicialDe(s))
      setPaso('detalle')
    } catch (e) {
      setError((e as Error).message)
      setPaso('error')
      beepError()
    } finally {
      setCargando(false)
    }
  }

  function volverLista() {
    if (scanTimerRef.current) clearTimeout(scanTimerRef.current)
    setPaso('lista')
    setSolicitud(null)
    setValidacion(null)
    setInputManual('')
    setError('')
    setExito(null)
  }

  // ── Escaneo: valida que sea el producto de la solicitud (NO mueve stock) ───
  function handleScanInput(val: string) {
    setInputManual(val)
    if (scanTimerRef.current) clearTimeout(scanTimerRef.current)
    if (val.trim().length >= 4)
      scanTimerRef.current = setTimeout(() => escanear(val.trim()), 150)
  }

  const escanear = useCallback(async (codigo: string) => {
    const s = solicitudRef.current
    const cod = codigo.trim()
    if (scanTimerRef.current) { clearTimeout(scanTimerRef.current); scanTimerRef.current = null }
    if (!s || !cod || busyRef.current) return
    busyRef.current = true
    setCargando(true)
    setInputManual('')
    try {
      const prod = await api.getProducto(cod)
      // Se puede escanear la pieza o la caja: ambas resuelven al mismo código base
      const base = String(prod.codigo_base || prod.codigo || '').trim()
      if (base && base === String(s.codigo_barras || '').trim()) {
        beepScan()
        setValidacion({ ok: true, texto: `Producto correcto · ${prod.nombre}` })
      } else {
        beepError()
        setValidacion({ ok: false, texto: `Ese no es el producto de la solicitud (leíste: ${prod.nombre || cod})` })
      }
    } catch (e) {
      beepError()
      setValidacion({ ok: false, texto: (e as Error).message })
    } finally {
      busyRef.current = false
      setCargando(false)
    }
  }, [])

  // El lector solo actúa en el detalle de la solicitud (en la lista no hace nada).
  useBarcodeScan(escanear, paso === 'detalle')

  // Para productos sin código de barras (o etiqueta ilegible)
  function confirmarSinEscanear() {
    if (!solicitud || cargando) return
    if (!window.confirm(`¿Confirmar sin escanear?\n\nAsegúrate de tener en la mano:\n${solicitud.nombre_mostrar}`)) return
    setValidacion({ ok: true, texto: 'Confirmado sin escanear · revisa que sea el producto correcto' })
  }

  // ── Acción final: traslado REAL + cerrar la solicitud ──────────────────────
  const validado = !!validacion?.ok
  const stockOrigen = solicitud ? Math.max(0, Number(solicitud.stock_origen) || 0) : 0
  const faltaEnOrigen = !!solicitud && stockOrigen < solicitud.cantidad
  const puedeRegistrar = !!solicitud && validado && !cargando && piezas > 0 && piezas <= stockOrigen

  async function registrar() {
    if (!solicitud || registrandoRef.current || !validado) return
    if (piezas <= 0) return
    if (piezas > stockOrigen) {
      setError(`Solo hay ${stockOrigen} pzas en ${solicitud.de_ubicacion}`)
      setPaso('error')
      beepError()
      return
    }
    registrandoRef.current = true
    setCargando(true)
    try {
      // Se manda el código BASE de la solicitud → unidades = 1 → 'piezas' va en piezas.
      // Esto SÍ mueve stock: resta en el origen, suma en el destino y deja el movimiento.
      const res = await api.trasladar(solicitud.codigo_barras, piezas, solicitud.de_ubicacion, solicitud.a_ubicacion)
      // Cerrar la solicitud ligándola al movimiento. Si esto falla, el traslado YA quedó
      // registrado: el admin la concilia solo (busca el traslado en movimientos_bodega).
      let nota = ''
      try {
        await api.marcarResurtidoHecho(solicitud.id, { cantidad: piezas, movimiento_id: res.movimiento_id ?? null })
      } catch (e) {
        nota = `El traslado sí quedó registrado, pero no se pudo cerrar la solicitud #${solicitud.id} (${(e as Error).message}). El panel la cierra solo al conciliar.`
      }
      setExito({
        titulo: 'Resurtido hecho',
        sub:    `${piezas} pzas de ${solicitud.de_ubicacion} a ${solicitud.a_ubicacion} · ${solicitud.nombre_mostrar}`,
        nota,
        stock:  typeof res.stockActual === 'number' ? res.stockActual : null,
      })
      setPaso('exito')
      beepOk()
    } catch (e) {
      setError((e as Error).message)
      setPaso('error')
      beepError()
    } finally {
      registrandoRef.current = false
      setCargando(false)
    }
  }

  // Cancela la solicitud (no mueve nada); el motivo queda en el historial del panel.
  async function cancelar() {
    if (!solicitud || registrandoRef.current) return
    const motivo = window.prompt(
      `¿Cancelar la solicitud #${solicitud.id}?\n${solicitud.nombre_mostrar}\n\nNo se mueve nada. Escribe el motivo (opcional):`, ''
    )
    if (motivo === null) return
    registrandoRef.current = true
    setCargando(true)
    try {
      await api.cancelarResurtido(solicitud.id, motivo.trim() || undefined)
      setExito({
        titulo: `Solicitud #${solicitud.id} cancelada`,
        sub:    `${solicitud.nombre_mostrar} · no se movió nada`,
        nota:   motivo.trim() ? `Motivo: ${motivo.trim()}` : '',
        stock:  null,
      })
      setPaso('exito')
      beepOk()
    } catch (e) {
      setError((e as Error).message)
      setPaso('error')
      beepError()
    } finally {
      registrandoRef.current = false
      setCargando(false)
    }
  }

  // ── Lista de solicitudes ───────────────────────────────────────────────────
  if (paso === 'lista') return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <p style={{ fontSize: 16, fontWeight: 700, color: '#1a1a18' }}>Pendientes de resurtir</p>
          <p style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>
            {solicitudes.length > 0 ? `${solicitudes.length} · toca una para surtirla` : 'Toca una solicitud para surtirla'}
          </p>
        </div>
        <button
          onClick={() => cargarLista()}
          disabled={cargandoLista}
          style={{
            padding: '10px 14px', borderRadius: 12, minHeight: 44, flexShrink: 0,
            background: AMBAR_BG, color: AMBAR_DARK, fontSize: 13, fontWeight: 600,
          }}
        >
          {cargandoLista ? 'Cargando...' : '↻ Actualizar'}
        </button>
      </div>

      {errorLista && (
        <div style={{ background: '#FAECE7', borderRadius: 12, padding: '12px 14px' }}>
          <p style={{ color: '#712B13', fontSize: 13 }}>No se pudo cargar la lista: {errorLista}</p>
        </div>
      )}

      {cargandoLista && solicitudes.length === 0 ? (
        <p style={{ textAlign: 'center', color: AMBAR, fontSize: 14, padding: '20px 0' }}>
          Cargando solicitudes...
        </p>
      ) : solicitudes.length === 0 ? (
        <div style={{
          background: '#f9f9f7', borderRadius: 14, padding: '20px 16px',
          border: '1.5px dashed rgba(0,0,0,0.10)', textAlign: 'center',
        }}>
          <p style={{ fontSize: 30, marginBottom: 8 }}>🚚</p>
          <p style={{ fontSize: 14, color: '#aaa' }}>Sin solicitudes pendientes</p>
          <p style={{ fontSize: 12, color: '#bbb', marginTop: 4 }}>
            Lo que pidan resurtir desde el panel aparece aquí solo
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {solicitudes.map(s => {
            const stock = Math.max(0, Number(s.stock_origen) || 0)
            const falta = stock < s.cantidad
            const borde = s.prioridad > 0 ? `2px solid ${AMBAR}` : '1.5px solid rgba(0,0,0,0.10)'
            return (
              <button
                key={s.id}
                onClick={() => abrirSolicitud(s.id)}
                disabled={cargando}
                style={{
                  background: 'white', borderRadius: 14, padding: '14px 16px',
                  border: borde, textAlign: 'left', cursor: 'pointer', width: '100%',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 15, fontWeight: 700, color: '#1a1a18', lineHeight: 1.25 }}>
                      {s.nombre_mostrar}
                    </p>
                    <p style={{ fontSize: 11, color: '#aaa', fontFamily: 'monospace', marginTop: 2 }}>
                      {s.codigo_barras}
                    </p>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <p style={{ fontSize: 26, fontWeight: 800, lineHeight: 1, color: AMBAR }}>
                      {s.cantidad}
                      <span style={{ fontSize: 13, color: '#aaa', fontWeight: 600 }}> pzas</span>
                    </p>
                  </div>
                </div>

                {/* Ruta */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, padding: '5px 12px', borderRadius: 20, background: '#E1F5EE', color: '#085041', fontWeight: 700 }}>
                    📤 {s.de_ubicacion}
                  </span>
                  <span style={{ fontSize: 18, color: AMBAR, fontWeight: 700 }}>→</span>
                  <span style={{ fontSize: 13, padding: '5px 12px', borderRadius: 20, background: AMBAR_BG, color: AMBAR_DARK, fontWeight: 700 }}>
                    📍 {s.a_ubicacion}
                  </span>
                </div>

                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: '4px 14px', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: falta ? '#712B13' : '#5F5E5A', fontWeight: falta ? 700 : 400 }}>
                    {falta ? `⚠ solo hay ${stock}` : `hay ${stock}`} en {s.de_ubicacion}
                  </span>
                  <span style={{ fontSize: 12, color: '#5F5E5A' }}>
                    en {s.a_ubicacion}: {s.stock_destino == null ? 'sin conteo' : s.stock_destino}
                  </span>
                </div>

                <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: '#bbb' }}>
                    #{s.id} · {s.solicitado_por || s.origen} · {fechaCorta(s.creado)}
                  </span>
                  {s.prioridad > 0 && (
                    <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 99, background: '#FAECE7', color: '#712B13', fontWeight: 700 }}>
                      PRIORIDAD ALTA
                    </span>
                  )}
                </div>
                {s.nota && (
                  <p style={{ fontSize: 12, color: '#5F5E5A', fontStyle: 'italic', marginTop: 6 }}>
                    “{s.nota}”
                  </p>
                )}
              </button>
            )
          })}
        </div>
      )}

      {cargando && <p style={{ textAlign: 'center', color: AMBAR, fontSize: 14 }}>Abriendo solicitud...</p>}
    </div>
  )

  // ── Detalle: escanear para confirmar → cantidad → registrar traslado ──────
  if (paso === 'detalle' && solicitud) return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Chip solicitud activa */}
      <div style={{
        background: AMBAR_BG, borderRadius: 12, padding: '10px 14px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 11, color: AMBAR_DARK, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Solicitud #{solicitud.id}</p>
          <p style={{ fontSize: 14, fontWeight: 700, color: AMBAR_DARK }}>
            {solicitud.de_ubicacion} → {solicitud.a_ubicacion} · {solicitud.cantidad} pzas
          </p>
          <p style={{ fontSize: 12, color: AMBAR_DARK, opacity: 0.8, marginTop: 2 }}>
            {solicitud.solicitado_por || solicitud.origen} · {fechaCorta(solicitud.creado)}{solicitud.prioridad > 0 ? ' · PRIORIDAD ALTA' : ''}
          </p>
        </div>
        <button onClick={volverLista} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: AMBAR_DARK, opacity: 0.5, padding: '4px 8px' }}>✕</button>
      </div>

      {/* Producto */}
      <div className="card">
        <p style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>{solicitud.nombre_mostrar}</p>
        <p style={{ fontSize: 12, color: '#aaa', fontFamily: 'monospace', marginBottom: 8 }}>{solicitud.codigo_barras}</p>
        <p style={{ fontSize: 14, fontWeight: 700, color: faltaEnOrigen ? '#712B13' : '#1D9E75' }}>
          {faltaEnOrigen ? `⚠ Solo hay ${stockOrigen}` : `Hay ${stockOrigen}`} pzas en {solicitud.de_ubicacion}
        </p>
        <p style={{ fontSize: 12, color: '#5F5E5A', marginTop: 2 }}>
          En {solicitud.a_ubicacion}: {solicitud.stock_destino == null ? 'sin conteo' : `${solicitud.stock_destino} pzas`}
        </p>
        {solicitud.nota && (
          <p style={{ fontSize: 13, color: '#5F5E5A', fontStyle: 'italic', marginTop: 8 }}>
            Nota: “{solicitud.nota}”
          </p>
        )}
      </div>

      {/* Objetivo de escaneo + input manual */}
      {validado ? (
        <div style={{ background: '#1D9E75', color: 'white', borderRadius: 12, padding: '12px 14px', textAlign: 'center' }}>
          <p style={{ fontSize: 16, fontWeight: 700 }}>✓ Producto correcto</p>
          <p style={{ fontSize: 12, opacity: 0.9, marginTop: 2 }}>{validacion?.texto}</p>
        </div>
      ) : (
        <div style={{
          background: 'white', borderRadius: 18,
          border: '2px dashed rgba(180,83,9,0.35)',
          padding: '22px 16px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🚚</div>
          <p style={{ fontSize: 15, color: '#5F5E5A', marginBottom: 4 }}>Escanea el producto para confirmar</p>
          <p style={{ fontSize: 13, color: '#aaa' }}>Así no se surte el producto equivocado</p>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          autoFocus
          value={inputManual}
          onChange={e => handleScanInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && inputManual.trim() && escanear(inputManual.trim())}
          placeholder="Código de barras..."
          style={{
            flex: 1, padding: '14px', fontSize: 16, minWidth: 0,
            border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 12,
            background: 'white', color: '#1a1a18',
          }}
        />
        <button
          onClick={() => inputManual.trim() && escanear(inputManual)}
          style={{ padding: '14px 18px', background: AMBAR, color: 'white', borderRadius: 12, fontSize: 20, minWidth: 52 }}
        >→</button>
      </div>

      {validacion && !validacion.ok && (
        <div style={{ background: '#FAECE7', borderRadius: 12, padding: '12px 14px' }}>
          <p style={{ color: '#712B13', fontSize: 14, fontWeight: 600 }}>{validacion.texto}</p>
        </div>
      )}
      {cargando && !registrandoRef.current && <p style={{ textAlign: 'center', color: AMBAR, fontSize: 13 }}>Buscando producto...</p>}

      {!validado && (
        <button onClick={confirmarSinEscanear} disabled={cargando}
          style={{ alignSelf: 'center', background: 'none', border: 'none', color: '#aaa', fontSize: 12, textDecoration: 'underline', cursor: 'pointer', padding: '4px 0' }}>
          Confirmar sin escanear (producto sin código)
        </button>
      )}

      {/* Cantidad */}
      <div>
        <p style={{ fontSize: 14, fontWeight: 600, color: '#1a1a18' }}>¿Cuántas piezas mueves?</p>
        <p style={{ fontSize: 12, color: '#5F5E5A', marginTop: 2 }}>
          Solicitadas: <b>{solicitud.cantidad}</b> pzas · disponibles en {solicitud.de_ubicacion}: {stockOrigen}
        </p>
      </div>

      {stockOrigen <= 0 ? (
        <div style={{ background: '#FAECE7', borderRadius: 12, padding: '12px 14px' }}>
          <p style={{ color: '#712B13', fontSize: 13, fontWeight: 600 }}>
            No hay stock contado en {solicitud.de_ubicacion}. Cuéntalo ahí primero (Inventario) o cancela la solicitud.
          </p>
        </div>
      ) : (
        <ContadorCantidad
          key={solicitud.id}
          unidad="piezas"
          color={AMBAR}
          max={stockOrigen}
          piezasPorCajaInicial={Math.max(1, inicialDe(solicitud))}
          onChange={t => setPiezas(t)}
        />
      )}

      {stockOrigen > 0 && piezas > 0 && piezas < solicitud.cantidad && (
        <p style={{ fontSize: 12, color: AMBAR, textAlign: 'center', fontWeight: 600 }}>
          Vas a mover {piezas} de {solicitud.cantidad} solicitadas · la solicitud se cierra con lo que muevas
        </p>
      )}

      {/* Acciones */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
        <button className="btn-primary" onClick={registrar} disabled={!puedeRegistrar}
          style={{ background: AMBAR, opacity: puedeRegistrar || cargando ? 1 : 0.45 }}>
          {cargando && registrandoRef.current ? 'Registrando...' : `🚚 Registrar traslado · ${piezas} pzas`}
        </button>
        <p style={{ fontSize: 11, color: '#aaa', textAlign: 'center' }}>
          {validado
            ? `Esto sí mueve el stock: resta en ${solicitud.de_ubicacion}, suma en ${solicitud.a_ubicacion} y cierra la solicitud.`
            : 'Primero escanea el producto para poder registrar el traslado.'}
        </p>
        <button className="btn-secondary" onClick={cancelar} disabled={cargando}>Cancelar solicitud</button>
        <button className="btn-secondary" onClick={volverLista}>← Volver a la lista</button>
      </div>
    </div>
  )

  // ── Éxito ──────────────────────────────────────────────────────────────────
  if (paso === 'exito' && exito) return (
    <div style={{ padding: '40px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12 }}>
      <div style={{ width: 80, height: 80, borderRadius: '50%', background: '#E1F5EE', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, marginBottom: 8 }}>✓</div>
      <p style={{ fontSize: 20, fontWeight: 700, color: '#085041' }}>{exito.titulo}</p>
      <p style={{ fontSize: 15, color: '#5F5E5A' }}>{exito.sub}</p>
      {exito.stock != null && (
        <p style={{ fontSize: 13, color: '#5F5E5A' }}>
          Stock total del producto ahora: <b>{exito.stock}</b> pzas
        </p>
      )}
      {exito.nota && <p style={{ fontSize: 12, color: '#B45309' }}>{exito.nota}</p>}
      <div style={{ marginTop: 20, width: '100%' }}>
        <button className="btn-primary" onClick={volverLista} style={{ background: AMBAR }}>Volver</button>
      </div>
    </div>
  )

  // ── Error ──────────────────────────────────────────────────────────────────
  if (paso === 'error') return (
    <div style={{ padding: '40px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12 }}>
      <div style={{ width: 80, height: 80, borderRadius: '50%', background: '#FAECE7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, marginBottom: 8 }}>✕</div>
      <p style={{ fontSize: 18, fontWeight: 700, color: '#712B13' }}>Error</p>
      <p style={{ fontSize: 14, color: '#5F5E5A' }}>{error}</p>
      <div style={{ marginTop: 20, width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {solicitud ? (
          <>
            <button className="btn-primary rojo" onClick={() => abrirSolicitud(solicitud.id)} style={{ background: '#D85A30' }}>
              Intentar de nuevo
            </button>
            <button className="btn-secondary" onClick={volverLista}>← Volver a la lista</button>
          </>
        ) : (
          <button className="btn-primary rojo" onClick={volverLista} style={{ background: '#D85A30' }}>
            Volver
          </button>
        )}
      </div>
    </div>
  )

  return null
}
