import { useState, useEffect, useMemo } from 'react'
// eslint-disable-next-line @typescript-eslint/no-unused-vars

interface RowInv { codigo: string; nombre: string; ubicacion: string; cantidad: number; color: string }
type PivotRow = { codigo: string; nombre: string; locs: { ubicacion: string; cantidad: number; color: string }[]; total: number }

export default function Ubicar() {
  const [rows,    setRows]    = useState<RowInv[]>([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  async function cargar() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/almacen/inventario`)
      if (!res.ok) throw new Error('Error del servidor')
      const data = await res.json()
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { cargar() }, [])

  const pivot = useMemo<PivotRow[]>(() => {
    const map = new Map<string, PivotRow>()
    for (const r of rows) {
      if (!map.has(r.codigo)) map.set(r.codigo, { codigo: r.codigo, nombre: r.nombre, locs: [], total: 0 })
      const p = map.get(r.codigo)!
      p.locs.push({ ubicacion: r.ubicacion, cantidad: r.cantidad, color: r.color })
      p.total += r.cantidad
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total)
  }, [rows])

  const filtered = pivot
  const totalPiezas = filtered.reduce((s, p) => s + p.total, 0)

  return (
    <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={cargar}
          disabled={loading}
          style={{
            padding: '10px 16px', background: '#1D9E75', color: 'white',
            borderRadius: 12, fontSize: 14, fontWeight: 600,
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? '⟳ Actualizando...' : '↻ Actualizar'}
        </button>
      </div>

      {/* Resumen */}
      {!loading && !error && rows.length > 0 && (
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, background: '#E1F5EE', borderRadius: 10, padding: '10px 14px' }}>
            <p style={{ fontSize: 11, color: '#085041', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Productos</p>
            <p style={{ fontSize: 22, fontWeight: 700, color: '#085041' }}>{filtered.length}</p>
          </div>
          <div style={{ flex: 1, background: '#E1F5EE', borderRadius: 10, padding: '10px 14px' }}>
            <p style={{ fontSize: 11, color: '#085041', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Piezas totales</p>
            <p style={{ fontSize: 22, fontWeight: 700, color: '#085041' }}>{totalPiezas.toLocaleString('es-MX')}</p>
          </div>
        </div>
      )}

      {/* Estados */}
      {loading && <p style={{ textAlign: 'center', color: '#1D9E75', fontSize: 14, padding: '20px 0' }}>Cargando inventario...</p>}
      {error   && <p style={{ textAlign: 'center', color: '#712B13', fontSize: 13 }}>{error}</p>}
      {!loading && !error && rows.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
          <p style={{ fontSize: 40, marginBottom: 10 }}>📦</p>
          <p style={{ color: '#aaa', fontSize: 14 }}>Sin stock registrado en el sistema</p>
          <p style={{ color: '#bbb', fontSize: 12, marginTop: 6 }}>Usa Recepción para registrar productos</p>
        </div>
      )}
      {/* Lista */}
      {!loading && !error && filtered.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map(p => (
            <div key={p.codigo} style={{
              background: 'white', borderRadius: 12,
              border: '1px solid rgba(0,0,0,0.06)',
              padding: '12px 14px',
              display: 'flex', alignItems: 'flex-start', gap: 10,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#1a1a18', lineHeight: 1.3 }}>{p.nombre}</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                  {p.locs.map(u => (
                    <span key={u.ubicacion} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '3px 9px', borderRadius: 20,
                      background: `${u.color}15`, border: `1px solid ${u.color}40`,
                      fontSize: 11, fontWeight: 600, color: u.color,
                    }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: u.color }} />
                      {u.cantidad} {u.ubicacion}
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0, paddingTop: 2 }}>
                <p style={{ fontSize: 22, fontWeight: 700, color: '#1D9E75', lineHeight: 1 }}>{p.total}</p>
                <p style={{ fontSize: 9, color: '#aaa' }}>total</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
