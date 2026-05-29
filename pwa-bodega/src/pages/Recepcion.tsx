import { useState, useCallback, useRef, useEffect } from 'react'
import { api, type Producto, type Ubicacion, type PedidoResumen } from '../api/inventario'
import { useBarcodeScan } from '../hooks/useBarcodeScan'

type Paso = 'pedido' | 'scan' | 'confirmar' | 'ubicar' | 'exito' | 'error'

export default function Recepcion() {
  const [paso,        setPaso]        = useState<Paso>('pedido')
  const [producto,    setProducto]    = useState<Producto | null>(null)
  const [cantidad,    setCantidad]    = useState(1)
  const [nuevoStock,  setNuevoStock]  = useState(0)
  const [error,       setError]       = useState('')
  const [cargando,    setCargando]    = useState(false)
  const [inputManual, setInputManual] = useState('')
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([])
  const [ubicSelec,   setUbicSelec]   = useState<string | null>(null)
  const [pedidos,     setPedidos]     = useState<PedidoResumen[]>([])
  const [pedidoId,    setPedidoId]    = useState<number | null>(null)
  const [pedidoFolio, setPedidoFolio] = useState<string | null>(null)
  const [cargandoPedidos, setCargandoPedidos] = useState(false)
  const scanTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const registrandoRef = useRef(false)

  useEffect(() => {
    api.getUbicaciones().then(setUbicaciones).catch(() => {})
  }, [])

  useEffect(() => {
    if (paso !== 'pedido') return
    setCargandoPedidos(true)
    api.getPedidosAbiertos()
      .then(setPedidos)
      .catch(() => setPedidos([]))
      .finally(() => setCargandoPedidos(false))
  }, [paso])

  function seleccionarPedido(id: number | null, folio: string | null) {
    setPedidoId(id)
    setPedidoFolio(folio)
    setPaso('scan')
  }

  function handleScanInput(val: string) {
    setInputManual(val)
    if (scanTimerRef.current) clearTimeout(scanTimerRef.current)
    if (val.trim().length >= 4)
      scanTimerRef.current = setTimeout(() => buscarProducto(val.trim()), 150)
  }

  const buscarProducto = useCallback(async (codigo: string) => {
    if (cargando) return
    setCargando(true)
    try {
      const prod = await api.getProducto(codigo.trim())
      setProducto(prod)
      setUbicSelec(prod.ubicacion ?? null)
      setCantidad(1)
      setPaso('confirmar')
    } catch (e) {
      setError((e as Error).message)
      setPaso('error')
    } finally {
      setCargando(false)
    }
  }, [cargando])

  useBarcodeScan(buscarProducto)

  async function confirmar() {
    if (!producto || registrandoRef.current) return
    registrandoRef.current = true
    setCargando(true)
    try {
      const res = await api.registrarEntrada(producto.codigo, cantidad, producto.nombre, pedidoId)
      setNuevoStock(res.stockActual)
      setPaso('ubicar')
    } catch (e) {
      setError((e as Error).message)
      setPaso('error')
    } finally {
      registrandoRef.current = false
      setCargando(false)
    }
  }

  async function asignarYTerminar(ubicacion: string | null) {
    if (producto && ubicacion) {
      try { await api.setUbicacion(producto.codigo, ubicacion) } catch {}
      setUbicSelec(ubicacion)
    }
    setPaso('exito')
  }

  function reset() {
    setPaso('scan')
    setProducto(null)
    setCantidad(1)
    setInputManual('')
    setError('')
    setUbicSelec(null)
  }

  function resetTotal() {
    setPedidoId(null)
    setPedidoFolio(null)
    setPaso('pedido')
    setProducto(null)
    setCantidad(1)
    setInputManual('')
    setError('')
    setUbicSelec(null)
  }

  function stockClass(s: number) {
    if (s === 0) return 'badge badge-zero'
    if (s < 5)   return 'badge badge-low'
    return 'badge badge-ok'
  }

  const colorUbic = ubicaciones.find(u => u.nombre === ubicSelec)?.color ?? '#3B82F6'

  // ── Selección de pedido ──────────────────────────────────────────────────────
  if (paso === 'pedido') return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
        <p style={{ fontSize: 16, fontWeight: 700, color: '#1a1a18' }}>¿Viene con orden de compra?</p>
        <p style={{ fontSize: 13, color: '#aaa', marginTop: 4 }}>
          Selecciona la orden para registrar discrepancias automáticamente
        </p>
      </div>

      {cargandoPedidos ? (
        <p style={{ textAlign: 'center', color: '#1D9E75', fontSize: 14, padding: '20px 0' }}>
          Cargando órdenes...
        </p>
      ) : pedidos.length === 0 ? (
        <div style={{
          background: '#f9f9f7', borderRadius: 14, padding: '20px 16px',
          border: '1.5px dashed rgba(0,0,0,0.10)', textAlign: 'center',
        }}>
          <p style={{ fontSize: 30, marginBottom: 8 }}>📋</p>
          <p style={{ fontSize: 14, color: '#aaa' }}>Sin órdenes abiertas</p>
          <p style={{ fontSize: 12, color: '#bbb', marginTop: 4 }}>
            Créalas desde el panel admin → Bodega → Recepción
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {pedidos.map(p => {
            const pct = p.total_esperado > 0
              ? Math.min(100, Math.round((p.total_recibido / p.total_esperado) * 100))
              : 0
            const esEnRecepcion = p.estado === 'en_recepcion'
            return (
              <button
                key={p.id}
                onClick={() => seleccionarPedido(p.id, p.folio)}
                style={{
                  background: 'white', borderRadius: 14, padding: '14px 16px',
                  border: esEnRecepcion ? '2px solid #1D9E75' : '1.5px solid rgba(0,0,0,0.10)',
                  textAlign: 'left', cursor: 'pointer', width: '100%',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 15, fontWeight: 700, color: '#1a1a18' }}>{p.folio}</p>
                    <p style={{ fontSize: 12, color: '#aaa', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.proveedor || 'Sin proveedor'} · {p.num_items} productos
                    </p>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: esEnRecepcion ? '#1D9E75' : '#aaa' }}>
                      {esEnRecepcion ? '🟢 En recepción' : '🟡 Pendiente'}
                    </p>
                    <p style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>
                      {p.total_recibido}/{p.total_esperado} uds · {pct}%
                    </p>
                  </div>
                </div>
                {esEnRecepcion && (
                  <div style={{ marginTop: 10, height: 4, background: '#E5F7F0', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: '#1D9E75', width: `${pct}%`, borderRadius: 4 }} />
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}

      <button
        onClick={() => seleccionarPedido(null, null)}
        style={{
          padding: '14px', border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 14,
          background: 'white', fontSize: 14, color: '#5F5E5A', cursor: 'pointer',
          fontWeight: 500,
        }}
      >
        Continuar sin orden de compra →
      </button>
    </div>
  )

  // ── Escanear ─────────────────────────────────────────────────────────────────
  if (paso === 'scan') return (
    <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {pedidoFolio && (
        <div style={{
          background: '#E5F7F0', borderRadius: 12, padding: '10px 14px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        }}>
          <div>
            <p style={{ fontSize: 11, color: '#085041', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Orden activa
            </p>
            <p style={{ fontSize: 14, fontWeight: 700, color: '#085041', fontFamily: 'monospace' }}>
              {pedidoFolio}
            </p>
          </div>
          <button
            onClick={resetTotal}
            style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#085041', opacity: 0.5, padding: '4px 8px' }}
            title="Cambiar orden"
          >✕</button>
        </div>
      )}

      <div style={{
        background: 'white', borderRadius: 18,
        border: '2px dashed rgba(29,158,117,0.35)',
        padding: '32px 20px', textAlign: 'center',
      }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>📦</div>
        <p style={{ fontSize: 15, color: '#5F5E5A', marginBottom: 4 }}>Apunta el lector al código</p>
        <p style={{ fontSize: 13, color: '#aaa' }}>El scanner enviará el código automáticamente</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={{ fontSize: 13, color: '#5F5E5A' }}>O escribe el código manualmente</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            autoFocus
            value={inputManual}
            onChange={e => handleScanInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && inputManual.trim() && buscarProducto(inputManual.trim())}
            placeholder="Código de barras..."
            style={{
              flex: 1, padding: '14px', fontSize: 16,
              border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 12,
              background: 'white', color: '#1a1a18',
            }}
          />
          <button
            onClick={() => inputManual.trim() && buscarProducto(inputManual)}
            style={{ padding: '14px 18px', background: '#1D9E75', color: 'white', borderRadius: 12, fontSize: 20, minWidth: 52 }}
          >→</button>
        </div>
      </div>

      {cargando && <p style={{ textAlign: 'center', color: '#1D9E75', fontSize: 14 }}>Buscando producto...</p>}
    </div>
  )

  // ── Confirmar cantidad ───────────────────────────────────────────────────────
  if (paso === 'confirmar' && producto) return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {pedidoFolio && (
        <div style={{
          background: '#E5F7F0', borderRadius: 10, padding: '8px 12px',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ fontSize: 13, color: '#085041' }}>📋</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#085041', fontFamily: 'monospace' }}>{pedidoFolio}</span>
        </div>
      )}

      <div className="card">
        <p style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>{producto.nombre}</p>
        <p style={{ fontSize: 12, color: '#aaa', fontFamily: 'monospace', marginBottom: 10 }}>{producto.codigo}</p>
        <span className={stockClass(producto.stock)}>Stock actual: {producto.stock} pzas</span>
      </div>

      <div>
        <p style={{ fontSize: 14, color: '#5F5E5A', marginBottom: 10 }}>¿Cuántas piezas llegaron?</p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
          <button
            onClick={() => setCantidad(c => Math.max(1, c - 1))}
            style={{ width: 80, minHeight: 80, fontSize: 36, fontWeight: 300, border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 16, background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          >−</button>
          <input
            data-manual="true"
            type="number"
            value={cantidad}
            min={1}
            onChange={e => setCantidad(Math.max(1, parseInt(e.target.value) || 1))}
            style={{
              flex: 1, textAlign: 'center', fontSize: 40, fontWeight: 700,
              border: '1.5px solid rgba(29,158,117,0.4)', borderRadius: 16,
              padding: '16px 0', background: 'white', color: '#1a1a18', minWidth: 0,
            }}
          />
          <button
            onClick={() => setCantidad(c => c + 1)}
            style={{ width: 80, minHeight: 80, fontSize: 36, fontWeight: 300, border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 16, background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          >+</button>
        </div>
        <p style={{ fontSize: 13, color: '#1D9E75', textAlign: 'center', marginTop: 8 }}>
          Nuevo stock: {producto.stock + cantidad} pzas
        </p>
      </div>

      <button className="btn-primary" onClick={confirmar} disabled={cargando}>
        {cargando ? 'Guardando...' : '✓ Confirmar entrada'}
      </button>
      <button className="btn-secondary" onClick={reset}>Cancelar</button>
    </div>
  )

  // ── Asignar ubicación ────────────────────────────────────────────────────────
  if (paso === 'ubicar' && producto) return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ textAlign: 'center', padding: '8px 0' }}>
        <p style={{ fontSize: 16, fontWeight: 700, color: '#085041' }}>
          ✓ +{cantidad} pzas registradas
        </p>
        <p style={{ fontSize: 13, color: '#5F5E5A', marginTop: 4 }}>{producto.nombre}</p>
      </div>

      <p style={{ fontSize: 15, fontWeight: 600, color: '#1a1a18' }}>¿Dónde va este producto?</p>

      {ubicaciones.length === 0 ? (
        <p style={{ textAlign: 'center', color: '#aaa', fontSize: 13 }}>
          Sin ubicaciones. Usa ⚙ para configurarlas.
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {ubicaciones.map(u => (
            <button
              key={u.id}
              onClick={() => asignarYTerminar(u.nombre)}
              style={{
                padding: '20px 12px', borderRadius: 14, cursor: 'pointer',
                border: ubicSelec === u.nombre ? `2.5px solid ${u.color}` : '1.5px solid rgba(0,0,0,0.10)',
                background: ubicSelec === u.nombre ? `${u.color}18` : 'white',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
              }}
            >
              <div style={{ width: 14, height: 14, borderRadius: '50%', background: u.color }} />
              <span style={{
                fontSize: 13, fontWeight: ubicSelec === u.nombre ? 700 : 500,
                color: ubicSelec === u.nombre ? u.color : '#1a1a18',
                textAlign: 'center', lineHeight: 1.3,
              }}>
                {u.nombre}
              </span>
            </button>
          ))}
        </div>
      )}

      <button className="btn-secondary" onClick={() => asignarYTerminar(null)}>
        Omitir ubicación
      </button>
    </div>
  )

  // ── Éxito ────────────────────────────────────────────────────────────────────
  if (paso === 'exito' && producto) return (
    <div style={{
      padding: '40px 24px', display: 'flex', flexDirection: 'column',
      alignItems: 'center', textAlign: 'center', gap: 12,
    }}>
      <div style={{
        width: 80, height: 80, borderRadius: '50%',
        background: '#E1F5EE', display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 36, marginBottom: 8,
      }}>✓</div>
      <p style={{ fontSize: 20, fontWeight: 700, color: '#085041' }}>Entrada registrada</p>
      <p style={{ fontSize: 15, color: '#5F5E5A' }}>+{cantidad} pzas · {producto.nombre}</p>
      <p style={{ fontSize: 14, color: '#1D9E75', fontWeight: 600 }}>Stock nuevo: {nuevoStock} pzas</p>
      {ubicSelec && (
        <span style={{
          fontSize: 13, padding: '5px 14px', borderRadius: 20, fontWeight: 600,
          background: `${colorUbic}20`, color: colorUbic,
        }}>
          📍 {ubicSelec}
        </span>
      )}
      {pedidoFolio && (
        <span style={{
          fontSize: 12, padding: '4px 12px', borderRadius: 20,
          background: '#E5F7F0', color: '#085041', fontFamily: 'monospace',
        }}>
          📋 {pedidoFolio}
        </span>
      )}
      <div style={{ marginTop: 20, width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button className="btn-primary" onClick={reset}>Escanear otro producto</button>
        <button className="btn-secondary" onClick={resetTotal}>Cambiar orden</button>
      </div>
    </div>
  )

  // ── Error ────────────────────────────────────────────────────────────────────
  if (paso === 'error') return (
    <div style={{
      padding: '40px 24px', display: 'flex', flexDirection: 'column',
      alignItems: 'center', textAlign: 'center', gap: 12,
    }}>
      <div style={{ width: 80, height: 80, borderRadius: '50%', background: '#FAECE7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, marginBottom: 8 }}>✕</div>
      <p style={{ fontSize: 18, fontWeight: 700, color: '#712B13' }}>Error</p>
      <p style={{ fontSize: 14, color: '#5F5E5A' }}>{error}</p>
      <div style={{ marginTop: 20, width: '100%' }}>
        <button className="btn-primary" onClick={reset}>Intentar de nuevo</button>
      </div>
    </div>
  )

  return null
}
