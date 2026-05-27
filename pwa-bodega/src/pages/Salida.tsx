import { useState, useCallback, useRef } from 'react'
import { api, type Producto } from '../api/inventario'
import { useBarcodeScan } from '../hooks/useBarcodeScan'

type Paso = 'scan' | 'confirmar' | 'exito' | 'error'

export default function Salida() {
  const [paso, setPaso] = useState<Paso>('scan')
  const [producto, setProducto] = useState<Producto | null>(null)
  const [cantidad, setCantidad] = useState(1)
  const [nuevoStock, setNuevoStock] = useState(0)
  const [error, setError] = useState('')
  const [cargando, setCargando] = useState(false)
  const [inputManual, setInputManual] = useState('')
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    if (!producto || cargando) return
    if (cantidad > producto.stock) {
      setError(`No hay suficiente stock. Disponible: ${producto.stock} pzas`)
      setPaso('error')
      return
    }
    setCargando(true)
    try {
      const res = await api.registrarSalida(producto.codigo, cantidad, producto.nombre)
      setNuevoStock(res.stockActual)
      setPaso('exito')
    } catch (e) {
      setError((e as Error).message)
      setPaso('error')
    } finally {
      setCargando(false)
    }
  }

  function reset() {
    setPaso('scan')
    setProducto(null)
    setCantidad(1)
    setInputManual('')
    setError('')
  }

  function stockClass(stock: number) {
    if (stock === 0) return 'badge badge-zero'
    if (stock < 5) return 'badge badge-low'
    return 'badge badge-ok'
  }

  if (paso === 'scan') return (
    <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{
        background: 'white',
        borderRadius: 18,
        border: '2px dashed rgba(216,90,48,0.35)',
        padding: '32px 20px',
        textAlign: 'center'
      }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🔍</div>
        <p style={{ fontSize: 15, color: '#5F5E5A', marginBottom: 4 }}>Escanea el producto a retirar</p>
        <p style={{ fontSize: 13, color: '#aaa' }}>Verifica existencia antes de retirar</p>
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
              flex: 1, padding: '14px 14px', fontSize: 16,
              border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 12,
              background: 'white', color: '#1a1a18'
            }}
          />
          <button
            onClick={() => inputManual.trim() && buscarProducto(inputManual)}
            style={{
              padding: '14px 18px', background: '#D85A30', color: 'white',
              borderRadius: 12, fontSize: 20, minWidth: 52
            }}
          >→</button>
        </div>
      </div>

      {cargando && (
        <p style={{ textAlign: 'center', color: '#D85A30', fontSize: 14 }}>Buscando producto...</p>
      )}
    </div>
  )

  if (paso === 'confirmar' && producto) return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <p style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>{producto.nombre}</p>
        <p style={{ fontSize: 12, color: '#aaa', fontFamily: 'monospace', marginBottom: 10 }}>{producto.codigo}</p>
        <span className={stockClass(producto.stock)}>
          {producto.stock === 0 ? 'Sin existencia' : `Existencia: ${producto.stock} pzas`}
        </span>
      </div>

      {producto.stock === 0 ? (
        <>
          <div style={{
            background: '#FAECE7', borderRadius: 12, padding: 16, textAlign: 'center'
          }}>
            <p style={{ color: '#712B13', fontWeight: 600, fontSize: 15 }}>Sin stock disponible</p>
            <p style={{ color: '#993C1D', fontSize: 13, marginTop: 4 }}>No se puede registrar salida</p>
          </div>
          <button className="btn-secondary" onClick={reset}>Escanear otro</button>
        </>
      ) : (
        <>
          <div>
            <p style={{ fontSize: 14, color: '#5F5E5A', marginBottom: 10 }}>¿Cuántas piezas salen?</p>
            <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
              <button
                onClick={() => setCantidad(c => Math.max(1, c - 1))}
                style={{
                  width: 72, minHeight: 72, fontSize: 32, fontWeight: 300,
                  border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 16, background: 'white',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                }}
              >−</button>
              <input
                data-manual="true"
                type="number"
                value={cantidad}
                min={1}
                max={producto.stock}
                onChange={e => setCantidad(Math.min(producto.stock, Math.max(1, parseInt(e.target.value) || 1)))}
                style={{
                  flex: 1, textAlign: 'center', fontSize: 36, fontWeight: 700,
                  border: `1.5px solid rgba(216,90,48,0.4)`, borderRadius: 16,
                  padding: '12px 0', background: 'white', color: '#1a1a18',
                  minWidth: 0
                }}
              />
              <button
                onClick={() => setCantidad(c => Math.min(producto.stock, c + 1))}
                style={{
                  width: 72, minHeight: 72, fontSize: 32, fontWeight: 300,
                  border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 16, background: 'white',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                }}
              >+</button>
            </div>
            <p style={{ fontSize: 13, color: '#D85A30', textAlign: 'center', marginTop: 8 }}>
              Stock restante: {producto.stock - cantidad} pzas
            </p>
          </div>

          <button className="btn-primary rojo" onClick={confirmar} disabled={cargando}>
            {cargando ? 'Guardando...' : '↑ Registrar salida'}
          </button>
          <button className="btn-secondary" onClick={reset}>Cancelar</button>
        </>
      )}
    </div>
  )

  if (paso === 'exito' && producto) return (
    <div style={{
      padding: '40px 24px', display: 'flex', flexDirection: 'column',
      alignItems: 'center', textAlign: 'center', gap: 12
    }}>
      <div style={{
        width: 80, height: 80, borderRadius: '50%',
        background: '#FAECE7', display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 36, marginBottom: 8
      }}>✓</div>
      <p style={{ fontSize: 20, fontWeight: 700, color: '#712B13' }}>Salida registrada</p>
      <p style={{ fontSize: 15, color: '#5F5E5A' }}>
        −{cantidad} pzas · {producto.nombre}
      </p>
      <p style={{ fontSize: 14, color: '#D85A30', fontWeight: 600 }}>
        Stock restante: {nuevoStock} pzas
      </p>
      <div style={{ marginTop: 20, width: '100%' }}>
        <button className="btn-primary rojo" onClick={reset}>Escanear otro producto</button>
      </div>
    </div>
  )

  if (paso === 'error') return (
    <div style={{
      padding: '40px 24px', display: 'flex', flexDirection: 'column',
      alignItems: 'center', textAlign: 'center', gap: 12
    }}>
      <div style={{
        width: 80, height: 80, borderRadius: '50%',
        background: '#FAECE7', display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 36, marginBottom: 8
      }}>✕</div>
      <p style={{ fontSize: 18, fontWeight: 700, color: '#712B13' }}>Error</p>
      <p style={{ fontSize: 14, color: '#5F5E5A' }}>{error}</p>
      <div style={{ marginTop: 20, width: '100%' }}>
        <button className="btn-primary rojo" onClick={reset}>Intentar de nuevo</button>
      </div>
    </div>
  )

  return null
}
