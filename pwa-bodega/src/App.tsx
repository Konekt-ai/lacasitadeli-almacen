import { useState } from 'react'
import Recepcion from './pages/Recepcion'
import Salida from './pages/Salida'
import Historial from './pages/Historial'
import Buscar from './pages/Buscar'
import Merma from './pages/Merma'
import Ubicar from './pages/Ubicar'
import GestionUbicaciones from './pages/GestionUbicaciones'

type Tab = 'recepcion' | 'salida' | 'merma' | 'historial' | 'buscar' | 'ubicar'

const TABS: { id: Tab; label: string; emoji: string }[] = [
  { id: 'recepcion', label: 'Recepción', emoji: '📦' },
  { id: 'salida',    label: 'Salida',    emoji: '📤' },
  { id: 'merma',     label: 'Merma',     emoji: '🗑️' },
  { id: 'historial', label: 'Historial', emoji: '📋' },
  { id: 'buscar',    label: 'Buscar',    emoji: '🔍' },
  { id: 'ubicar',    label: 'Inventario',emoji: '📊' },
]

const TAB_COLOR: Record<Tab, string> = {
  recepcion: '#1D9E75',
  salida:    '#D85A30',
  merma:     '#C05621',
  historial: '#1D9E75',
  buscar:    '#1D9E75',
  ubicar:    '#3B82F6',
}

const TAB_LABEL: Record<Tab, string> = {
  recepcion: 'Recepción de mercancía',
  salida:    'Salida de producto',
  merma:     'Registro de merma',
  historial: 'Historial del día',
  buscar:    'Buscar producto',
  ubicar:    'Inventario general',
}

export default function App() {
  const [tab,       setTab]       = useState<Tab>('recepcion')
  const [showAdmin, setShowAdmin] = useState(false)

  const headerColor = TAB_COLOR[tab]
  const headerLabel = TAB_LABEL[tab]

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
        {tab === 'merma'     && <Merma />}
        {tab === 'historial' && <Historial />}
        {tab === 'buscar'    && <Buscar />}
        {tab === 'ubicar'    && <Ubicar />}
      </div>

      {/* Nav inferior */}
      <div style={{
        display: 'flex',
        borderTop: '1px solid rgba(0,0,0,0.08)',
        background: 'white',
        flexShrink: 0,
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              flex: 1, padding: '10px 0',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              borderTop: tab === t.id ? `2.5px solid ${TAB_COLOR[t.id]}` : '2.5px solid transparent',
              color: tab === t.id ? TAB_COLOR[t.id] : '#aaa',
              transition: 'color 0.15s',
              background: 'none', cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 18 }}>{t.emoji}</span>
            <span style={{ fontSize: 9, fontWeight: tab === t.id ? 600 : 400 }}>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Admin overlay */}
      {showAdmin && <GestionUbicaciones onClose={() => setShowAdmin(false)} />}
    </div>
  )
}
