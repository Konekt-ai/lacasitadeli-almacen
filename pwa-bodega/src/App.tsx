import { useEffect, useState } from 'react'
import Recepcion from './pages/Recepcion'
import Salida from './pages/Salida'
import Historial from './pages/Historial'
import Buscar from './pages/Buscar'
import Merma from './pages/Merma'
import Nuevos from './pages/Nuevos'
import GestionUbicaciones from './pages/GestionUbicaciones'
import PedidosWeb from './pages/PedidosWeb'
import Resurtido from './pages/Resurtido'

type Tab = 'recepcion' | 'salida' | 'resurtido' | 'pedidos' | 'merma' | 'historial' | 'buscar' | 'nuevos'

const TABS: { id: Tab; label: string; emoji: string }[] = [
  { id: 'recepcion', label: 'Recepción', emoji: '📦' },
  { id: 'salida',    label: 'Salida',    emoji: '📤' },
  { id: 'resurtido', label: 'Resurtir',  emoji: '🚚' },
  { id: 'pedidos',   label: 'Pedidos',   emoji: '🛒' },
  { id: 'nuevos',    label: 'Nuevos',    emoji: '🆕' },
  { id: 'merma',     label: 'Merma',     emoji: '🗑️' },
  { id: 'historial', label: 'Historial', emoji: '📋' },
  { id: 'buscar',    label: 'Inventario',emoji: '🔍' },
]

const TAB_COLOR: Record<Tab, string> = {
  recepcion: '#1D9E75',
  salida:    '#D85A30',
  resurtido: '#B45309',
  pedidos:   '#7C3AED',
  merma:     '#C05621',
  historial: '#1D9E75',
  buscar:    '#3B82F6',
  nuevos:    '#1D9E75',
}

const TAB_LABEL: Record<Tab, string> = {
  recepcion: 'Recepción de mercancía',
  salida:    'Salida de producto',
  resurtido: 'Resurtido de anaqueles',
  pedidos:   'Pedidos de la página web',
  merma:     'Registro de merma',
  historial: 'Historial del día',
  buscar:    'Inventario · cuánto hay y dónde',
  nuevos:    'Productos nuevos',
}

// Barra inferior: 4 grupos. Tocar uno abre una hoja con sus pestañas;
// un grupo con una sola pestaña la abre directo, sin hoja.
type Grupo = 'entradas' | 'salidas' | 'pedidos' | 'consultar'

const GRUPOS: { id: Grupo; label: string; emoji: string; tabs: Tab[] }[] = [
  { id: 'entradas',  label: 'Entradas',  emoji: '📥', tabs: ['recepcion', 'nuevos'] },
  { id: 'salidas',   label: 'Salidas',   emoji: '📤', tabs: ['salida', 'resurtido', 'merma'] },
  { id: 'pedidos',   label: 'Pedidos',   emoji: '🛒', tabs: ['pedidos'] },
  { id: 'consultar', label: 'Consultar', emoji: '🔍', tabs: ['buscar', 'historial'] },
]

const grupoDeTab = (tab: Tab) => GRUPOS.find(g => g.tabs.includes(tab)) ?? GRUPOS[0]
const tabInfo    = (id: Tab) => TABS.find(t => t.id === id)!

export default function App() {
  const [tab,          setTab]          = useState<Tab>('recepcion')
  const [showAdmin,    setShowAdmin]    = useState(false)
  const [grupoAbierto, setGrupoAbierto] = useState<Grupo | null>(null)

  const headerColor = TAB_COLOR[tab]
  const headerLabel = TAB_LABEL[tab]
  const grupoActivo = grupoDeTab(tab)
  const hoja        = grupoAbierto ? GRUPOS.find(g => g.id === grupoAbierto) ?? null : null

  // La pistola tipea como teclado (useBarcodeScan escucha keydown en window).
  // Con la hoja abierta, el primer carácter del escaneo la cierra; el evento no se
  // detiene, así que el código sigue llegando a la pestaña activa.
  useEffect(() => {
    if (!grupoAbierto) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key.length === 1) setGrupoAbierto(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [grupoAbierto])

  function tocarGrupo(g: typeof GRUPOS[number], boton: HTMLButtonElement) {
    boton.blur() // que un Enter del escáner no vuelva a "clickear" el botón
    if (g.tabs.length === 1) {
      setTab(g.tabs[0])
      setGrupoAbierto(null)
      return
    }
    setGrupoAbierto(prev => (prev === g.id ? null : g.id))
  }

  function elegirTab(id: Tab, boton: HTMLButtonElement) {
    boton.blur()
    setTab(id)
    setGrupoAbierto(null)
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100dvh', background: '#f5f5f3', maxWidth: 480, margin: '0 auto',
    }}>
      {/* Header */}
      <div style={{
        background: headerColor, color: 'white',
        padding: '14px 20px 12px',
        display: 'flex', alignItems: 'center', gap: 10,
        flexShrink: 0, transition: 'background 0.2s',
      }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 16, fontWeight: 600, lineHeight: 1 }}>Bodega</p>
          <p style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>{headerLabel}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(255,255,255,0.9)', display: 'inline-block' }} />
            <span style={{ fontSize: 12, opacity: 0.8 }}>en línea</span>
          </div>
          <button
            onClick={() => setShowAdmin(true)}
            style={{
              background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 8,
              color: 'white', fontSize: 16, width: 32, height: 32,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            title="Gestionar ubicaciones"
          >⚙</button>
        </div>
      </div>

      {/* Contenido */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain' }}>
        {tab === 'recepcion' && <Recepcion />}
        {tab === 'salida'    && <Salida />}
        {tab === 'resurtido' && <Resurtido />}
        {tab === 'pedidos'   && <PedidosWeb />}
        {tab === 'merma'     && <Merma />}
        {tab === 'historial' && <Historial />}
        {tab === 'buscar'    && <Buscar />}
        {tab === 'nuevos'    && <Nuevos />}
      </div>

      {/* Fondo oscuro: tocar fuera cierra la hoja */}
      {hoja && (
        <div
          onClick={() => setGrupoAbierto(null)}
          aria-hidden="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 20 }}
        />
      )}

      {/* Nav inferior (la hoja del grupo cuelga pegada arriba de la barra) */}
      <div style={{ position: 'relative', zIndex: 30, flexShrink: 0 }}>
        {hoja && (
          <div
            role="menu"
            aria-label={hoja.label}
            className="hoja-grupo"
            style={{
              position: 'absolute', bottom: '100%', left: 8, right: 8, marginBottom: 6,
              background: 'white', borderRadius: 14, padding: 8,
              boxShadow: '0 -4px 24px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08)',
            }}
          >
            <p style={{
              fontSize: 12, fontWeight: 600, color: '#5F5E5A',
              textTransform: 'uppercase', letterSpacing: 0.5, padding: '2px 6px 8px',
            }}>
              {hoja.emoji} {hoja.label}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${hoja.tabs.length}, minmax(0, 1fr))`, gap: 6 }}>
              {hoja.tabs.map(id => {
                const t = tabInfo(id)
                const activa = tab === id
                return (
                  <button
                    key={id}
                    role="menuitem"
                    className="hoja-btn"
                    onClick={e => elegirTab(id, e.currentTarget)}
                    style={{
                      minHeight: 64, borderRadius: 12, padding: '8px 4px',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
                      background: activa ? TAB_COLOR[id] : '#F1EFE8',
                      color: activa ? 'white' : '#1a1a18',
                    }}
                  >
                    <span style={{ fontSize: 24, lineHeight: 1 }}>{t.emoji}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.1 }}>{t.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div style={{
          display: 'flex',
          borderTop: '1px solid rgba(0,0,0,0.08)',
          background: 'white',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}>
          {GRUPOS.map(g => {
            const esActivo = grupoActivo.id === g.id
            const abierto  = grupoAbierto === g.id
            const color    = esActivo ? TAB_COLOR[tab] : '#aaa'
            const tabActiva = esActivo ? tabInfo(tab) : null
            return (
              <button
                key={g.id}
                onClick={e => tocarGrupo(g, e.currentTarget)}
                aria-expanded={g.tabs.length > 1 ? abierto : undefined}
                aria-haspopup={g.tabs.length > 1 ? 'menu' : undefined}
                style={{
                  // El grupo activo se ensancha un poco para que quepa "Grupo · Pestaña"
                  flexGrow: esActivo ? 1.5 : 1, flexBasis: 0, minWidth: 0,
                  padding: '10px 0',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
                  borderTop: esActivo ? `2.5px solid ${TAB_COLOR[tab]}` : '2.5px solid transparent',
                  color: abierto && !esActivo ? '#5F5E5A' : color,
                  transition: 'color 0.15s, flex-grow 0.15s',
                  background: 'none', cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: 18 }}>{g.emoji}</span>
                <span style={{
                  fontSize: 9, fontWeight: esActivo ? 600 : 400,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  maxWidth: '100%', padding: '0 3px',
                }}>
                  {/* Con una sola pestaña (Pedidos) no repetir "Pedidos · Pedidos" */}
                  {tabActiva && g.tabs.length > 1 ? `${g.label} · ${tabActiva.label}` : g.label}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Admin overlay */}
      {showAdmin && <GestionUbicaciones onClose={() => setShowAdmin(false)} />}
    </div>
  )
}
