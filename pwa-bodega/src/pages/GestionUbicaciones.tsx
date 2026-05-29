import { useState, useEffect } from 'react'
import { api, type Ubicacion } from '../api/inventario'

const COLORES = [
  '#1D9E75', '#3B82F6', '#8B5CF6', '#E07B39', '#EF4444',
  '#06B6D4', '#F59E0B', '#EC4899', '#6B7280', '#1F2937',
]

export default function GestionUbicaciones({ onClose }: { onClose: () => void }) {
  const [ubicaciones,  setUbicaciones]  = useState<Ubicacion[]>([])
  const [nuevoNombre,  setNuevoNombre]  = useState('')
  const [nuevoColor,   setNuevoColor]   = useState('#3B82F6')
  const [cargando,     setCargando]     = useState(false)
  const [error,        setError]        = useState('')

  useEffect(() => {
    api.getUbicaciones().then(setUbicaciones).catch(e => setError((e as Error).message))
  }, [])

  async function agregar() {
    if (!nuevoNombre.trim() || cargando) return
    setCargando(true)
    setError('')
    try {
      const data = await api.crearUbicacion(nuevoNombre.trim(), nuevoColor)
      setUbicaciones(data)
      setNuevoNombre('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setCargando(false)
    }
  }

  async function eliminar(id: number) {
    setCargando(true)
    try {
      const data = await api.eliminarUbicacion(id)
      setUbicaciones(data)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setCargando(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#f5f5f3', zIndex: 200,
      display: 'flex', flexDirection: 'column', maxWidth: 480, margin: '0 auto',
    }}>
      {/* Header */}
      <div style={{
        background: '#1F2937', color: 'white',
        padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0,
      }}>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: 'white', fontSize: 22, cursor: 'pointer', padding: 0, lineHeight: 1 }}
        >←</button>
        <div>
          <p style={{ fontSize: 16, fontWeight: 600 }}>Ubicaciones</p>
          <p style={{ fontSize: 12, opacity: 0.65 }}>Agregar o eliminar categorías</p>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error && (
          <p style={{ color: '#712B13', fontSize: 13, background: '#FAECE7', padding: '10px 14px', borderRadius: 10 }}>
            {error}
          </p>
        )}

        {/* Lista actual */}
        <div>
          <p style={{ fontSize: 12, color: '#aaa', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
            Ubicaciones actuales
          </p>
          {ubicaciones.length === 0 ? (
            <p style={{ fontSize: 14, color: '#aaa', textAlign: 'center', padding: '20px 0' }}>Sin ubicaciones aún</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ubicaciones.map(u => (
                <div key={u.id} style={{
                  background: 'white', borderRadius: 12, padding: '14px 16px',
                  display: 'flex', alignItems: 'center', gap: 12,
                  border: '1px solid rgba(0,0,0,0.06)',
                }}>
                  <div style={{ width: 18, height: 18, borderRadius: 6, background: u.color, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 15, fontWeight: 500, color: '#1a1a18' }}>{u.nombre}</span>
                  <button
                    onClick={() => eliminar(u.id)}
                    disabled={cargando}
                    style={{
                      background: '#FAECE7', border: 'none', borderRadius: 8,
                      padding: '6px 12px', cursor: 'pointer', fontSize: 13,
                      color: '#712B13', fontWeight: 600,
                    }}
                  >
                    Eliminar
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Agregar nueva */}
        <div style={{
          background: 'white', borderRadius: 16, padding: '18px 16px',
          border: '1px solid rgba(0,0,0,0.06)',
        }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#1F2937', marginBottom: 14 }}>Nueva ubicación</p>

          <input
            data-manual="true"
            value={nuevoNombre}
            onChange={e => setNuevoNombre(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && agregar()}
            placeholder="Ej: Almacén USA, Freezer..."
            style={{
              width: '100%', padding: '12px 14px', fontSize: 15, boxSizing: 'border-box',
              border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 10,
              background: '#fafafa', color: '#1a1a18', marginBottom: 14,
            }}
          />

          <p style={{ fontSize: 12, color: '#5F5E5A', marginBottom: 10 }}>Color</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
            {COLORES.map(c => (
              <button
                key={c}
                onClick={() => setNuevoColor(c)}
                style={{
                  width: 36, height: 36, borderRadius: 10, background: c, cursor: 'pointer',
                  border: nuevoColor === c ? '3px solid #1F2937' : '2.5px solid transparent',
                  boxShadow: nuevoColor === c ? '0 0 0 2px white inset' : 'none',
                }}
              />
            ))}
          </div>

          {/* Preview */}
          {nuevoNombre.trim() && (
            <div style={{ marginBottom: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#aaa' }}>Vista previa:</span>
              <span style={{
                fontSize: 13, padding: '4px 12px', borderRadius: 20, fontWeight: 600,
                background: `${nuevoColor}20`, color: nuevoColor,
              }}>
                📍 {nuevoNombre}
              </span>
            </div>
          )}

          <button
            onClick={agregar}
            disabled={cargando || !nuevoNombre.trim()}
            style={{
              width: '100%', padding: '14px', border: 'none', borderRadius: 12,
              background: nuevoColor, color: 'white', fontSize: 15, fontWeight: 600,
              cursor: nuevoNombre.trim() ? 'pointer' : 'default',
              opacity: nuevoNombre.trim() ? 1 : 0.4,
            }}
          >
            {cargando ? 'Guardando...' : '+ Agregar ubicación'}
          </button>
        </div>
      </div>
    </div>
  )
}
