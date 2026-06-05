import { useState, useCallback, useRef, useEffect } from 'react'
import { api, type Producto, type Ubicacion, type RecepcionEsperada } from '../api/inventario'
import { useBarcodeScan } from '../hooks/useBarcodeScan'
import { beepScan, beepOk, beepError } from '../utils/beep'
import ContadorCantidad from '../components/ContadorCantidad'

type Paso = 'pedido' | 'scan' | 'confirmar' | 'exito' | 'error'

export default function Recepcion() {
  const [paso,        setPaso]        = useState<Paso>('pedido')
  const [producto,    setProducto]    = useState<Producto | null>(null)
  const [error,       setError]       = useState('')
  const [cargando,    setCargando]    = useState(false)
  const [inputManual, setInputManual] = useState('')
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([])
  const [ubicSelec,   setUbicSelec]   = useState<string>('Sin ubicar')
  const [pedidos,     setPedidos]     = useState<RecepcionEsperada[]>([])
  const [pedidoFolio, setPedidoFolio] = useState<string | null>(null)
  const [cargandoPedidos, setCargandoPedidos] = useState(false)
  // Recepción real activa + captura de lote/caducidad
  const [recepcionRealId, setRecepcionRealId] = useState<number | null>(null)
  const [caducidad,   setCaducidad]   = useState('')
  const [lote,        setLote]        = useState('')
  // Resultado del último renglón registrado (para pantalla de éxito)
  const [piezasResult, setPiezasResult] = useState(0)
  const [piezasPorCaja, setPiezasPorCaja] = useState(1)
  const [cajasResult, setCajasResult] = useState(0)
  // Entrada directa (sin orden): suma al stock al instante y aparece en Historial
  const [modoDirecto,     setModoDirecto]     = useState(false)
  const [totalConteo,     setTotalConteo]     = useState(0)
  const [stockTrasEntrada, setStockTrasEntrada] = useState(0)
  const scanTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const registrandoRef = useRef(false)

  useEffect(() => {
    api.getUbicaciones().then(u => {
      setUbicaciones(u)
      if (u.length > 0) setUbicSelec(u[0].nombre)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (paso !== 'pedido') return
    setCargandoPedidos(true)
    api.getRecepcionesEsperadas()
      .then(setPedidos)
      .catch(() => setPedidos([]))
      .finally(() => setCargandoPedidos(false))
  }, [paso])

  async function seleccionarPedido(id: number | null, folio: string | null) {
    if (cargando) return
    setError('')
    setCargando(true)
    try {
      const res = await api.abrirRecepcionReal(id, 'TC52')
      setRecepcionRealId(res.id)
      setPedidoFolio(folio)
      setPaso('scan')
    } catch (e) {
      setError((e as Error).message)
      setPaso('error')
      beepError()
    } finally {
      setCargando(false)
    }
  }

  function iniciarEntradaDirecta() {
    setModoDirecto(true)
    setRecepcionRealId(null)
    setPedidoFolio(null)
    setError('')
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
      setTotalConteo(0)
      setPaso('confirmar')
      beepScan()
    } catch (e) {
      setError((e as Error).message)
      setPaso('error')
      beepError()
    } finally {
      setCargando(false)
    }
  }, [cargando])

  useBarcodeScan(buscarProducto)

  async function confirmar() {
    if (!producto || registrandoRef.current) return

    // ── Entrada directa: suma al stock al instante y aparece en Historial ──
    if (modoDirecto) {
      if (totalConteo < 1) {
        setError('La cantidad debe ser mayor a 0.')
        setPaso('error'); beepError(); return
      }
      registrandoRef.current = true
      setCargando(true)
      try {
        const res = await api.registrarEntrada(producto.codigo, totalConteo, producto.nombre, null, ubicSelec)
        setPiezasResult(totalConteo)
        setPiezasPorCaja(1)
        setCajasResult(0)
        setStockTrasEntrada(res.stockActual)
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
      return
    }

    // ── Entrada con orden de compra (conversión caja→pieza en el backend) ──
    if (recepcionRealId == null) {
      setError('No hay una recepción activa. Vuelve a elegir la orden.')
      setPaso('error')
      beepError()
      return
    }
    registrandoRef.current = true
    setCargando(true)
    try {
      const res = await api.agregarItemRecepcion(recepcionRealId, {
        codigo_barras: producto.codigo,
        cajas_recibidas: totalConteo,
        ubicacion: ubicSelec,
        // piezas_por_caja se resuelve en el backend desde la orden esperada (conversión caja→pieza)
        lote: lote.trim() || undefined,
        caducidad: caducidad || undefined,
      })
      setPiezasResult(res.piezas_resultantes)
      setPiezasPorCaja(res.piezas_por_caja)
      setCajasResult(totalConteo)
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

  function reset() {
    // Entrada directa o recepción activa → vuelve a escanear; si no, a elegir orden.
    setPaso(modoDirecto || recepcionRealId != null ? 'scan' : 'pedido')
    setProducto(null)
    setTotalConteo(0)
    setInputManual('')
    setError('')
    setCaducidad('')
    setLote('')
    if (ubicaciones.length > 0) setUbicSelec(ubicaciones[0].nombre)
  }

  function resetTotal() {
    setModoDirecto(false)
    setRecepcionRealId(null)
    setPedidoFolio(null)
    setPaso('pedido')
    setProducto(null)
    setTotalConteo(0)
    setInputManual('')
    setError('')
    setCaducidad('')
    setLote('')
  }

  function stockClass(s: number) {
    if (s === 0) return 'badge badge-zero'
    if (s < 5)   return 'badge badge-low'
    return 'badge badge-ok'
  }

  const colorUbic = ubicaciones.find(u => u.nombre === ubicSelec)?.color ?? '#1D9E75'

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
            const esEnRecepcion = p.estatus === 'Parcial'
            const titulo = p.referencia || `Orden #${p.id}`
            return (
              <button
                key={p.id}
                onClick={() => seleccionarPedido(p.id, titulo)}
                style={{
                  background: 'white', borderRadius: 14, padding: '14px 16px',
                  border: esEnRecepcion ? '2px solid #1D9E75' : '1.5px solid rgba(0,0,0,0.10)',
                  textAlign: 'left', cursor: 'pointer', width: '100%',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 15, fontWeight: 700, color: '#1a1a18' }}>{titulo}</p>
                    <p style={{ fontSize: 12, color: '#aaa', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.proveedor || 'Sin proveedor'} · {p.num_items} productos
                    </p>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: esEnRecepcion ? '#1D9E75' : '#aaa' }}>
                      {esEnRecepcion ? '🟢 En recepción' : '🟡 Pendiente'}
                    </p>
                    <p style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>
                      {p.total_cajas_esperadas} cajas esperadas
                    </p>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      <button
        onClick={iniciarEntradaDirecta}
        style={{
          padding: '16px', border: 'none', borderRadius: 14,
          background: '#1D9E75', fontSize: 15, color: 'white', cursor: 'pointer', fontWeight: 700,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
        }}
      >
        <span>📦 Entrada rápida (sin orden)</span>
        <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.85 }}>Suma al stock al instante · aparece en Historial</span>
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
            <p style={{ fontSize: 11, color: '#085041', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Orden activa</p>
            <p style={{ fontSize: 14, fontWeight: 700, color: '#085041', fontFamily: 'monospace' }}>{pedidoFolio}</p>
          </div>
          <button onClick={resetTotal} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#085041', opacity: 0.5, padding: '4px 8px' }}>✕</button>
        </div>
      )}
      {modoDirecto && (
        <div style={{
          background: '#E5F7F0', borderRadius: 12, padding: '10px 14px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        }}>
          <div>
            <p style={{ fontSize: 11, color: '#085041', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Entrada rápida</p>
            <p style={{ fontSize: 13, color: '#085041' }}>Suma al stock al instante</p>
          </div>
          <button onClick={resetTotal} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#085041', opacity: 0.5, padding: '4px 8px' }}>✕</button>
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

  // ── Confirmar cantidad + ubicación ───────────────────────────────────────────
  if (paso === 'confirmar' && producto) return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {pedidoFolio && (
        <div style={{ background: '#E5F7F0', borderRadius: 10, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: '#085041' }}>📋</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#085041', fontFamily: 'monospace' }}>{pedidoFolio}</span>
        </div>
      )}

      <div className="card">
        <p style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>{producto.nombre}</p>
        <p style={{ fontSize: 12, color: '#aaa', fontFamily: 'monospace', marginBottom: 10 }}>{producto.codigo}</p>
        <span className={stockClass(producto.stock)}>Stock actual: {producto.stock} pzas</span>
      </div>

      {/* Conteo: directo en piezas (suma al stock) u órdenes en cajas (convierte) */}
      <div>
        <p style={{ fontSize: 14, color: '#5F5E5A', marginBottom: 10 }}>
          {modoDirecto ? '¿Cuánto llegó?' : '¿Cuántas cajas llegaron?'}
        </p>
        <ContadorCantidad
          unidad={modoDirecto ? 'piezas' : 'cajas'}
          color="#1D9E75"
          onChange={t => setTotalConteo(t)}
        />
        {!modoDirecto && (
          <p style={{ fontSize: 12, color: '#1D9E75', textAlign: 'center', marginTop: 8 }}>
            Se convierte a piezas al confirmar (según la orden)
          </p>
        )}
      </div>

      {/* Ubicación destino */}
      {ubicaciones.length > 0 && (
        <div>
          <p style={{ fontSize: 14, color: '#5F5E5A', marginBottom: 8 }}>¿Dónde va este producto?</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {ubicaciones.map(u => (
              <button
                key={u.id}
                onClick={() => setUbicSelec(u.nombre)}
                style={{
                  padding: '14px 10px', borderRadius: 12, cursor: 'pointer',
                  border: ubicSelec === u.nombre ? `2px solid ${u.color}` : '1.5px solid rgba(0,0,0,0.08)',
                  background: ubicSelec === u.nombre ? `${u.color}18` : 'white',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                }}
              >
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: u.color }} />
                <span style={{
                  fontSize: 12, fontWeight: ubicSelec === u.nombre ? 700 : 400,
                  color: ubicSelec === u.nombre ? u.color : '#5F5E5A',
                  textAlign: 'center', lineHeight: 1.3,
                }}>
                  {u.nombre}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Caducidad y lote (solo en recepción con orden) */}
      {!modoDirecto && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 14, color: '#5F5E5A' }}>Fecha de caducidad (opcional)</label>
            <input
              data-manual="true"
              type="date"
              value={caducidad}
              onChange={e => setCaducidad(e.target.value)}
              style={{
                padding: '14px', fontSize: 16,
                border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 12,
                background: 'white', color: '#1a1a18',
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 14, color: '#5F5E5A' }}>Lote / Partida (opcional)</label>
            <input
              data-manual="true"
              type="text"
              value={lote}
              onChange={e => setLote(e.target.value)}
              placeholder="Ej. L-2026-014"
              style={{
                padding: '14px', fontSize: 16,
                border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 12,
                background: 'white', color: '#1a1a18',
              }}
            />
          </div>
        </>
      )}

      <button className="btn-primary" onClick={confirmar} disabled={cargando || totalConteo < 1}>
        {cargando ? 'Guardando...' : totalConteo < 1 ? 'Indica la cantidad' : '✓ Confirmar entrada'}
      </button>
      <button className="btn-secondary" onClick={reset}>Cancelar</button>
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
      <p style={{ fontSize: 15, color: '#5F5E5A' }}>{producto.nombre}</p>
      <p style={{ fontSize: 17, fontWeight: 700, color: '#085041' }}>
        {piezasResult} piezas registradas
      </p>
      {piezasPorCaja > 1 && (
        <p style={{ fontSize: 13, color: '#5F5E5A', marginTop: -4 }}>
          {cajasResult} {cajasResult === 1 ? 'caja' : 'cajas'} × {piezasPorCaja} piezas
        </p>
      )}
      <p style={{ fontSize: 14, color: '#1D9E75', fontWeight: 600 }}>
        Stock actual: {modoDirecto ? stockTrasEntrada : producto.stock} pzas
      </p>
      <p style={{ fontSize: 12, color: '#aaa', maxWidth: 260 }}>
        {modoDirecto
          ? 'Ya se sumó al stock · puedes corregirlo en el Historial'
          : 'Se sumará al stock cuando se confirme la recepción'}
      </p>
      <span style={{
        fontSize: 13, padding: '5px 14px', borderRadius: 20, fontWeight: 600,
        background: `${colorUbic}20`, color: colorUbic,
      }}>
        📍 {ubicSelec}
      </span>
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
        <button className="btn-secondary" onClick={resetTotal}>{modoDirecto ? 'Terminar' : 'Cambiar orden'}</button>
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
