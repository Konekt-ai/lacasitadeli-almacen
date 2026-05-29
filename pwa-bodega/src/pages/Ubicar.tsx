import { useState, useCallback, useEffect } from 'react'
import { api, type Producto, type Ubicacion } from '../api/inventario'
import { useBarcodeScan } from '../hooks/useBarcodeScan'

type Paso = 'scan' | 'ubicar' | 'exito'

export default function Ubicar() {
  const [paso,            setPaso]            = useState<Paso>('scan')
  const [producto,        setProducto]        = useState<Producto | null>(null)
  const [ubicaciones,     setUbicaciones]     = useState<Ubicacion[]>([])
  const [seleccionada,    setSeleccionada]    = useState<string | null>(null)
  const [cargando,        setCargando]        = useState(false)
  const [error,           setError]           = useState('')
  const [inputManual,     setInputManual]     = useState('')

  useEffect(() => {
    api.getUbicaciones().then(setUbicaciones).catch(() => {})
  }, [])

  const buscarProducto = useCallback(async (codigo: string) => {
    if (cargando) return
    setCargando(true)
    setError('')
    try {
      const prod = await api.getProducto(codigo.trim())
      setProducto(prod)
      setSeleccionada(prod.ubicacion ?? null)
      setPaso('ubicar')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setCargando(false)
    }
  }, [cargando])

  useBarcodeScan(buscarProducto)

  async function asignar(ubicacion: string) {
    if (!producto || cargando) return
    setCargando(true)
    try {
      await api.setUbicacion(producto.codigo, ubicacion)
      setSeleccionada(ubicacion)
      setPaso('exito')
      setTimeout(reset, 1800)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setCargando(false)
    }
  }

  function reset() {
    setPaso('scan')
    setProducto(null)
    setInputManual('')
    setError('')
    setSeleccionada(null)
  }

  const colorSeleccionada = ubicaciones.find(u => u.nombre === seleccionada)?.color ?? '#1D9E75'

  // ── Escanear ─────────────────────────────────────────────────────────────────
  if (paso === 'scan') return (
    <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{
        background: 'white', borderRadius: 18,
        border: '2px dashed rgba(59,130,246,0.35)',
        padding: '32px 20px', textAlign: 'center',
      }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>📍</div>
        <p style={{ fontSize: 15, color: '#5F5E5A', marginBottom: 4 }}>Escanea el producto a ubicar</p>
        <p style={{ fontSize: 13, color: '#aaa' }}>Asigna en qué lugar está guardado</p>
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
            style={{ padding: '14px 18px', background: '#3B82F6', color: 'white', borderRadius: 12, fontSize: 20, minWidth: 52 }}
          >→</button>
        </div>
      </div>

      {cargando && <p style={{ textAlign: 'center', color: '#3B82F6', fontSize: 14 }}>Buscando...</p>}
      {error    && <p style={{ textAlign: 'center', color: '#712B13', fontSize: 14 }}>{error}</p>}
    </div>
  )

  // ── Seleccionar ubicación ────────────────────────────────────────────────────
  if (paso === 'ubicar' && producto) return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card">
        <p style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>{producto.nombre}</p>
        <p style={{ fontSize: 12, color: '#aaa', fontFamily: 'monospace', marginBottom: 10 }}>{producto.codigo}</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className={producto.stock === 0 ? 'badge badge-zero' : producto.stock < 5 ? 'badge badge-low' : 'badge badge-ok'}>
            {producto.stock} pzas
          </span>
          {seleccionada && (
            <span style={{
              fontSize: 12, padding: '4px 10px', borderRadius: 20, fontWeight: 600,
              background: `${colorSeleccionada}20`, color: colorSeleccionada,
            }}>
              📍 {seleccionada}
            </span>
          )}
        </div>
      </div>

      <p style={{ fontSize: 14, fontWeight: 600, color: '#1a1a18' }}>¿Dónde está este producto?</p>

      {ubicaciones.length === 0 ? (
        <p style={{ textAlign: 'center', color: '#aaa', fontSize: 13 }}>
          Sin ubicaciones configuradas. Usa el botón ⚙ para agregar.
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {ubicaciones.map(u => (
            <button
              key={u.id}
              onClick={() => asignar(u.nombre)}
              disabled={cargando}
              style={{
                padding: '20px 12px', borderRadius: 14, cursor: 'pointer',
                border: seleccionada === u.nombre ? `2.5px solid ${u.color}` : '1.5px solid rgba(0,0,0,0.10)',
                background: seleccionada === u.nombre ? `${u.color}18` : 'white',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
              }}
            >
              <div style={{ width: 14, height: 14, borderRadius: '50%', background: u.color }} />
              <span style={{
                fontSize: 13, fontWeight: seleccionada === u.nombre ? 700 : 500,
                color: seleccionada === u.nombre ? u.color : '#1a1a18',
                textAlign: 'center', lineHeight: 1.3,
              }}>
                {u.nombre}
              </span>
            </button>
          ))}
        </div>
      )}

      {error && <p style={{ textAlign: 'center', color: '#712B13', fontSize: 13 }}>{error}</p>}
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
        background: `${colorSeleccionada}20`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, marginBottom: 8,
      }}>📍</div>
      <p style={{ fontSize: 20, fontWeight: 700, color: '#1a1a18' }}>Ubicación guardada</p>
      <p style={{ fontSize: 15, color: '#5F5E5A' }}>{producto.nombre}</p>
      <p style={{ fontSize: 16, fontWeight: 700, color: colorSeleccionada }}>{seleccionada}</p>
      <p style={{ fontSize: 13, color: '#aaa' }}>Listo para escanear otro...</p>
    </div>
  )

  return null
}
