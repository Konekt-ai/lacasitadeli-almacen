export interface StockUbicacion {
  ubicacion: string
  cantidad: number
  color: string
}

export interface Producto {
  codigo: string
  nombre: string
  stock: number
  stockPorUbicacion?: StockUbicacion[]
}

export interface MovimientoResponse {
  ok: boolean
  stockActual: number
  mensaje: string
}

export interface Movimiento {
  id: number
  codigo: string
  nombre: string | null
  tipo: 'entrada' | 'salida' | 'merma'
  cantidad: number
  stock_antes: number
  stock_despues: number
  usuario: string
  fecha: string
  ubicacion?: string | null
}

export interface Ubicacion {
  id: number
  nombre: string
  color: string
  clave?: string
}

export type MotivoMerma = 'vencimiento' | 'dano' | 'cocina' | 'robo' | 'otro'

export interface PedidoResumen {
  id: number
  folio: string
  proveedor: string | null
  fecha_esperada: string | null
  estado: 'pendiente' | 'en_recepcion' | 'cerrado' | 'cancelado'
  num_items: number
  total_esperado: number
  total_recibido: number
}

const API_URL = import.meta.env.VITE_API_URL || ''

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...options?.headers },
    })
    clearTimeout(timeout)
    if (!res.ok) {
      const err = await res.json().catch(() => ({ mensaje: 'Error del servidor' }))
      throw new Error(err.mensaje ?? err.error ?? `Error ${res.status}`)
    }
    return res.json()
  } catch (e) {
    clearTimeout(timeout)
    if ((e as Error).name === 'AbortError') throw new Error('Sin respuesta del servidor')
    throw e
  }
}

export const api = {
  getProducto: (codigo: string) =>
    request<Producto>(`/api/almacen/producto/${encodeURIComponent(codigo)}`),

  registrarEntrada: (codigo: string, cantidad: number, nombre?: string, pedidoId?: number | null, ubicacion?: string) =>
    request<MovimientoResponse>('/api/almacen/entrada', {
      method: 'POST',
      body: JSON.stringify({ codigo, cantidad, nombre, pedido_id: pedidoId ?? null, ubicacion: ubicacion ?? 'Sin ubicar' }),
    }),

  registrarSalida: (codigo: string, cantidad: number, ubicacion: string, nombre?: string) =>
    request<MovimientoResponse>('/api/almacen/salida', {
      method: 'POST',
      body: JSON.stringify({ codigo, cantidad, ubicacion, nombre }),
    }),

  registrarMerma: (codigo: string, cantidad: number, motivo: MotivoMerma, ubicacion: string, nombre?: string, notas?: string) =>
    request<MovimientoResponse>('/api/almacen/merma', {
      method: 'POST',
      body: JSON.stringify({ codigo, cantidad, motivo, ubicacion, nombre, notas }),
    }),

  getMovimientos: () =>
    request<Movimiento[]>('/api/almacen/movimientos'),

  actualizarMovimiento: (id: number, nuevaCantidad: number) =>
    request<MovimientoResponse>(`/api/almacen/movimientos/${id}/editar`, {
      method: 'POST',
      body: JSON.stringify({ nuevaCantidad }),
    }),

  buscarProductos: (q: string) =>
    request<Producto[]>(`/api/almacen/buscar?q=${encodeURIComponent(q)}`),

  trasladar: (codigo: string, cantidad: number, de_ubicacion: string, a_ubicacion: string) =>
    request<MovimientoResponse>('/api/almacen/traslado', {
      method: 'POST',
      body: JSON.stringify({ codigo, cantidad, de_ubicacion, a_ubicacion }),
    }),

  getUbicaciones: () =>
    request<Ubicacion[]>('/api/almacen/ubicaciones/areas'),

  crearUbicacion: (nombre: string, color: string) =>
    request<Ubicacion[]>('/api/almacen/ubicaciones/areas', {
      method: 'POST',
      body: JSON.stringify({ nombre, color }),
    }),

  eliminarUbicacion: (id: number) =>
    request<Ubicacion[]>(`/api/almacen/ubicaciones/areas/${id}`, { method: 'DELETE' }),

  getPedidosAbiertos: () =>
    request<PedidoResumen[]>('/api/almacen/pedidos?estado=activos'),
}
