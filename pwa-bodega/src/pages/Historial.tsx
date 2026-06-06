import { useState, useEffect } from 'react'
import { api, type Movimiento } from '../api/inventario'

const TIPO_CONFIG = {
  entrada:  { icon: '↓', bg: '#E1F5EE', color: '#085041', signo: '+' },
  salida:   { icon: '↑', bg: '#FAECE7', color: '#712B13', signo: '−' },
  merma:    { icon: '🗑', bg: '#FEF3C7', color: '#92400E', signo: '−' },
  traslado: { icon: '↔', bg: '#E0F2FE', color: '#075985', signo: '' },
}

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

  async function handleEditar(id: number, cantidadActual: number, nombreProducto: string) {
    const nuevoValor = window.prompt(
      `Editar cantidad para:\n${nombreProducto}\n\nCantidad actual:`,
      cantidadActual.toString()
    )
    if (nuevoValor === null) return

    const nuevaCantidad = parseInt(nuevoValor, 10)
    if (isNaN(nuevaCantidad) || nuevaCantidad <= 0) {
      alert('Por favor, introduce un número válido mayor a 0.')
      return
    }
    if (nuevaCantidad === cantidadActual) return

    try {
      setCargando(true)
      await api.actualizarMovimiento(id, nuevaCantidad)
      await cargar()
    } catch (e) {
      alert((e as Error).message)
      setCargando(false)
    }
  }

  async function handleEditarNombre(codigo: string, nombreActual: string) {
    const nuevo = window.prompt(
      `Corregir el nombre del producto.\n\nNo escribas el código aquí, escribe el nombre real (ej. "Coca Cola 600ml").`,
      nombreActual
    )
    if (nuevo === null) return
    const nombre = nuevo.trim()
    if (nombre.length < 3) { alert('El nombre debe tener al menos 3 letras.'); return }
    if (/^[\d\s.-]+$/.test(nombre)) { alert('El nombre no puede ser solo números (eso es un código).'); return }

    try {
      setCargando(true)
      await api.actualizarNombre(codigo, nombre)
      await cargar()
    } catch (e) {
      alert((e as Error).message)
      setCargando(false)
    }
  }

  async function handleBorrar(id: number, nombreProducto: string) {
    if (!window.confirm(`¿Borrar este movimiento?\n\n${nombreProducto}\n\nSe revertirá su efecto en el stock. Esta acción no se puede deshacer.`)) return
    try {
      setCargando(true)
      await api.eliminarMovimiento(id)
      await cargar()
    } catch (e) {
      alert((e as Error).message)
      setCargando(false)
    }
  }

  if (cargando) return <div style={{ padding: 24, textAlign: 'center', color: '#5F5E5A', fontSize: 14 }}>Cargando movimientos...</div>
  if (error) return (
    <div style={{ padding: 24, textAlign: 'center' }}>
      <p style={{ color: '#712B13', fontSize: 14, marginBottom: 16 }}>{error}</p>
      <button className="btn-secondary" onClick={cargar} style={{ padding: '10px 24px' }}>Reintentar</button>
    </div>
  )
  if (movimientos.length === 0) return <div style={{ padding: 40, textAlign: 'center', color: '#5F5E5A', fontSize: 14 }}>Sin movimientos hoy</div>

  return (
    <div style={{ padding: '16px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <p style={{ fontSize: 13, color: '#5F5E5A' }}>Movimientos de hoy</p>
        <button onClick={cargar} style={{ fontSize: 13, color: '#1D9E75', background: 'none', border: 'none', cursor: 'pointer' }}>Actualizar</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {movimientos.map((m) => {
          const cfg = TIPO_CONFIG[m.tipo] ?? TIPO_CONFIG.salida
          return (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                background: cfg.bg,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
              }}>
                {cfg.icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: '#1a1a18', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {m.nombre ?? m.codigo}
                </p>
                <p style={{ fontSize: 12, color: '#aaa' }}>
                  {formatHora(m.fecha)} · {m.tipo}{m.ubicacion ? ` · ${m.ubicacion}` : ''}
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <p style={{ fontSize: 16, fontWeight: 700, color: cfg.color, minWidth: 34, textAlign: 'right' }}>
                  {cfg.signo}{m.cantidad}
                </p>
                {m.es_bodega === 1 && (
                  <button
                    onClick={() => handleEditarNombre(m.codigo, m.nombre ?? m.codigo)}
                    style={{ background: '#eef6f2', border: '1px solid rgba(29,158,117,0.25)', borderRadius: '6px', padding: '5px 7px', cursor: 'pointer', fontSize: 14 }}
                    title="Corregir nombre"
                  >
                    🏷️
                  </button>
                )}
                <button
                  onClick={() => handleEditar(m.id, m.cantidad, m.nombre ?? m.codigo)}
                  style={{ background: '#f4f4f2', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '6px', padding: '5px 7px', cursor: 'pointer', fontSize: 14 }}
                  title="Editar cantidad"
                >
                  ✏️
                </button>
                <button
                  onClick={() => handleBorrar(m.id, m.nombre ?? m.codigo)}
                  style={{ background: '#fbece7', border: '1px solid rgba(216,90,48,0.25)', borderRadius: '6px', padding: '5px 7px', cursor: 'pointer', fontSize: 14 }}
                  title="Borrar movimiento"
                >
                  🗑️
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
