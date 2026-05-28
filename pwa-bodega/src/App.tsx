import { useState } from 'react'
import Recepcion from './pages/Recepcion'
import Salida from './pages/Salida'
import Historial from './pages/Historial'
import Buscar from './pages/Buscar'
import Merma from './pages/Merma'

type Tab = 'recepcion' | 'salida' | 'historial' | 'buscar' | 'merma'

const TABS: { id: Tab; label: string; emoji: string }[] = [
  { id: 'recepcion', label: 'Recepción', emoji: '📦' },
  { id: 'salida',    label: 'Salida',    emoji: '📤' },
  { id: 'merma',     label: 'Merma',     emoji: '🗑️' },
  { id: 'historial', label: 'Historial', emoji: '📋' },
  { id: 'buscar',    label: 'Buscar',    emoji: '🔍' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('recepcion')

  const headerColor = tab === 'salida' ? '#D85A30' : tab === 'merma' ? '#C05621' : '#1D9E75'
  const headerLabel = tab === 'recepcion' ? 'Recepción de mercancía'
    : tab === 'salida'    ? 'Salida de producto'
    : tab === 'merma'     ? 'Registro de merma'
    : tab === 'historial' ? 'Historial del día'
    : 'Buscar producto'

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100dvh', background: '#f5f5f3', maxWidth: 480, margin: '0 auto'
    }}>
      {/* Header */}
      <div style={{
        background: headerColor, color: 'white',
        padding: '14px 20px 12px',
        display: 'flex', alignItems: 'center', gap: 10,
        flexShrink: 0, transition: 'background 0.2s'
      }}>
        <div>
          <p style={{ fontSize: 16, fontWeight: 600, lineHeight: 1 }}>Bodega</p>
          <p style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>{headerLabel}</p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: 'rgba(255,255,255,0.9)', display: 'inline-block'
          }} />
          <span style={{ fontSize: 12, opacity: 0.8 }}>en línea</span>
        </div>
      </div>

      {/* Contenido */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain' }}>
        {tab === 'recepcion' && <Recepcion />}
        {tab === 'salida'    && <Salida />}
        {tab === 'merma'     && <Merma />}
        {tab === 'historial' && <Historial />}
        {tab === 'buscar'    && <Buscar />}
      </div>

      {/* Nav inferior — estilo TC52: botones grandes */}
      <div style={{
        display: 'flex',
        borderTop: '1px solid rgba(0,0,0,0.08)',
        background: 'white',
        flexShrink: 0,
        paddingBottom: 'env(safe-area-inset-bottom)'
      }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              flex: 1, padding: '12px 0',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              borderTop: tab === t.id ? `2.5px solid ${t.id === 'salida' ? '#D85A30' : t.id === 'merma' ? '#C05621' : '#1D9E75'}` : '2.5px solid transparent',
              color: tab === t.id ? (t.id === 'salida' ? '#D85A30' : t.id === 'merma' ? '#C05621' : '#1D9E75') : '#aaa',
              transition: 'color 0.15s',
              background: 'none', cursor: 'pointer'
            }}
          >
            <span style={{ fontSize: 20 }}>{t.emoji}</span>
            <span style={{ fontSize: 10, fontWeight: tab === t.id ? 600 : 400 }}>{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
