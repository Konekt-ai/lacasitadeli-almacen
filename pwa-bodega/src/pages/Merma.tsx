import { useState, useCallback, useRef } from 'react'
import { api, type Producto, type MotivoMerma, type StockUbicacion } from '../api/inventario'
import { useBarcodeScan } from '../hooks/useBarcodeScan'
import { beepScan, beepOk, beepError } from '../utils/beep'

type Paso = 'scan' | 'confirmar' | 'exito' | 'error'

const MOTIVOS: { id: MotivoMerma; label: string; emoji: string; color: string }[] = [
  { id: 'vencimiento', label: 'Vencimiento', emoji: '📅', color: '#C05621' },
  { id: 'dano',        label: 'Daño',        emoji: '💥', color: '#9B3B2A' },
  { id: 'cocina',      label: 'Cocina',      emoji: '🍳', color: '#D6870A' },
  { id: 'robo',        label: 'Robo',        emoji: '🚨', color: '#6B2737' },
  { id: 'otro',        label: 'Otro',        emoji: '❓', color: '#5F5E5A' },
]

export default function Merma() {
  const [paso,       setPaso]       = useState<Paso>('scan')
  const [producto,   setProducto]   = useState<Producto | null>(null)
  const [cantidad,   setCantidad]   = useState(1)
  const [motivo,     setMotivo]     = useState<MotivoMerma>('vencimiento')
  const [ubicacion,  setUbicacion]  = useState<string>('Sin ubicar')
  const [notas,      setNotas]      = useState('')
  const [nuevoStock, setNuevoStock] = useState(0)
  const [error,      setError]      = useState('')
  const [cargando,   setCargando]   = useState(false)
  const [inputManual,setInputManual]= useState('')
  const registrandoRef = useRef(false)

  const buscarProducto = useCallback(async (codigo: string) => {
    if (cargando) return
    setCargando(true)
    try {
      const prod = await api.getProducto(codigo.trim())
      setProducto(prod)
      setCantidad(1)
      setMotivo('vencimiento')
      setNotas('')
      // Pre-seleccionar la primera ubicación con stock
      const primeraConStock = (prod.stockPorUbicacion ?? []).find(u => u.cantidad > 0)
      setUbicacion(primeraConStock?.ubicacion ?? 'Bodega')
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
    registrandoRef.current = true
    setCargando(true)
    try {
      const res = await api.registrarMerma(producto.codigo, cantidad, motivo, ubicacion, producto.nombre, notas || undefined)
      setNuevoStock(res.stockActual)
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
    setCantidad(1)
    setMotivo('vencimiento')
    setUbicacion('Sin ubicar')
    setNotas('')
    setInputManual('')
    setError('')
  }

  function seleccionarUbicacion(u: StockUbicacion) {
    setUbicacion(u.ubicacion)
    setCantidad(prev => Math.min(prev, u.cantidad))
  }

  const motivoActual = MOTIVOS.find(m => m.id === motivo)!
  // Si no hay desglose por ubicación pero hay stock, mostrar Bodega como opción
  let conStock = (producto?.stockPorUbicacion ?? []).filter(u => u.cantidad > 0)
  if (conStock.length === 0 && (producto?.stock ?? 0) > 0) {
    conStock = [{ ubicacion: 'Bodega', cantidad: producto!.stock, color: '#1D9E75' }]
  }
  const ubicActual = conStock.find(u => u.ubicacion === ubicacion)
  const stockDisponible = ubicActual?.cantidad ?? 0

  // ── Escanear ──────────────────────────────────────────────────────────────────
  if (paso === 'scan') return (
    <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{
        background: 'white', borderRadius: 18,
        border: '2px dashed rgba(192,86,33,0.35)',
        padding: '32px 20px', textAlign: 'center',
      }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🗑️</div>
        <p style={{ fontSize: 15, color: '#5F5E5A', marginBottom: 4 }}>Escanea el producto a dar de baja</p>
        <p style={{ fontSize: 13, color: '#aaa' }}>Vencimiento · Daño · Cocina · Robo</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={{ fontSize: 13, color: '#5F5E5A' }}>O escribe el código manualmente</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            data-manual="true"
            value={inputManual}
            onChange={e => setInputManual(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && inputManual.trim() && buscarProducto(inputManual)}
            placeholder="Código de barras..."
            style={{
              flex: 1, padding: '14px', fontSize: 16,
              border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 12,
              background: 'white', color: '#1a1a18',
            }}
          />
          <button
            onClick={() => inputManual.trim() && buscarProducto(inputManual)}
            style={{ padding: '14px 18px', background: '#C05621', color: 'white', borderRadius: 12, fontSize: 20, minWidth: 52 }}
          >→</button>
        </div>
      </div>

      {cargando && <p style={{ textAlign: 'center', color: '#C05621', fontSize: 14 }}>Buscando producto...</p>}
    </div>
  )

  // ── Confirmar ─────────────────────────────────────────────────────────────────
  if (paso === 'confirmar' && producto) return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Producto */}
      <div className="card">
        <p style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>{producto.nombre}</p>
        <p style={{ fontSize: 12, color: '#aaa', fontFamily: 'monospace', marginBottom: 10 }}>{producto.codigo}</p>
        <p style={{ fontSize: 14, fontWeight: 700, color: producto.stock === 0 ? '#D85A30' : '#1D9E75' }}>
          Total en bodega: {producto.stock} pzas
        </p>
      </div>

      {/* Ubicación de origen */}
      {conStock.length === 0 ? (
        <div style={{ background: '#FAECE7', borderRadius: 12, padding: 14, textAlign: 'center' }}>
          <p style={{ color: '#712B13', fontSize: 14, fontWeight: 600 }}>Sin stock en ninguna ubicación</p>
          <button className="btn-secondary" onClick={reset} style={{ marginTop: 10 }}>Cancelar</button>
        </div>
      ) : (
        <>
          {/* Selección de origen */}
          <div>
            <p style={{ fontSize: 14, color: '#5F5E5A', marginBottom: 8 }}>Desde qué ubicación</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {conStock.map(u => (
                <button
                  key={u.ubicacion}
                  onClick={() => seleccionarUbicacion(u)}
                  style={{
                    padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
                    border: ubicacion === u.ubicacion ? `2px solid ${u.color}` : '1.5px solid rgba(0,0,0,0.10)',
                    background: ubicacion === u.ubicacion ? `${u.color}18` : 'white',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                  }}>
                  <span style={{ fontSize: 12, fontWeight: ubicacion === u.ubicacion ? 700 : 400, color: ubicacion === u.ubicacion ? u.color : '#5F5E5A' }}>
                    {u.ubicacion}
                  </span>
                  <span style={{ fontSize: 10, color: '#aaa' }}>{u.cantidad} pzas</span>
                </button>
              ))}
            </div>
          </div>

          {/* Motivo */}
          <div>
            <p style={{ fontSize: 14, color: '#5F5E5A', marginBottom: 8 }}>Motivo de baja</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {MOTIVOS.map(m => (
                <button key={m.id} onClick={() => setMotivo(m.id)}
                  style={{
                    padding: '12px 8px', borderRadius: 12, cursor: 'pointer',
                    border: motivo === m.id ? `2px solid ${m.color}` : '1.5px solid rgba(0,0,0,0.10)',
                    background: motivo === m.id ? `${m.color}18` : 'white',
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                  <span style={{ fontSize: 20 }}>{m.emoji}</span>
                  <span style={{ fontSize: 13, fontWeight: motivo === m.id ? 600 : 400, color: motivo === m.id ? m.color : '#5F5E5A' }}>
                    {m.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Cantidad */}
          <div>
            <p style={{ fontSize: 14, color: '#5F5E5A', marginBottom: 10 }}>Cantidad a dar de baja</p>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'center' }}>
              <button onClick={() => setCantidad(c => Math.max(1, c - 1))}
                style={{ width: 64, height: 64, fontSize: 28, fontWeight: 300, border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 14, background: 'white', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                −
              </button>
              <input
                data-manual="true" type="number" value={cantidad} min={1} max={stockDisponible}
                onChange={e => setCantidad(Math.min(stockDisponible || 999, Math.max(1, parseInt(e.target.value) || 1)))}
                style={{
                  width: 100, textAlign: 'center', fontSize: 32, fontWeight: 700,
                  border: `1.5px solid ${motivoActual.color}66`, borderRadius: 12,
                  padding: '10px 0', background: 'white', color: '#1a1a18',
                }}
              />
              <button onClick={() => setCantidad(c => Math.min(stockDisponible || 999, c + 1))}
                style={{ width: 64, height: 64, fontSize: 28, fontWeight: 300, border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 14, background: 'white', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                +
              </button>
            </div>
            {ubicActual && (
              <p style={{ fontSize: 13, color: motivoActual.color, textAlign: 'center', marginTop: 8 }}>
                Quedan en {ubicacion}: {stockDisponible - cantidad} pzas
                {stockDisponible - cantidad < 0 && ' ⚠️'}
              </p>
            )}
          </div>

          {/* Nota */}
          <div>
            <p style={{ fontSize: 13, color: '#5F5E5A', marginBottom: 6 }}>Nota (opcional)</p>
            <input
              data-manual="true"
              value={notas}
              onChange={e => setNotas(e.target.value)}
              placeholder="Ej: lote vencido, proveedor X..."
              style={{
                width: '100%', padding: '12px 14px', fontSize: 14, boxSizing: 'border-box',
                border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 12,
                background: 'white', color: '#1a1a18',
              }}
            />
          </div>

          <button onClick={confirmar} disabled={cargando}
            style={{
              padding: '16px', border: 'none', borderRadius: 14, cursor: 'pointer',
              background: motivoActual.color, color: 'white', fontSize: 15, fontWeight: 600,
            }}>
            {cargando ? 'Registrando...' : `${motivoActual.emoji} Confirmar baja · ${cantidad} pzas`}
          </button>
          <button className="btn-secondary" onClick={reset}>Cancelar</button>
        </>
      )}
    </div>
  )

  // ── Éxito ─────────────────────────────────────────────────────────────────────
  if (paso === 'exito' && producto) return (
    <div style={{
      padding: '40px 24px', display: 'flex', flexDirection: 'column',
      alignItems: 'center', textAlign: 'center', gap: 12,
    }}>
      <div style={{
        width: 80, height: 80, borderRadius: '50%',
        background: '#FEF3C7', display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 36, marginBottom: 8,
      }}>✓</div>
      <p style={{ fontSize: 20, fontWeight: 700, color: '#92400E' }}>Merma registrada</p>
      <p style={{ fontSize: 15, color: '#5F5E5A' }}>
        {motivoActual.emoji} {motivoActual.label} · −{cantidad} pzas
      </p>
      <p style={{ fontSize: 14, color: '#5F5E5A' }}>{producto.nombre}</p>
      <p style={{ fontSize: 13, color: '#aaa' }}>📍 {ubicacion}</p>
      <p style={{ fontSize: 14, color: '#C05621', fontWeight: 600 }}>
        Stock total nuevo: {nuevoStock} pzas
      </p>
      <div style={{ marginTop: 20, width: '100%' }}>
        <button onClick={reset}
          style={{ width: '100%', padding: '16px', background: '#C05621', color: 'white', border: 'none', borderRadius: 14, fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
          Registrar otra merma
        </button>
      </div>
    </div>
  )

  // ── Error ─────────────────────────────────────────────────────────────────────
  if (paso === 'error') return (
    <div style={{
      padding: '40px 24px', display: 'flex', flexDirection: 'column',
      alignItems: 'center', textAlign: 'center', gap: 12,
    }}>
      <div style={{
        width: 80, height: 80, borderRadius: '50%',
        background: '#FAECE7', display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 36, marginBottom: 8,
      }}>✕</div>
      <p style={{ fontSize: 18, fontWeight: 700, color: '#712B13' }}>Error</p>
      <p style={{ fontSize: 14, color: '#5F5E5A' }}>{error}</p>
      <div style={{ marginTop: 20, width: '100%' }}>
        <button className="btn-primary" onClick={reset}>Intentar de nuevo</button>
      </div>
    </div>
  )

  return null
}
