export interface Producto {
  codigo: string
  nombre: string
  stock: number
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
  tipo: 'entrada' | 'salida'
  cantidad: number
  stock_antes: number
  stock_despues: number
  usuario: string
  fecha: string
}

export type MotivoMerma = 'vencimiento' | 'dano' | 'cocina' | 'robo' | 'otro'

// Deja que la app lea la IP del archivo .env creado por iniciar.bat
const API_URL = import.meta.env.VITE_API_URL || '';

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
      throw new Error(err.mensaje ?? `Error ${res.status}`)
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

  registrarEntrada: (codigo: string, cantidad: number, nombre?: string) =>
    request<MovimientoResponse>('/api/almacen/entrada', {
      method: 'POST',
      body: JSON.stringify({ codigo, cantidad, nombre }),
    }),

  registrarSalida: (codigo: string, cantidad: number, nombre?: string) =>
    request<MovimientoResponse>('/api/almacen/salida', {
      method: 'POST',
      body: JSON.stringify({ codigo, cantidad, nombre }),
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

  registrarMerma: (codigo: string, cantidad: number, motivo: MotivoMerma, area: string, nombre?: string, notas?: string) =>
    request<MovimientoResponse>('/api/almacen/merma', {
      method: 'POST',
      body: JSON.stringify({ codigo, cantidad, motivo, area, nombre, notas }),
    }),

  getMermasHoy: () =>
    request<MermaRegistro[]>('/api/almacen/merma'),
}

export interface MermaRegistro {
  id: number
  codigo: string
  nombre: string | null
  motivo: MotivoMerma
  area: string
  cantidad: number
  stock_antes: number
  stock_despues: number
  notas: string | null
  usuario: string
  fecha: string
}