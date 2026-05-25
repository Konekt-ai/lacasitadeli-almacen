import { useState, useEffect } from 'react'
import { api, type Movimiento } from '../api/inventario'

export default function Historial() {
  const [movimientos, setMovimientos] = useState<Movimiento[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  async function cargar() {
    setCargando(true)
    setError('')
    try {
      const data = await api.getMovimientos()
      setMovimientos(data)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => { cargar() }, [])

  function formatHora(fecha: string) {
    return new Date(fecha).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  }

  if (cargando) return (
    <div style={{ padding: 24, textAlign: 'center', color: '#5F5E5A', fontSize: 14 }}>
      Cargando movimientos...
    </div>
  )

  if (error) return (
    <div style={{ padding: 24, textAlign: 'center' }}>
      <p style={{ color: '#712B13', fontSize: 14, marginBottom: 16 }}>{error}</p>
      <button className="btn-secondary" onClick={cargar} style={{ width: 'auto', padding: '10px 24px' }}>
        Reintentar
      </button>
    </div>
  )

  if (movimientos.length === 0) return (
    <div style={{ padding: 40, textAlign: 'center', color: '#5F5E5A', fontSize: 14 }}>
      Sin movimientos hoy
    </div>
  )

  return (
    <div style={{ padding: '16px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <p style={{ fontSize: 13, color: '#5F5E5A' }}>Movimientos de hoy</p>
        <button
          onClick={cargar}
          style={{ fontSize: 13, color: '#1D9E75', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          Actualizar
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {movimientos.map((m) => (
          <div
            key={m.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 0',
              borderBottom: '1px solid rgba(0,0,0,0.06)'
            }}
          >
            <div style={{
              width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
              background: m.tipo === 'entrada' ? '#E1F5EE' : '#FAECE7',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16
            }}>
              {m.tipo === 'entrada' ? '↓' : '↑'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{
                fontSize: 14, fontWeight: 600, color: '#1a1a18',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
              }}>
                {m.nombre}
              </p>
              <p style={{ fontSize: 12, color: '#aaa' }}>
                {formatHora(m.fecha)} · {m.tipo}
              </p>
            </div>
            <p style={{
              fontSize: 16, fontWeight: 700, flexShrink: 0,
              color: m.tipo === 'entrada' ? '#085041' : '#712B13'
            }}>
              {m.tipo === 'entrada' ? '+' : '−'}{m.cantidad}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
