import { useState, useEffect, useCallback } from 'react'
import { api, type ProductoPendiente, type Ubicacion } from '../api/inventario'
import { useBarcodeScan } from '../hooks/useBarcodeScan'
import { beepScan, beepOk, beepError } from '../utils/beep'
import ContadorCantidad from '../components/ContadorCantidad'

const VERDE = '#1D9E75'

export default function Nuevos() {
  const [pendientes, setPendientes] = useState<ProductoPendiente[]>([])
  const [cargando,   setCargando]   = useState(false)
  const [error,      setError]      = useState('')
  const [toast,      setToast]      = useState('')

  // Resolución: pendiente seleccionado + código escaneado
  const [resolviendo, setResolviendo] = useState<ProductoPendiente | null>(null)
  const [codigo,      setCodigo]      = useState('')
  const [ppc,         setPpc]         = useState('1')
  const [guardando,   setGuardando]   = useState(false)

  // Alta de producto nuevo (en un paso: con código, cantidad y ubicación)
  const [modoCrear,   setModoCrear]   = useState(false)
  const [fDesc,       setFDesc]       = useState('')
  const [fProv,       setFProv]       = useState('')
  const [fPpc,        setFPpc]        = useState('1')
  const [fCodigo,     setFCodigo]     = useState('')
  const [fCantidad,   setFCantidad]   = useState(0)
  const [fUbic,       setFUbic]       = useState('Bodega')
  const [avisoExiste, setAvisoExiste] = useState('')
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([])

  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3000) }

  const cargar = useCallback(async () => {
    setCargando(true); setError('')
    try { setPendientes(await api.getPendientes('')) }
    catch (e) { setError((e as Error).message) }
    finally { setCargando(false) }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  useEffect(() => {
    api.getUbicaciones().then(u => {
      setUbicaciones(u)
      if (u.length > 0) setFUbic(u[0].nombre)
    }).catch(() => {})
  }, [])

  // Escaneo: llena el código del pendiente en resolución, o del producto nuevo.
  const onScan = useCallback((cod: string) => {
    if (resolviendo) { setCodigo(cod); beepScan() }
    else if (modoCrear) { setFCodigo(cod); beepScan() }
  }, [resolviendo, modoCrear])
  useBarcodeScan(onScan)

  // Aviso si el código ya existe en NovaCaja (mejor usar Entrada en ese caso).
  async function verificarCodigo(cod: string) {
    const c = cod.trim()
    if (c.length < 4) { setAvisoExiste(''); return }
    try {
      const prod = await api.getProducto(c)
      setAvisoExiste(prod ? `Ya existe: "${prod.nombre}". Mejor usa Entrada.` : '')
    } catch { setAvisoExiste('') }
  }

  function abrirResolver(p: ProductoPendiente) {
    setResolviendo(p)
    setCodigo('')
    setPpc(String(p.piezas_por_caja || 1))
  }

  async function resolver() {
    if (!resolviendo) return
    const cb = codigo.trim()
    if (!cb) { notify('Escanea o escribe el código'); beepError(); return }
    setGuardando(true)
    try {
      const r = await api.resolverPendiente(resolviendo.id, cb, parseInt(ppc) || 1)
      beepOk()
      notify(r.equivalencia ? 'Código asignado · enlace creado' : 'Código asignado')
      setResolviendo(null)
      cargar()
    } catch (e) { notify((e as Error).message); beepError() }
    finally { setGuardando(false) }
  }

  function cerrarCrear() {
    setModoCrear(false)
    setFDesc(''); setFProv(''); setFPpc('1'); setFCodigo(''); setFCantidad(0); setAvisoExiste('')
    if (ubicaciones.length > 0) setFUbic(ubicaciones[0].nombre)
  }

  async function crear() {
    const desc = fDesc.trim()
    const cod  = fCodigo.trim()
    if (desc.length < 3) { notify('Escribe la descripción'); beepError(); return }
    if (/^[\d\s.-]+$/.test(desc)) { notify('El nombre no puede ser solo números (eso es un código)'); beepError(); return }
    if (desc === cod)    { notify('El nombre no puede ser el código. Escribe el nombre real.'); beepError(); return }
    if (cod.length < 4)  { notify('Escanea o escribe el código de barras'); beepError(); return }
    // Solo nombre y código son obligatorios; la cantidad y lo demás es opcional.
    setGuardando(true)
    try {
      await api.crearProductoNuevo({
        codigo_barras: cod,
        descripcion: desc,
        cantidad: fCantidad,
        ubicacion: fUbic,
        piezas_por_caja: parseInt(fPpc) || 1,
        proveedor: fProv.trim() || null,
      })
      beepOk()
      notify(`Registrado · +${fCantidad} pzas en ${fUbic}`)
      cerrarCrear()
      cargar()
    } catch (e) { notify((e as Error).message); beepError() }
    finally { setGuardando(false) }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '14px', fontSize: 16, boxSizing: 'border-box',
    border: '1.5px solid rgba(0,0,0,0.12)', borderRadius: 12, background: 'white', color: '#1a1a18',
  }
  const labelStyle: React.CSSProperties = { fontSize: 11, color: '#888', fontWeight: 600, marginBottom: 4, display: 'block' }

  // Obligatorios para dar de alta: SOLO nombre y código. Lo demás es opcional.
  const _desc = fDesc.trim()
  const _cod  = fCodigo.trim()
  const nombreOk = _desc.length >= 3 && !/^[\d\s.-]+$/.test(_desc) && _desc !== _cod
  const codigoOk = _cod.length >= 4
  const puedeRegistrar = nombreOk && codigoOk

  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>

      {toast && (
        <div style={{
          position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)', zIndex: 100,
          background: VERDE, color: 'white', padding: '10px 18px', borderRadius: 20,
          fontSize: 13, fontWeight: 600, boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
        }}>{toast}</div>
      )}

      {/* Alta de producto nuevo — en un paso: descripción + código + cantidad + ubicación */}
      {modoCrear ? (
        <div style={{ background: 'white', borderRadius: 14, padding: 16, border: '1px solid rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: '#1a1a18' }}>Registrar producto nuevo</p>

          <div>
            <label style={labelStyle}>Descripción del producto *</label>
            <input data-manual="true" value={fDesc} onChange={e => setFDesc(e.target.value)}
              placeholder="Ej. Galletas de chocolate 12oz" style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>Código de barras * (escanea o escribe)</label>
            <input data-manual="true" value={fCodigo}
              onChange={e => { setFCodigo(e.target.value); verificarCodigo(e.target.value) }}
              placeholder="Apunta el lector o escribe el código"
              style={{ ...inputStyle, fontFamily: 'monospace' }} />
            {avisoExiste && (
              <p style={{ fontSize: 12, color: '#C05621', fontWeight: 600, marginTop: 6 }}>⚠️ {avisoExiste}</p>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Proveedor (opcional)</label>
              <input data-manual="true" value={fProv} onChange={e => setFProv(e.target.value)}
                placeholder="Proveedor" style={inputStyle} />
            </div>
            <div style={{ width: 100 }}>
              <label style={labelStyle}>Pzas/caja</label>
              <input data-manual="true" type="number" min="1" value={fPpc} onChange={e => setFPpc(e.target.value)}
                style={{ ...inputStyle, textAlign: 'center' }} />
            </div>
          </div>

          <div>
            <label style={labelStyle}>Cantidad (opcional)</label>
            <ContadorCantidad unidad="piezas" color={VERDE}
              piezasPorCajaInicial={parseInt(fPpc) || 1}
              onChange={t => setFCantidad(t)} />
          </div>

          {ubicaciones.length > 0 && (
            <div>
              <label style={labelStyle}>¿Dónde va?</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {ubicaciones.map(u => (
                  <button key={u.id} onClick={() => setFUbic(u.nombre)}
                    style={{
                      padding: '12px 10px', borderRadius: 12, cursor: 'pointer',
                      border: fUbic === u.nombre ? `2px solid ${u.color}` : '1.5px solid rgba(0,0,0,0.08)',
                      background: fUbic === u.nombre ? `${u.color}18` : 'white',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: u.color }} />
                    <span style={{ fontSize: 12, fontWeight: fUbic === u.nombre ? 700 : 500, color: fUbic === u.nombre ? u.color : '#5F5E5A' }}>{u.nombre}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!puedeRegistrar && (
            <p style={{ fontSize: 12, color: '#C05621', fontWeight: 600, textAlign: 'center' }}>
              {!nombreOk ? '✍️ Falta el nombre del producto' : '📷 Falta el código de barras'}
            </p>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={cerrarCrear}
              style={{ flex: 1, padding: 14, borderRadius: 12, background: '#eee', color: '#666', fontSize: 15, fontWeight: 600 }}>
              Cancelar
            </button>
            <button onClick={crear} disabled={guardando || !puedeRegistrar}
              style={{ flex: 2, padding: 14, borderRadius: 12, background: VERDE, color: 'white', fontSize: 15, fontWeight: 700, opacity: guardando || !puedeRegistrar ? 0.5 : 1 }}>
              {guardando ? 'Guardando...' : `Registrar${fCantidad > 0 ? ` · ${fCantidad} pzas` : ''}`}
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setModoCrear(true)}
          style={{ padding: 14, borderRadius: 12, background: VERDE, color: 'white', fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          ➕ Registrar producto nuevo
        </button>
      )}

      <p style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>
        Al registrar, el stock se suma al instante y ya aparece en Inventario. El precio se lo pone el admin después.
      </p>

      {cargando && <p style={{ textAlign: 'center', color: VERDE, fontSize: 14 }}>Cargando...</p>}

      {!cargando && error && (
        <div style={{ background: '#FAECE7', borderRadius: 12, padding: '14px 16px' }}>
          <p style={{ color: '#712B13', fontSize: 13, fontWeight: 600 }}>Error de conexión</p>
          <p style={{ color: '#712B13', fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all' }}>{error}</p>
        </div>
      )}

      {!cargando && !error && pendientes.length === 0 && (
        <p style={{ textAlign: 'center', color: '#aaa', fontSize: 14, padding: '24px 0' }}>
          No hay productos pendientes 🎉
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {pendientes.map(p => (
          <div key={p.id} style={{
            background: 'white', borderRadius: 12, border: '1px solid rgba(0,0,0,0.06)', padding: 14,
          }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#1a1a18' }}>{p.descripcion_proveedor}</p>
            <p style={{ fontSize: 11, color: '#bbb', marginTop: 2 }}>
              {p.proveedor || 'Sin proveedor'}{p.sku_proveedor ? ` · SKU ${p.sku_proveedor}` : ''} · {p.piezas_por_caja} pzas/caja
            </p>

            {resolviendo?.id === p.id ? (
              <div style={{ marginTop: 12, borderTop: '1px solid #eee', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{
                  background: codigo ? '#E8F5EF' : '#FFF7ED', borderRadius: 10, padding: '12px 14px',
                  border: `1.5px dashed ${codigo ? VERDE : '#E08030'}`, textAlign: 'center',
                }}>
                  <p style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
                    {codigo ? 'Código escaneado' : '📷 Escanea el código del producto'}
                  </p>
                  <p style={{ fontSize: 18, fontWeight: 700, fontFamily: 'monospace', color: codigo ? VERDE : '#E08030' }}>
                    {codigo || '—'}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input data-manual="true" value={codigo} onChange={e => setCodigo(e.target.value)}
                    placeholder="o escribe el código" style={{ ...inputStyle, flex: 1, fontFamily: 'monospace' }} />
                  <input data-manual="true" type="number" min="1" value={ppc} onChange={e => setPpc(e.target.value)}
                    style={{ ...inputStyle, width: 80, textAlign: 'center' }} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setResolviendo(null)}
                    style={{ flex: 1, padding: 12, borderRadius: 10, background: '#eee', color: '#666', fontSize: 14, fontWeight: 600 }}>
                    Cancelar
                  </button>
                  <button onClick={resolver} disabled={guardando || !codigo.trim()}
                    style={{ flex: 2, padding: 12, borderRadius: 10, background: VERDE, color: 'white', fontSize: 14, fontWeight: 700, opacity: guardando || !codigo.trim() ? 0.5 : 1 }}>
                    {guardando ? 'Guardando...' : 'Asignar código'}
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => abrirResolver(p)}
                style={{ marginTop: 10, width: '100%', padding: 12, borderRadius: 10, background: `${VERDE}15`, color: VERDE, fontSize: 14, fontWeight: 700, border: `1px solid ${VERDE}40` }}>
                📷 Asignar código
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
