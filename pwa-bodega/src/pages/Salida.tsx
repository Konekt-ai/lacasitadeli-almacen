import { useState, useCallback, useRef } from 'react'
import { api, type Producto, type StockUbicacion, type Ubicacion } from '../api/inventario'
import { useBarcodeScan } from '../hooks/useBarcodeScan'
import { beepScan, beepOk, beepError } from '../utils/beep'
import ContadorCantidad from '../components/ContadorCantidad'

type Paso = 'scan' | 'elegirOrigen' | 'elegirDestino' | 'cantidad' | 'exito' | 'error'

export default function Salida() {
  const [paso,        setPaso]        = useState<Paso>('scan')
  const [producto,    setProducto]    = useState<Producto | null>(null)
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([])
  const [origen,      setOrigen]      = useState<StockUbicacion | null>(null)
  const [destino,     setDestino]     = useState<Ubicacion | null>(null)
  const [cantidad,    setCantidad]    = useState(1)
  const [error,       setError]       = useState('')
  const [cargando,    setCargando]    = useState(false)
  const [inputManual, setInputManual] = useState('')
  const registrandoRef = useRef(false)

  const buscarProducto = useCallback(async (codigo: string) => {
    if (cargando) return
    setCargando(true)
    setError('')
    try {
      const [prod, ubics] = await Promise.all([
        api.getProducto(codigo.trim()),
        api.getUbicaciones(),
      ])
      setProducto(prod)
      setUbicaciones(ubics)
      setOrigen(null)
      setDestino(null)
      setCantidad(1)

      // Si no hay desglose pero hay stock, mostrar Bodega por defecto
      let conStock = (prod.stockPorUbicacion ?? []).filter(u => u.cantidad > 0)
      if (conStock.length === 0 && prod.stock > 0) {
        conStock = [{ ubicacion: 'Bodega', cantidad: prod.stock, color: '#1D9E75' }]
        // Parchear stockPorUbicacion en el producto para que el resto del flujo funcione
        prod.stockPorUbicacion = conStock
      }

      if (prod.stock === 0 || conStock.length === 0) {
        setError('Este producto no tiene stock registrado')
        beepError()
        return
      }
      // Si solo hay una ubicación, pre-seleccionarla
      if (conStock.length === 1) {
        setOrigen(conStock[0])
        setPaso('elegirDestino')
      } else {
        setPaso('elegirOrigen')
      }
      beepScan()
    } catch (e) {
      setError((e as Error).message)
      beepError()
    } finally {
      setCargando(false)
    }
  }, [cargando])

  useBarcodeScan(buscarProducto)

  async function confirmar() {
    if (!producto || !origen || !destino || registrandoRef.current) return
    if (cantidad > origen.cantidad) {
      setError(`Solo hay ${origen.cantidad} pzas en ${origen.ubicacion}`)
      setPaso('error')
      beepError()
      return
    }
    registrandoRef.current = true
    setCargando(true)
    try {
      await api.trasladar(producto.codigo, cantidad, origen.ubicacion, destino.nombre)
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
    setPaso('scan')
    setProducto(null)
    setOrigen(null)
    setDestino(null)
    setCantidad(1)
    setInputManual('')
    setError('')
  }

  const conStock = (producto?.stockPorUbicacion ?? []).filter(u => u.cantidad > 0)
  const destinosDisponibles = ubicaciones.filter(u => u.nombre !== origen?.ubicacion)

  // ── Escanear ──────────────────────────────────────────────────────────────────
  if (paso === 'scan') return (
    <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{
        background: 'white', borderRadius: 18,
        border: '2px dashed rgba(216,90,48,0.35)',
        padding: '32px 20px', textAlign: 'center',
      }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>📤</div>
        <p style={{ fontSize: 15, color: '#5F5E5A', marginBottom: 4 }}>Escanea el producto a mover</p>
        <p style={{ fontSize: 13, color: '#aaa' }}>Sale de una ubicación hacia otra</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={{ fontSize: 13, color: '#5F5E5A' }}>O escribe el código manualmente</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            autoFocus
            value={inputManual}
            onChange={e => setInputManual(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && inputManual.trim() && buscarProducto(inputManual.trim())}
            placeholder="Código de barras..."
            style={{
              flex: 1, padding: '14px 14px', fontSize: 16,
              border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 12,
              background: 'white', color: '#1a1a18',
            }}
          />
          <button
            onClick={() => inputManual.trim() && buscarProducto(inputManual)}
            style={{ padding: '14px 18px', background: '#D85A30', color: 'white', borderRadius: 12, fontSize: 20, minWidth: 52 }}
          >→</button>
        </div>
      </div>

      {cargando && <p style={{ textAlign: 'center', color: '#D85A30', fontSize: 14 }}>Buscando producto...</p>}
      {error    && (
        <div style={{ background: '#FAECE7', borderRadius: 12, padding: '12px 14px' }}>
          <p style={{ color: '#712B13', fontSize: 13 }}>{error}</p>
        </div>
      )}
    </div>
  )

  // ── Elegir origen ─────────────────────────────────────────────────────────────
  if (paso === 'elegirOrigen' && producto) return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <p style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>{producto.nombre}</p>
        <p style={{ fontSize: 12, color: '#aaa', fontFamily: 'monospace', marginBottom: 8 }}>{producto.codigo}</p>
        <p style={{ fontSize: 14, color: '#1D9E75', fontWeight: 700 }}>Total: {producto.stock} pzas</p>
      </div>

      <p style={{ fontSize: 14, fontWeight: 600, color: '#1a1a18' }}>¿Desde dónde sale?</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {conStock.map(u => (
          <button key={u.ubicacion}
            onClick={() => { setOrigen(u); setCantidad(1); setPaso('elegirDestino') }}
            style={{
              background: 'white', borderRadius: 14, padding: '16px 18px',
              border: `2px solid ${u.color}30`,
              display: 'flex', alignItems: 'center', gap: 12,
              cursor: 'pointer', width: '100%', textAlign: 'left',
            }}>
            <div style={{ width: 14, height: 14, borderRadius: '50%', background: u.color, flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: '#1a1a18' }}>{u.ubicacion}</span>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: 24, fontWeight: 700, color: u.color, lineHeight: 1 }}>{u.cantidad}</p>
              <p style={{ fontSize: 10, color: '#aaa' }}>pzas</p>
            </div>
          </button>
        ))}
      </div>

      <button className="btn-secondary" onClick={reset}>Cancelar</button>
    </div>
  )

  // ── Elegir destino ────────────────────────────────────────────────────────────
  if (paso === 'elegirDestino' && producto && origen) return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Chip origen */}
      <div style={{
        background: `${origen.color}10`, borderRadius: 12, padding: '12px 16px',
        border: `1.5px solid ${origen.color}30`,
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: origen.color }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: origen.color }}>Sale de: {origen.ubicacion}</span>
        <span style={{ fontSize: 12, color: '#aaa', marginLeft: 'auto' }}>{origen.cantidad} pzas</span>
      </div>

      <p style={{ fontSize: 14, fontWeight: 600, color: '#1a1a18' }}>¿A dónde va?</p>

      {destinosDisponibles.length === 0 ? (
        <p style={{ textAlign: 'center', color: '#aaa', fontSize: 13 }}>Configura más ubicaciones con el botón ⚙</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {destinosDisponibles.map(u => {
            const yaHay = (producto.stockPorUbicacion ?? []).find(s => s.ubicacion === u.nombre)?.cantidad ?? 0
            return (
              <button key={u.id}
                onClick={() => { setDestino(u); setPaso('cantidad') }}
                style={{
                  padding: '18px 12px', borderRadius: 14, cursor: 'pointer',
                  border: `1.5px solid ${u.color}30`, background: 'white',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                }}>
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: u.color }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a18', textAlign: 'center', lineHeight: 1.3 }}>{u.nombre}</span>
                {yaHay > 0 && (
                  <span style={{ fontSize: 10, color: u.color, fontWeight: 600 }}>{yaHay} aquí</span>
                )}
              </button>
            )
          })}
        </div>
      )}

      <button className="btn-secondary"
        onClick={() => conStock.length > 1 ? setPaso('elegirOrigen') : reset()}>
        ← {conStock.length > 1 ? 'Cambiar origen' : 'Cancelar'}
      </button>
    </div>
  )

  // ── Cantidad ──────────────────────────────────────────────────────────────────
  if (paso === 'cantidad' && producto && origen && destino) return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Resumen del movimiento */}
      <div style={{ background: 'white', borderRadius: 14, padding: '14px 16px', border: '1.5px solid rgba(0,0,0,0.08)' }}>
        <p style={{ fontSize: 14, fontWeight: 600, color: '#1a1a18', marginBottom: 10 }}>{producto.nombre}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, padding: '4px 10px', borderRadius: 20, background: `${origen.color}15`, color: origen.color, fontWeight: 600 }}>
            📤 {origen.ubicacion}
          </span>
          <span style={{ fontSize: 16, color: '#D85A30', fontWeight: 700 }}>→</span>
          <span style={{ fontSize: 12, padding: '4px 10px', borderRadius: 20, background: `${destino.color}15`, color: destino.color, fontWeight: 600 }}>
            📍 {destino.nombre}
          </span>
        </div>
        <p style={{ fontSize: 11, color: '#aaa', marginTop: 8 }}>Disponible en {origen.ubicacion}: {origen.cantidad} pzas</p>
      </div>

      <ContadorCantidad
        unidad="piezas"
        color="#D85A30"
        max={origen.cantidad}
        onChange={t => setCantidad(t)}
      />

      <button className="btn-primary rojo" onClick={confirmar} disabled={cargando}
        style={{ background: '#D85A30' }}>
        {cargando ? 'Registrando...' : `📤 Registrar salida · ${cantidad} pzas`}
      </button>
      <button className="btn-secondary" onClick={() => setPaso('elegirDestino')}>← Cambiar destino</button>
    </div>
  )

  // ── Éxito ─────────────────────────────────────────────────────────────────────
  if (paso === 'exito' && producto && origen && destino) return (
    <div style={{ padding: '40px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12 }}>
      <div style={{ width: 80, height: 80, borderRadius: '50%', background: '#FAECE7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, marginBottom: 8 }}>✓</div>
      <p style={{ fontSize: 20, fontWeight: 700, color: '#712B13' }}>Salida registrada</p>
      <p style={{ fontSize: 15, color: '#5F5E5A' }}>{cantidad} pzas · {producto.nombre}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        <span style={{ fontSize: 12, padding: '4px 12px', borderRadius: 20, background: `${origen.color}15`, color: origen.color, fontWeight: 600 }}>
          {origen.ubicacion}
        </span>
        <span style={{ fontSize: 18, color: '#D85A30', fontWeight: 700 }}>→</span>
        <span style={{ fontSize: 12, padding: '4px 12px', borderRadius: 20, background: `${destino.color}15`, color: destino.color, fontWeight: 600 }}>
          {destino.nombre}
        </span>
      </div>
      <div style={{ marginTop: 20, width: '100%' }}>
        <button className="btn-primary rojo" onClick={reset} style={{ background: '#D85A30' }}>
          Escanear otro producto
        </button>
      </div>
    </div>
  )

  // ── Error ─────────────────────────────────────────────────────────────────────
  if (paso === 'error') return (
    <div style={{ padding: '40px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12 }}>
      <div style={{ width: 80, height: 80, borderRadius: '50%', background: '#FAECE7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, marginBottom: 8 }}>✕</div>
      <p style={{ fontSize: 18, fontWeight: 700, color: '#712B13' }}>Error</p>
      <p style={{ fontSize: 14, color: '#5F5E5A' }}>{error}</p>
      <div style={{ marginTop: 20, width: '100%' }}>
        <button className="btn-primary rojo" onClick={reset} style={{ background: '#D85A30' }}>
          Intentar de nuevo
        </button>
      </div>
    </div>
  )

  return null
}
