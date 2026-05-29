import { useState, useEffect } from 'react'
import { useBarcodeScan } from '../hooks/useBarcodeScan'
import { api, type Producto, type Ubicacion } from '../api/inventario'

function stockColor(stock: number) {
  if (stock === 0) return '#D85A30'
  if (stock < 5)   return '#E08030'
  return '#1D9E75'
}

export default function Buscar() {
  const [query,          setQuery]          = useState('')
  const [resultados,     setResultados]     = useState<Producto[]>([])
  const [cargando,       setCargando]       = useState(false)
  const [error,          setError]          = useState('')
  const [buscado,        setBuscado]        = useState(false)
  const [ubicaciones,    setUbicaciones]    = useState<Ubicacion[]>([])
  const [ubicandoCodigo, setUbicandoCodigo] = useState<string | null>(null)
  const [guardando,      setGuardando]      = useState(false)

  useEffect(() => {
    api.getUbicaciones().then(setUbicaciones).catch(() => {})
  }, [])

  async function buscar(q = query) {
    const termino = q.trim()
    if (termino.length < 2) return
    setCargando(true)
    setError('')
    setBuscado(true)
    setUbicandoCodigo(null)
    try {
      const data = await api.buscarProductos(termino)
      setResultados(data)
    } catch (e) {
      setError((e as Error).message)
      setResultados([])
    } finally {
      setCargando(false)
    }
  }

  useBarcodeScan(buscar)

  async function cambiarUbicacion(codigo: string, ubicacion: string) {
    setGuardando(true)
    try {
      await api.setUbicacion(codigo, ubicacion)
      setResultados(prev =>
        prev.map(r => r.codigo === codigo ? { ...r, ubicacion } : r)
      )
      setUbicandoCodigo(null)
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setGuardando(false)
    }
  }

  function toggleUbicar(codigo: string) {
    setUbicandoCodigo(prev => prev === codigo ? null : codigo)
  }

  return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Barra de búsqueda */}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          data-manual="true"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && buscar()}
          placeholder="Nombre o código de barras..."
          style={{
            flex: 1, padding: '14px', fontSize: 16,
            border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 12,
            background: 'white', color: '#1a1a18',
          }}
        />
        <button
          onClick={() => buscar()}
          disabled={cargando || query.trim().length < 2}
          style={{
            padding: '14px 18px', background: '#1D9E75', color: 'white',
            borderRadius: 12, fontSize: 18, minWidth: 52,
            opacity: query.trim().length < 2 ? 0.4 : 1,
            cursor: query.trim().length < 2 ? 'default' : 'pointer',
          }}
        >🔍</button>
      </div>

      {!buscado && (
        <p style={{ fontSize: 13, color: '#aaa', textAlign: 'center' }}>
          Escribe un nombre o escanea un código
        </p>
      )}

      {cargando && <p style={{ textAlign: 'center', color: '#1D9E75', fontSize: 14 }}>Buscando...</p>}

      {!cargando && error && (
        <div style={{ background: '#FAECE7', borderRadius: 12, padding: '14px 16px' }}>
          <p style={{ color: '#712B13', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Error de conexión</p>
          <p style={{ color: '#712B13', fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all' }}>{error}</p>
        </div>
      )}

      {!cargando && !error && buscado && resultados.length === 0 && (
        <p style={{ textAlign: 'center', color: '#aaa', fontSize: 14, padding: '20px 0' }}>
          Sin resultados para "{query}"
        </p>
      )}

      {!cargando && !error && resultados.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <p style={{ fontSize: 12, color: '#aaa' }}>
            {resultados.length} resultado{resultados.length !== 1 ? 's' : ''}
          </p>

          {resultados.map(r => {
            const ubic = ubicaciones.find(u => u.nombre === r.ubicacion)
            const abierto = ubicandoCodigo === r.codigo

            return (
              <div key={r.codigo} style={{
                background: 'white', borderRadius: 12,
                border: abierto ? '1.5px solid rgba(59,130,246,0.4)' : '1px solid rgba(0,0,0,0.06)',
                overflow: 'hidden',
              }}>
                {/* Fila principal */}
                <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: '#1a1a18' }}>{r.nombre}</p>
                    <p style={{ fontSize: 11, color: '#aaa', fontFamily: 'monospace', marginTop: 2 }}>{r.codigo}</p>
                    {/* Chip de ubicación */}
                    <button
                      onClick={() => toggleUbicar(r.codigo)}
                      style={{
                        marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 4,
                        fontSize: 11, padding: '3px 9px', borderRadius: 20, cursor: 'pointer',
                        border: 'none',
                        background: ubic ? `${ubic.color}20` : 'rgba(0,0,0,0.05)',
                        color: ubic ? ubic.color : '#aaa',
                        fontWeight: 600,
                      }}
                    >
                      📍 {r.ubicacion ?? 'Sin ubicar'}
                    </button>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <p style={{ fontSize: 22, fontWeight: 700, color: stockColor(r.stock), lineHeight: 1 }}>
                      {r.stock}
                    </p>
                    <p style={{ fontSize: 10, color: '#aaa' }}>pzas</p>
                  </div>
                </div>

                {/* Panel de ubicaciones expandible */}
                {abierto && (
                  <div style={{ padding: '0 16px 14px', borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                    <p style={{ fontSize: 12, color: '#5F5E5A', margin: '10px 0 8px', fontWeight: 500 }}>
                      ¿Dónde está?
                    </p>
                    {ubicaciones.length === 0 ? (
                      <p style={{ fontSize: 12, color: '#aaa' }}>Sin ubicaciones. Configura desde ⚙</p>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                        {ubicaciones.map(u => (
                          <button
                            key={u.id}
                            onClick={() => cambiarUbicacion(r.codigo, u.nombre)}
                            disabled={guardando}
                            style={{
                              padding: '10px 6px', borderRadius: 10, cursor: 'pointer',
                              border: r.ubicacion === u.nombre ? `2px solid ${u.color}` : '1.5px solid rgba(0,0,0,0.08)',
                              background: r.ubicacion === u.nombre ? `${u.color}18` : '#fafafa',
                              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                            }}
                          >
                            <div style={{ width: 10, height: 10, borderRadius: '50%', background: u.color }} />
                            <span style={{
                              fontSize: 10, lineHeight: 1.2, textAlign: 'center',
                              color: r.ubicacion === u.nombre ? u.color : '#5F5E5A',
                              fontWeight: r.ubicacion === u.nombre ? 700 : 400,
                            }}>
                              {u.nombre}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
