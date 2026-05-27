import { useState } from 'react'
import { useBarcodeScan } from '../hooks/useBarcodeScan'

interface Resultado {
  codigo: string
  nombre: string
  stock: number
}

function stockColor(stock: number) {
  if (stock === 0) return '#D85A30'
  if (stock < 5)  return '#E08030'
  return '#1D9E75'
}

export default function Buscar() {
  const [query,      setQuery]      = useState('')
  const [resultados, setResultados] = useState<Resultado[]>([])
  const [cargando,   setCargando]   = useState(false)
  const [error,      setError]      = useState('')
  const [buscado,    setBuscado]    = useState(false)

  async function buscar(q = query) {
    const termino = q.trim()
    if (termino.length < 2) return
    setCargando(true)
    setError('')
    setBuscado(true)
    try {
      const res = await fetch(`/buscar?q=${encodeURIComponent(termino)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.mensaje ?? `Error ${res.status}`)
      setResultados(data)
    } catch (e) {
      setError((e as Error).message)
      setResultados([])
    } finally {
      setCargando(false)
    }
  }

  useBarcodeScan(buscar)

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
            flex: 1, padding: '14px 14px', fontSize: 16,
            border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 12,
            background: 'white', color: '#1a1a18'
          }}
        />
        <button
          onClick={() => buscar()}
          disabled={cargando || query.trim().length < 2}
          style={{
            padding: '14px 18px', background: '#1D9E75', color: 'white',
            borderRadius: 12, fontSize: 18, minWidth: 52,
            opacity: query.trim().length < 2 ? 0.4 : 1,
            cursor: query.trim().length < 2 ? 'default' : 'pointer'
          }}
        >🔍</button>
      </div>

      {/* Escáner hint */}
      {!buscado && (
        <p style={{ fontSize: 13, color: '#aaa', textAlign: 'center' }}>
          Escribe un nombre o escanea un código
        </p>
      )}

      {/* Cargando */}
      {cargando && (
        <p style={{ textAlign: 'center', color: '#1D9E75', fontSize: 14 }}>Buscando...</p>
      )}

      {/* Error */}
      {!cargando && error && (
        <div style={{
          background: '#FAECE7', borderRadius: 12, padding: '14px 16px'
        }}>
          <p style={{ color: '#712B13', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
            Error de conexión
          </p>
          <p style={{ color: '#712B13', fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {error}
          </p>
        </div>
      )}

      {/* Sin resultados */}
      {!cargando && !error && buscado && resultados.length === 0 && (
        <p style={{ textAlign: 'center', color: '#aaa', fontSize: 14, padding: '20px 0' }}>
          Sin resultados para "{query}"
        </p>
      )}

      {/* Resultados */}
      {!cargando && !error && resultados.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <p style={{ fontSize: 12, color: '#aaa' }}>
            {resultados.length} resultado{resultados.length !== 1 ? 's' : ''}
          </p>
          {resultados.map(r => (
            <div key={r.codigo} style={{
              background: 'white', borderRadius: 12, padding: '14px 16px',
              display: 'flex', alignItems: 'center', gap: 12,
              border: '1px solid rgba(0,0,0,0.06)'
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: '#1a1a18' }}>
                  {r.nombre}
                </p>
                <p style={{ fontSize: 11, color: '#aaa', fontFamily: 'monospace', marginTop: 2 }}>
                  {r.codigo}
                </p>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <p style={{ fontSize: 22, fontWeight: 700, color: stockColor(r.stock), lineHeight: 1 }}>
                  {r.stock}
                </p>
                <p style={{ fontSize: 10, color: '#aaa' }}>pzas</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
