import { useEffect, useRef, useState } from 'react'

// Desglose de cómo se contó la cantidad — se manda al padre para mostrarlo o registrarlo.
export interface DesgloseConteo {
  modo: 'cajas' | 'directo'
  filas: number
  columnas: number
  cajas: number          // filas × columnas
  piezasPorCaja: number
  sueltas: number
  total: number          // en la unidad indicada (piezas o cajas)
}

interface Props {
  // 'piezas' → el total son piezas (entrada directa, salida). Suma piezas por caja + sueltas.
  // 'cajas'  → el total son cajas (recepción con orden, el backend convierte a piezas).
  unidad: 'piezas' | 'cajas'
  color: string
  max?: number                  // tope (ej. stock disponible en salida)
  piezasPorCajaInicial?: number
  onChange: (total: number, desglose: DesgloseConteo) => void
}

// ── Stepper grande con − [campo] + ───────────────────────────────────────────
function Stepper({
  label, value, set, min = 0, color,
}: {
  label: string
  value: number
  set: (n: number) => void
  min?: number
  color: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
      <label style={{ fontSize: 12, color: '#5F5E5A', fontWeight: 600, textAlign: 'center' }}>{label}</label>
      <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
        <button
          onClick={() => set(Math.max(min, value - 1))}
          style={{ width: 48, minHeight: 56, fontSize: 26, fontWeight: 300, border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 12, background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
        >−</button>
        <input
          data-manual="true"
          type="number"
          inputMode="numeric"
          value={value}
          min={min}
          onChange={e => set(Math.max(min, parseInt(e.target.value) || 0))}
          onFocus={e => e.target.select()}
          style={{
            flex: 1, width: 0, minWidth: 0, textAlign: 'center', fontSize: 30, fontWeight: 700,
            border: `1.5px solid ${color}55`, borderRadius: 12, padding: '8px 0',
            background: 'white', color: '#1a1a18',
          }}
        />
        <button
          onClick={() => set(value + 1)}
          style={{ width: 48, minHeight: 56, fontSize: 26, fontWeight: 300, border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 12, background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
        >+</button>
      </div>
    </div>
  )
}

export default function ContadorCantidad({ unidad, color, max, piezasPorCajaInicial = 12, onChange }: Props) {
  const [modo,     setModo]     = useState<'cajas' | 'directo'>('cajas')
  const [filas,    setFilas]    = useState(1)
  const [columnas, setColumnas] = useState(1)
  const [ppc,      setPpc]      = useState(piezasPorCajaInicial)
  const [sueltas,  setSueltas]  = useState(0)
  const [directo,  setDirecto]  = useState(1)

  const esPiezas = unidad === 'piezas'
  const cajas = filas * columnas

  let total: number
  if (modo === 'cajas') {
    total = esPiezas ? cajas * ppc + sueltas : cajas
  } else {
    total = directo
  }
  if (max != null && total > max) total = max

  // Reportar al padre cada vez que cambie algo del conteo
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  useEffect(() => {
    onChangeRef.current(total, { modo, filas, columnas, cajas, piezasPorCaja: ppc, sueltas, total })
  }, [total, modo, filas, columnas, ppc, sueltas])

  const unidadLabel = esPiezas ? (total === 1 ? 'pieza' : 'piezas') : (total === 1 ? 'caja' : 'cajas')

  const pill = (activo: boolean): React.CSSProperties => ({
    flex: 1, padding: '12px 8px', borderRadius: 12, cursor: 'pointer',
    border: activo ? `2px solid ${color}` : '1.5px solid rgba(0,0,0,0.10)',
    background: activo ? `${color}15` : 'white',
    color: activo ? color : '#888', fontSize: 13, fontWeight: 700,
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Selector de modo */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button style={pill(modo === 'cajas')} onClick={() => setModo('cajas')}>
          📦 {esPiezas ? 'Por cajas' : 'Filas × columnas'}
        </button>
        <button style={pill(modo === 'directo')} onClick={() => setModo('directo')}>
          🔢 {esPiezas ? 'Piezas sueltas' : 'Escribir número'}
        </button>
      </div>

      {modo === 'cajas' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Filas × columnas */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <Stepper label="Filas" value={filas} set={setFilas} min={1} color={color} />
            <span style={{ fontSize: 22, color: '#bbb', paddingBottom: 14 }}>×</span>
            <Stepper label="Columnas" value={columnas} set={setColumnas} min={1} color={color} />
          </div>
          <div style={{ textAlign: 'center', fontSize: 14, color, fontWeight: 700 }}>
            = {cajas} {cajas === 1 ? 'caja' : 'cajas'}
          </div>

          {/* Solo cuando el total son piezas: piezas por caja + sueltas */}
          {esPiezas && (
            <div style={{ display: 'flex', gap: 10 }}>
              <Stepper label="Piezas por caja" value={ppc} set={setPpc} min={1} color={color} />
              <Stepper label="Piezas sueltas" value={sueltas} set={setSueltas} min={0} color={color} />
            </div>
          )}
        </div>
      ) : (
        <Stepper
          label={esPiezas ? '¿Cuántas piezas?' : '¿Cuántas cajas?'}
          value={directo} set={setDirecto} min={1} color={color}
        />
      )}

      {/* Total grande */}
      <div style={{
        background: `${color}12`, borderRadius: 14, padding: '14px 16px', textAlign: 'center',
        border: `1.5px solid ${color}30`,
      }}>
        <p style={{ fontSize: 12, color: '#5F5E5A', marginBottom: 2 }}>Total a registrar</p>
        <p style={{ fontSize: 34, fontWeight: 800, color, lineHeight: 1.1 }}>
          {total} <span style={{ fontSize: 16, fontWeight: 600 }}>{unidadLabel}</span>
        </p>
        {esPiezas && modo === 'cajas' && (
          <p style={{ fontSize: 12, color: '#5F5E5A', marginTop: 4 }}>
            {cajas} {cajas === 1 ? 'caja' : 'cajas'} × {ppc}{sueltas > 0 ? ` + ${sueltas} sueltas` : ''}
          </p>
        )}
        {max != null && (
          <p style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>Disponible: {max} pzas</p>
        )}
      </div>
    </div>
  )
}
