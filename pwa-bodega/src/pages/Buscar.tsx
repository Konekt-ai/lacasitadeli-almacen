import { useState, useRef } from 'react'
import { useBarcodeScan } from '../hooks/useBarcodeScan'
import { api, type Producto } from '../api/inventario'
import { beepScan, beepError } from '../utils/beep'
import ProductoDetalle from '../components/ProductoDetalle'

function stockColor(stock: number) {
  if (stock === 0) return '#bbb'
  if (stock < 5)   return '#E08030'
  return '#1D9E75'
}

export default function Buscar() {
  const [query,         setQuery]         = useState('')
  const [resultados,    setResultados]    = useState<Producto[]>([])
  const [cargando,      setCargando]      = useState(false)
  const [error,         setError]         = useState('')
  const [buscado,       setBuscado]       = useState(false)
  const [detalleCodigo, setDetalleCodigo] = useState<string | null>(null)
  const ultimoTermino = useRef('')   // último término buscado (texto o código escaneado)

  async function buscar(q = query) {
    const termino = q.trim()
    if (termino.length < 2) return
    ultimoTermino.current = termino
    setCargando(true)
    setError('')
    setBuscado(true)
    try {
      const data = await api.buscarProductos(termino)
      setResultados(data)
      if (data.length > 0) beepScan()
    } catch (e) {
      setError((e as Error).message)
      setResultados([])
      beepError()
    } finally {
      setCargando(false)
    }
  }

  // Re-ejecuta la última búsqueda (para refrescar la lista tras editar en el modal)
  function refrescar() {
    if (ultimoTermino.current.length >= 2) buscar(ultimoTermino.current)
  }

  // El escáner se pausa mientras el modal está abierto (evita búsquedas fantasma detrás)
  useBarcodeScan(buscar, !detalleCodigo)

  return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Barra de búsqueda */}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          data-manual="true"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && buscar()}
          placeholder="Nombre o código de barras..."
          autoFocus
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
        <div style={{
          background: '#f9f9f7', borderRadius: 14, padding: '28px 20px',
          border: '1.5px dashed rgba(0,0,0,0.10)', textAlign: 'center', marginTop: 4,
        }}>
          <p style={{ fontSize: 34, marginBottom: 8 }}>🔍</p>
          <p style={{ fontSize: 14, color: '#5F5E5A', fontWeight: 600 }}>Consulta el inventario</p>
          <p style={{ fontSize: 12, color: '#aaa', marginTop: 6, maxWidth: 260, marginInline: 'auto' }}>
            Busca por nombre (puedes escribir varias palabras) o escanea un código. Toca un
            producto para ver todo y modificar su inventario.
          </p>
        </div>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ fontSize: 12, color: '#aaa' }}>
            {resultados.length} resultado{resultados.length !== 1 ? 's' : ''} · toca para ver y editar
          </p>

          {resultados.map(r => {
            const locs = (r.stockPorUbicacion ?? []).filter(u => u.cantidad > 0)
            return (
              <button
                key={r.codigo}
                onClick={() => setDetalleCodigo(r.codigo)}
                style={{
                  background: 'white', borderRadius: 12,
                  border: '1px solid rgba(0,0,0,0.06)',
                  padding: '14px 16px', width: '100%', textAlign: 'left',
                  display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer',
                }}
              >
                {/* Info del producto */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 600, color: '#1a1a18' }}>{r.nombre}</p>
                  <p style={{ fontSize: 11, color: '#bbb', fontFamily: 'monospace', marginTop: 2 }}>{r.codigo}</p>

                  {/* Desglose en cajas, si el producto tiene caja con N piezas */}
                  {(r.piezas_por_caja ?? 1) > 1 && r.stock > 0 && (
                    <p style={{ fontSize: 12, color: '#3B82F6', fontWeight: 600, marginTop: 4 }}>
                      = {Math.floor(r.stock / r.piezas_por_caja!)} {Math.floor(r.stock / r.piezas_por_caja!) === 1 ? 'caja' : 'cajas'} de {r.piezas_por_caja}
                      {r.stock % r.piezas_por_caja! > 0 ? ` + ${r.stock % r.piezas_por_caja!} sueltas` : ''}
                    </p>
                  )}

                  {/* Chips de ubicación con cantidad */}
                  <div style={{ marginTop: 7, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {locs.length > 0 ? locs.map(u => (
                      <span key={u.ubicacion} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '4px 10px', borderRadius: 20,
                        background: `${u.color}15`, border: `1px solid ${u.color}40`,
                        fontSize: 12, fontWeight: 600, color: u.color,
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: u.color, flexShrink: 0 }} />
                        {u.cantidad} {u.ubicacion}
                      </span>
                    )) : (
                      <span style={{ fontSize: 11, color: '#ccc' }}>
                        {r.stock === 0 ? 'Sin stock registrado' : 'Sin ubicación asignada'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Stock total + indicador de tocable */}
                <div style={{ textAlign: 'right', flexShrink: 0, paddingTop: 2, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                  <div>
                    <p style={{ fontSize: 24, fontWeight: 700, color: stockColor(r.stock), lineHeight: 1 }}>
                      {r.stock}
                    </p>
                    <p style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>pzas</p>
                  </div>
                  <span style={{ fontSize: 18, color: '#ccc', lineHeight: 1.1 }}>›</span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* Modal de ficha del producto */}
      {detalleCodigo && (
        <ProductoDetalle
          codigo={detalleCodigo}
          onClose={() => setDetalleCodigo(null)}
          onCambio={refrescar}
        />
      )}
    </div>
  )
}
