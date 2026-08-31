import { useState, useCallback, useRef, useEffect, type CSSProperties } from 'react'
import {
  api,
  type PedidoWebCompacto,
  type PedidoWebDetalle,
  type LineaPedidoWeb,
  type EstadoPedidoWeb,
} from '../api/inventario'
import { useBarcodeScan } from '../hooks/useBarcodeScan'
import { beepScan, beepOk, beepError } from '../utils/beep'

type Paso = 'lista' | 'detalle' | 'exito' | 'error'

// Colores de la pestaña (morado) — el resto son los mismos del index.css
const MORADO      = '#7C3AED'
const MORADO_DARK = '#4C1D95'
const MORADO_BG   = '#F1EBFF'

const ESTADO_TXT: Record<string, string> = {
  nuevo:      '🟡 Nuevo',
  preparando: '🔵 Preparando',
  listo:      '🟢 Listo',
  entregado:  '✓ Entregado',
  enviado:    '✓ Enviado',
  cancelado:  '✕ Cancelado',
}
const ESTADO_COLOR: Record<string, string> = {
  nuevo:      '#B45309',
  preparando: '#1D4ED8',
  listo:      '#085041',
  entregado:  '#5F5E5A',
  enviado:    '#5F5E5A',
  cancelado:  '#712B13',
}
const ENTREGA_TXT: Record<string, string> = {
  recoger: '🏪 Recoger en tienda',
  envio:   '🚚 Envío',
  local:   '🛵 Entrega local',
}

// Las fechas vienen como ISO con Z pero SON hora CDMX → se pintan con timeZone UTC
function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' })
  } catch {
    return ''
  }
}

export default function PedidosWeb() {
  const [paso,          setPaso]          = useState<Paso>('lista')
  const [pedidos,       setPedidos]       = useState<PedidoWebCompacto[]>([])
  const [cargandoLista, setCargandoLista] = useState(false)
  const [errorLista,    setErrorLista]    = useState('')
  const [pedido,        setPedido]        = useState<PedidoWebDetalle | null>(null)
  const [cargando,      setCargando]      = useState(false)
  const [error,         setError]         = useState('')
  const [inputManual,   setInputManual]   = useState('')
  const [msg,           setMsg]           = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  const [exito,         setExito]         = useState<{ titulo: string; sub: string; nota: string } | null>(null)
  // El hook global y el input pueden disparar el MISMO escaneo en el mismo tick
  // (Enter). busyRef es síncrono: el segundo disparo se descarta y no se cuenta doble.
  const busyRef        = useRef(false)
  const registrandoRef = useRef(false)
  const pedidoRef      = useRef<PedidoWebDetalle | null>(null)
  const scanTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const msgTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  pedidoRef.current = pedido

  // ── Lista: carga + refresco automático cada 30 s ───────────────────────────
  const cargarLista = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargandoLista(true)
    try {
      const lista = await api.getPedidosWeb()
      setPedidos(Array.isArray(lista) ? lista : [])
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
    if (msgTimerRef.current) clearTimeout(msgTimerRef.current)
    if (scanTimerRef.current) clearTimeout(scanTimerRef.current)
  }, [])

  function mostrarMsg(tipo: 'ok' | 'error', texto: string) {
    if (msgTimerRef.current) clearTimeout(msgTimerRef.current)
    setMsg({ tipo, texto })
    if (tipo === 'ok') msgTimerRef.current = setTimeout(() => setMsg(null), 3000)
  }

  // Si el servidor regresa el detalle completo lo usamos; si no, lo volvemos a pedir.
  async function aplicarPedido(p: PedidoWebDetalle | undefined, id: number) {
    if (p && Array.isArray(p.lineas)) { setPedido(p); return }
    setPedido(await api.getPedidoWeb(id))
  }

  async function abrirPedido(id: number) {
    if (cargando) return
    setCargando(true)
    setError('')
    setMsg(null)
    setInputManual('')
    try {
      const p = await api.getPedidoWeb(id)
      setPedido(p)
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
    setPedido(null)
    setMsg(null)
    setInputManual('')
    setError('')
    setExito(null)
  }

  // ── Escaneo ────────────────────────────────────────────────────────────────
  function handleScanInput(val: string) {
    setInputManual(val)
    if (scanTimerRef.current) clearTimeout(scanTimerRef.current)
    if (val.trim().length >= 4)
      scanTimerRef.current = setTimeout(() => escanear(val.trim()), 150)
  }

  const escanear = useCallback(async (codigo: string) => {
    const p = pedidoRef.current
    const cod = codigo.trim()
    if (scanTimerRef.current) { clearTimeout(scanTimerRef.current); scanTimerRef.current = null }
    if (!p || !cod || busyRef.current) return
    busyRef.current = true
    setCargando(true)
    setInputManual('')
    try {
      const res = await api.escanearPedidoWeb(p.id, cod, 1)
      beepScan()
      mostrarMsg('ok', `OK · ${res.linea.titulo} (${res.linea.escaneado}/${res.linea.cantidad})`)
      setPedido(prev => {
        if (!prev) return prev
        return {
          ...prev,
          estado: prev.estado === 'nuevo' ? 'preparando' : prev.estado,
          escaneadas: res.progreso?.escaneadas ?? prev.escaneadas,
          completo: !!res.completo,
          lineas: prev.lineas.map(l => l.id === res.linea.id ? { ...l, escaneado: res.linea.escaneado } : l),
        }
      })
    } catch (e) {
      beepError()
      mostrarMsg('error', (e as Error).message)
    } finally {
      busyRef.current = false
      setCargando(false)
    }
  }, [])

  // El lector solo actúa en el detalle del pedido (en la lista no hace nada).
  useBarcodeScan(escanear, paso === 'detalle')

  // Conteo manual (− / +) para líneas sin código o correcciones
  async function ajustarLinea(l: LineaPedidoWeb, delta: number) {
    if (!pedido || registrandoRef.current || busyRef.current) return
    const nuevo = Math.max(0, Math.min(l.cantidad, l.escaneado + delta))
    if (nuevo === l.escaneado) return
    registrandoRef.current = true
    setCargando(true)
    try {
      const res = await api.setEscaneadoLinea(pedido.id, l.id, nuevo)
      await aplicarPedido(res.pedido, pedido.id)
      beepScan()
      mostrarMsg('ok', `${l.titulo}: ${nuevo}/${l.cantidad}`)
    } catch (e) {
      beepError()
      mostrarMsg('error', (e as Error).message)
    } finally {
      registrandoRef.current = false
      setCargando(false)
    }
  }

  async function reiniciar() {
    if (!pedido || registrandoRef.current) return
    if (!window.confirm('¿Reiniciar el escaneo de este pedido? Los conteos vuelven a 0.')) return
    registrandoRef.current = true
    setCargando(true)
    try {
      const res = await api.resetEscaneoPedidoWeb(pedido.id)
      await aplicarPedido(res.pedido, pedido.id)
      setMsg(null)
      beepScan()
    } catch (e) {
      setError((e as Error).message)
      setPaso('error')
      beepError()
    } finally {
      registrandoRef.current = false
      setCargando(false)
    }
  }

  // ── Estado: listo / entregado / enviado ────────────────────────────────────
  const lineas       = pedido?.lineas ?? []
  const totalPiezas  = lineas.reduce((s, l) => s + l.cantidad, 0)
  const piezasHechas = lineas.reduce((s, l) => s + Math.min(l.escaneado, l.cantidad), 0)
  const completo     = lineas.length > 0 && lineas.every(l => l.escaneado >= l.cantidad)
  const pct          = totalPiezas > 0 ? Math.min(100, Math.round((piezasHechas / totalPiezas) * 100)) : 0
  const esFinal      = pedido ? ['entregado', 'enviado', 'cancelado'].includes(pedido.estado) : false
  const accionFinal: { estado: EstadoPedidoWeb; label: string; verbo: string } =
    pedido?.tipo_entrega === 'recoger'
      ? { estado: 'entregado', label: '📦 Entregado', verbo: 'entregado' }
      : { estado: 'enviado',   label: '🚚 Enviado',   verbo: 'enviado' }

  async function marcarListo() {
    if (!pedido || registrandoRef.current) return
    if (!completo && !window.confirm('¿Marcar como listo sin haber escaneado todo?')) return
    registrandoRef.current = true
    setCargando(true)
    try {
      const { status, body } = await api.cambiarEstadoPedidoWeb(pedido.id, 'listo', {})
      if (status < 200 || status >= 300 || !body.ok)
        throw new Error(body.error ?? body.mensaje ?? `Error ${status}`)
      await aplicarPedido(body.pedido, pedido.id)
      beepOk()
      mostrarMsg('ok', `Pedido ${pedido.numero} marcado como listo`)
    } catch (e) {
      setError((e as Error).message)
      setPaso('error')
      beepError()
    } finally {
      registrandoRef.current = false
      setCargando(false)
    }
  }

  // Entregado (recoger) / Enviado (envío o local) = SALIDA física de bodega.
  // 402 requiereForzar = el pago sigue pendiente → preguntar y reintentar con forzar.
  async function entregar(forzar = false) {
    if (!pedido || registrandoRef.current) return
    if (!forzar && !window.confirm(`Se descontarán ${totalPiezas} piezas de bodega. ¿Confirmar?`)) return
    registrandoRef.current = true
    setCargando(true)
    try {
      const { status, body } = await api.cambiarEstadoPedidoWeb(pedido.id, accionFinal.estado, { forzar })
      if (status === 402 && body.requiereForzar) {
        registrandoRef.current = false
        setCargando(false)
        if (window.confirm('El pago sigue pendiente en la página. ¿Ya se cobró? Entregar de todos modos')) {
          await entregar(true)
        }
        return
      }
      if (status < 200 || status >= 300 || !body.ok)
        throw new Error(body.error ?? body.mensaje ?? `Error ${status}`)
      const descontadas = body.descontadas ?? totalPiezas
      const sinConteo   = body.sinConteo ?? 0
      setExito({
        titulo: `Pedido ${pedido.numero} ${accionFinal.verbo}`,
        sub:    `${descontadas} ${descontadas === 1 ? 'pieza descontada' : 'piezas descontadas'} de bodega`,
        nota:   sinConteo > 0 ? `${sinConteo} pza(s) sin conteo en bodega no se descontaron` : '',
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

  const btnMini = (off: boolean): CSSProperties => ({
    minWidth: 44, minHeight: 44, borderRadius: 10, padding: 0,
    border: '1.5px solid rgba(0,0,0,0.12)', background: 'white',
    fontSize: 22, fontWeight: 700, color: off ? '#ccc' : '#1a1a18',
  })

  // ── Lista de pedidos ───────────────────────────────────────────────────────
  if (paso === 'lista') return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <p style={{ fontSize: 16, fontWeight: 700, color: '#1a1a18' }}>Pedidos por preparar</p>
          <p style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>Toca un pedido para escanearlo</p>
        </div>
        <button
          onClick={() => cargarLista()}
          disabled={cargandoLista}
          style={{
            padding: '10px 14px', borderRadius: 12, minHeight: 44, flexShrink: 0,
            background: MORADO_BG, color: MORADO_DARK, fontSize: 13, fontWeight: 600,
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

      {cargandoLista && pedidos.length === 0 ? (
        <p style={{ textAlign: 'center', color: MORADO, fontSize: 14, padding: '20px 0' }}>
          Cargando pedidos...
        </p>
      ) : pedidos.length === 0 ? (
        <div style={{
          background: '#f9f9f7', borderRadius: 14, padding: '20px 16px',
          border: '1.5px dashed rgba(0,0,0,0.10)', textAlign: 'center',
        }}>
          <p style={{ fontSize: 30, marginBottom: 8 }}>🛒</p>
          <p style={{ fontSize: 14, color: '#aaa' }}>Sin pedidos pendientes</p>
          <p style={{ fontSize: 12, color: '#bbb', marginTop: 4 }}>
            Los pedidos de la página web aparecen aquí solos
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {pedidos.map(p => {
            const borde = p.estado === 'listo' ? '2px solid #1D9E75'
              : p.estado === 'preparando' ? '2px solid #3B82F6'
              : '1.5px solid rgba(0,0,0,0.10)'
            const todo = p.unidades > 0 && p.escaneadas >= p.unidades
            return (
              <button
                key={p.id}
                onClick={() => abrirPedido(p.id)}
                disabled={cargando}
                style={{
                  background: 'white', borderRadius: 14, padding: '14px 16px',
                  border: borde, textAlign: 'left', cursor: 'pointer', width: '100%',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 15, fontWeight: 700, color: '#1a1a18', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.numero}
                      <span style={{ fontWeight: 500, color: '#5F5E5A' }}> · {p.cliente_nombre || 'Sin nombre'}</span>
                    </p>
                    <p style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>
                      {p.n_lineas} productos · {p.unidades} pzas
                    </p>
                    {p.fecha_pedido && (
                      <p style={{ fontSize: 11, color: '#bbb', marginTop: 2 }}>{fechaCorta(p.fecha_pedido)}</p>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: ESTADO_COLOR[p.estado] ?? '#aaa' }}>
                      {ESTADO_TXT[p.estado] ?? p.estado}
                    </p>
                    <p style={{ fontSize: 11, color: '#5F5E5A', marginTop: 2 }}>
                      {ENTREGA_TXT[p.tipo_entrega] ?? p.tipo_entrega}
                    </p>
                    <p style={{ fontSize: 11, fontWeight: 600, color: todo ? '#1D9E75' : '#aaa', marginTop: 2 }}>
                      {p.escaneadas}/{p.unidades} escaneadas
                    </p>
                  </div>
                </div>

                {(p.faltantes > 0 || p.sin_codigo > 0 || !p.pago_ok) && (
                  <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                    {p.faltantes > 0 && (
                      <span style={{ fontSize: 12, color: '#712B13', fontWeight: 600 }}>⚠ Faltan {p.faltantes}</span>
                    )}
                    {p.sin_codigo > 0 && (
                      <span style={{ fontSize: 12, color: '#712B13', fontWeight: 600 }}>⚠ Sin código</span>
                    )}
                    {!p.pago_ok && (
                      <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 99, background: '#FAECE7', color: '#712B13', fontWeight: 700 }}>
                        PAGO PENDIENTE
                      </span>
                    )}
                  </div>
                )}
                {p.notas_cliente && (
                  <p style={{ fontSize: 12, color: '#5F5E5A', fontStyle: 'italic', marginTop: 6 }}>
                    “{p.notas_cliente}”
                  </p>
                )}
              </button>
            )
          })}
        </div>
      )}

      {cargando && <p style={{ textAlign: 'center', color: MORADO, fontSize: 14 }}>Abriendo pedido...</p>}
    </div>
  )

  // ── Detalle: escanear el pedido ────────────────────────────────────────────
  if (paso === 'detalle' && pedido) return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Chip pedido activo */}
      <div style={{
        background: MORADO_BG, borderRadius: 12, padding: '10px 14px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 11, color: MORADO_DARK, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Pedido activo</p>
          <p style={{ fontSize: 14, fontWeight: 700, color: MORADO_DARK }}>
            {pedido.numero} · {pedido.cliente_nombre || 'Sin nombre'}
          </p>
          <p style={{ fontSize: 12, color: MORADO_DARK, opacity: 0.8, marginTop: 2 }}>
            {ENTREGA_TXT[pedido.tipo_entrega] ?? pedido.tipo_entrega} · {ESTADO_TXT[pedido.estado] ?? pedido.estado}
          </p>
        </div>
        <button onClick={volverLista} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: MORADO_DARK, opacity: 0.5, padding: '4px 8px' }}>✕</button>
      </div>

      {!pedido.pago_ok && (
        <div style={{ background: '#FAECE7', borderRadius: 12, padding: '10px 14px' }}>
          <p style={{ color: '#712B13', fontSize: 13, fontWeight: 700 }}>PAGO PENDIENTE · cobra antes de entregar</p>
        </div>
      )}
      {pedido.notas_cliente && (
        <p style={{ fontSize: 13, color: '#5F5E5A', fontStyle: 'italic', padding: '0 4px' }}>
          Nota del cliente: “{pedido.notas_cliente}”
        </p>
      )}

      {/* Objetivo de escaneo + input manual */}
      <div style={{
        background: 'white', borderRadius: 18,
        border: '2px dashed rgba(124,58,237,0.35)',
        padding: '22px 16px', textAlign: 'center',
      }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>🛒</div>
        <p style={{ fontSize: 15, color: '#5F5E5A', marginBottom: 4 }}>Escanea cada producto del pedido</p>
        <p style={{ fontSize: 13, color: '#aaa' }}>Cada lectura cuenta 1 pieza</p>
      </div>

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
          style={{ padding: '14px 18px', background: MORADO, color: 'white', borderRadius: 12, fontSize: 20, minWidth: 52 }}
        >→</button>
      </div>

      {msg && (
        <div style={{ background: msg.tipo === 'ok' ? '#E1F5EE' : '#FAECE7', borderRadius: 12, padding: '12px 14px' }}>
          <p style={{ color: msg.tipo === 'ok' ? '#085041' : '#712B13', fontSize: 14, fontWeight: 600 }}>{msg.texto}</p>
        </div>
      )}
      {cargando && <p style={{ textAlign: 'center', color: MORADO, fontSize: 13 }}>Guardando...</p>}

      {completo && (
        <div style={{ background: '#1D9E75', color: 'white', borderRadius: 12, padding: '12px 14px', textAlign: 'center' }}>
          <p style={{ fontSize: 16, fontWeight: 700 }}>Todo escaneado ✓</p>
        </div>
      )}

      {/* Barra de progreso */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a18' }}>Progreso</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: completo ? '#1D9E75' : MORADO }}>
            {piezasHechas} / {totalPiezas} piezas
          </span>
        </div>
        <div style={{ height: 10, borderRadius: 99, background: '#F1EFE8', overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: completo ? '#1D9E75' : MORADO, transition: 'width 0.2s' }} />
        </div>
      </div>

      {/* Líneas del pedido */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {lineas.length === 0 && (
          <p style={{ textAlign: 'center', color: '#aaa', fontSize: 13 }}>Este pedido no tiene productos</p>
        )}
        {lineas.map(l => {
          const hecha = l.cantidad > 0 && l.escaneado >= l.cantidad
          return (
            <div key={l.id} style={{
              background: 'white', borderRadius: 14, padding: '12px 14px',
              border: hecha ? '2px solid #1D9E75' : '1.5px solid rgba(0,0,0,0.10)',
            }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 15, fontWeight: 600, color: '#1a1a18', lineHeight: 1.25 }}>
                    {l.titulo}
                    {l.variante && <span style={{ fontWeight: 400, color: '#5F5E5A' }}> · {l.variante}</span>}
                  </p>
                  <p style={{ fontSize: 11, color: '#aaa', fontFamily: 'monospace', marginTop: 2 }}>
                    {l.codigo_barras ?? '—'}
                  </p>
                  {l.stock_area ? (
                    <p style={{ fontSize: 12, color: '#5F5E5A', marginTop: 4 }}>
                      Surtir de: <b>{l.stock_area.ubicacion}</b> · disp {l.stock_area.disponible}
                    </p>
                  ) : l.ubicacion ? (
                    <p style={{ fontSize: 12, color: '#5F5E5A', marginTop: 4 }}>
                      Surtir de: <b>{l.ubicacion}</b> · sin conteo
                    </p>
                  ) : null}
                  {l.faltante > 0 && (
                    <p style={{ fontSize: 12, color: '#712B13', fontWeight: 600, marginTop: 4 }}>
                      ⚠ Faltan {l.faltante} — no hay stock contado
                    </p>
                  )}
                  {!l.codigo_barras && (
                    <p style={{ fontSize: 12, color: '#B45309', fontWeight: 600, marginTop: 4 }}>
                      Sin código: cuéntalo a mano
                    </p>
                  )}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <p style={{ fontSize: 24, fontWeight: 700, lineHeight: 1, color: hecha ? '#1D9E75' : '#888' }}>
                    {l.escaneado}
                    <span style={{ fontSize: 14, color: '#aaa', fontWeight: 600 }}> / {l.cantidad}</span>
                  </p>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => ajustarLinea(l, -1)}
                      disabled={cargando || l.escaneado <= 0}
                      style={btnMini(l.escaneado <= 0)}
                    >−</button>
                    <button
                      onClick={() => ajustarLinea(l, +1)}
                      disabled={cargando || l.escaneado >= l.cantidad}
                      style={btnMini(l.escaneado >= l.cantidad)}
                    >+</button>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Acciones */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
        {esFinal ? (
          <p style={{ textAlign: 'center', color: '#aaa', fontSize: 13 }}>
            Este pedido ya está {ESTADO_TXT[pedido.estado] ?? pedido.estado}
          </p>
        ) : (
          <>
            {(pedido.estado === 'nuevo' || pedido.estado === 'preparando') && (
              <button className="btn-primary" onClick={marcarListo} disabled={cargando}>
                {cargando ? 'Guardando...' : '✓ Marcar listo'}
              </button>
            )}
            <button className="btn-primary rojo" onClick={() => entregar(false)} disabled={cargando}
              style={{ background: '#D85A30' }}>
              {cargando ? 'Guardando...' : accionFinal.label}
            </button>
            <button className="btn-secondary" onClick={reiniciar} disabled={cargando}>↺ Reiniciar escaneo</button>
          </>
        )}
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
      {exito.nota && <p style={{ fontSize: 12, color: '#B45309' }}>{exito.nota}</p>}
      <div style={{ marginTop: 20, width: '100%' }}>
        <button className="btn-primary" onClick={volverLista}>Volver a pedidos</button>
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
        {pedido ? (
          <>
            <button className="btn-primary rojo" onClick={() => abrirPedido(pedido.id)} style={{ background: '#D85A30' }}>
              Intentar de nuevo
            </button>
            <button className="btn-secondary" onClick={volverLista}>← Volver a la lista</button>
          </>
        ) : (
          <button className="btn-primary rojo" onClick={volverLista} style={{ background: '#D85A30' }}>
            Volver a pedidos
          </button>
        )}
      </div>
    </div>
  )

  return null
}
