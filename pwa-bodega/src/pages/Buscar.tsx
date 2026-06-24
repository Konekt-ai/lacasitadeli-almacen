import { useState } from 'react'
import { useBarcodeScan } from '../hooks/useBarcodeScan'
import { api, type Producto } from '../api/inventario'
import { beepScan, beepError } from '../utils/beep'

function stockColor(stock: number) {
  if (stock === 0) return '#bbb'
  if (stock < 5)   return '#E08030'
  return '#1D9E75'
}

export default function Buscar() {
  const [query,      setQuery]      = useState('')
  const [resultados, setResultados] = useState<Producto[]>([])
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

  useBarcodeScan(buscar)

  async function renombrar(codigo: string, nombreActual: string) {
    const nuevo = window.prompt(
      `Corregir el nombre del producto.\n\nEscribe el nombre real (no el código).`,
      nombreActual
    )
    if (nuevo === null) return
    const nombre = nuevo.trim()
    if (nombre.length < 3) { alert('El nombre debe tener al menos 3 letras.'); return }
    if (/^[\d\s.-]+$/.test(nombre)) { alert('El nombre no puede ser solo números (eso es un código).'); return }
    try {
      setCargando(true)
      await api.actualizarNombre(codigo, nombre)
      await buscar()
    } catch (e) {
      alert((e as Error).message)
      setCargando(false)
    }
  }

  // Vincular el código de la CAJA a un producto (1 caja = N piezas)
  async function vincularCaja(p: Producto) {
    const cod = window.prompt(`Escanea o escribe el CÓDIGO DE LA CAJA de:\n${p.nombre}`)
    if (cod === null) return
    const codCaja = cod.trim()
    if (codCaja.length < 4) { alert('Código de caja inválido.'); return }
    const ppcStr = window.prompt('¿Cuántas piezas trae cada caja? (ej. 12)', String(p.piezas_por_caja && p.piezas_por_caja > 1 ? p.piezas_por_caja : 12))
    if (ppcStr === null) return
    const ppc = parseInt(ppcStr, 10)
    if (!(ppc >= 2)) { alert('Las piezas por caja deben ser 2 o más.'); return }
    try {
      setCargando(true)
      await api.vincularCodigoCaja(p.codigo, codCaja, ppc)
      await buscar()
    } catch (e) { alert((e as Error).message); setCargando(false) }
  }

  // Corregir stock mal contado (lo que se metió como piezas pero eran cajas)
  async function corregirStock(p: Producto) {
    const ppcStr = window.prompt(
      `Reajustar el stock de:\n${p.nombre}\n\nStock actual: ${p.stock}\n\n¿Cuántas piezas trae cada caja? El stock se multiplicará por ese número (ej. ${p.stock} × 12).`,
      String(p.piezas_por_caja && p.piezas_por_caja > 1 ? p.piezas_por_caja : 12)
    )
    if (ppcStr === null) return
    const factor = parseInt(ppcStr, 10)
    if (!(factor >= 2)) { alert('El número debe ser 2 o más.'); return }
    if (!window.confirm(`Se reajustará: ${p.stock} → ${p.stock * factor} piezas.\n¿Confirmas?`)) return
    try {
      setCargando(true)
      await api.reinterpretarStock(p.codigo, factor)
      await buscar()
    } catch (e) { alert((e as Error).message); setCargando(false) }
  }

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
            Busca un producto por nombre o escanea su código para ver cuánto hay y en qué ubicación está.
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
            {resultados.length} resultado{resultados.length !== 1 ? 's' : ''}
          </p>

          {resultados.map(r => {
            const locs = (r.stockPorUbicacion ?? []).filter(u => u.cantidad > 0)
            return (
              <div key={r.codigo} style={{
                background: 'white', borderRadius: 12,
                border: '1px solid rgba(0,0,0,0.06)',
                padding: '14px 16px',
                display: 'flex', alignItems: 'flex-start', gap: 12,
              }}>
                {/* Info del producto */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: '#1a1a18' }}>{r.nombre}</p>
                    <button
                      onClick={() => renombrar(r.codigo, r.nombre)}
                      style={{ background: '#eef6f2', border: '1px solid rgba(29,158,117,0.25)', borderRadius: 6, padding: '2px 6px', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}
                      title="Corregir nombre"
                    >🏷️</button>
                    <button
                      onClick={() => vincularCaja(r)}
                      style={{ background: '#F0F7FF', border: '1px solid rgba(59,130,246,0.25)', borderRadius: 6, padding: '2px 6px', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}
                      title={(r.piezas_por_caja ?? 1) > 1 ? 'Cambiar código/piezas de la caja' : 'Vincular código de caja'}
                    >📦</button>
                    <button
                      onClick={() => corregirStock(r)}
                      style={{ background: '#FFF3E0', border: '1px solid rgba(216,90,48,0.25)', borderRadius: 6, padding: '2px 6px', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}
                      title="Corregir stock mal contado (×piezas por caja)"
                    >🔧</button>
                  </div>
                  <p style={{ fontSize: 11, color: '#bbb', fontFamily: 'monospace', marginTop: 2 }}>{r.codigo}</p>

                  {/* Desglose en cajas, si el producto tiene caja con N piezas */}
                  {(r.piezas_por_caja ?? 1) > 1 && r.stock > 0 && (
                    <p style={{ fontSize: 12, color: '#3B82F6', fontWeight: 600, marginTop: 4 }}>
                      = {Math.floor(r.stock / r.piezas_por_caja!)} {Math.floor(r.stock / r.piezas_por_caja!) === 1 ? 'caja' : 'cajas'} de {r.piezas_por_caja}
                      {r.stock % r.piezas_por_caja! > 0 ? ` + ${r.stock % r.piezas_por_caja!} sueltas` : ''}
                    </p>
                  )}

                  {/* Chips de ubicación con cantidad — visibles siempre */}
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

                {/* Stock total */}
                <div style={{ textAlign: 'right', flexShrink: 0, paddingTop: 2 }}>
                  <p style={{ fontSize: 24, fontWeight: 700, color: stockColor(r.stock), lineHeight: 1 }}>
                    {r.stock}
                  </p>
                  <p style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>pzas</p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
