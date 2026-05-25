const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://192.168.1.100:3002'

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
  nombre: string
  tipo: 'entrada' | 'salida'
  cantidad: number
  fecha: string
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...options?.headers },
    })
    clearTimeout(timeout)
    if (!res.ok) {
      const err = await res.json().catch(() => ({ mensaje: 'Error desconocido' }))
      throw new Error(err.mensaje ?? `Error ${res.status}`)
    }
    return res.json()
  } catch (e) {
    clearTimeout(timeout)
    if ((e as Error).name === 'AbortError') throw new Error('Sin respuesta del servidor (timeout)')
    throw e
  }
}

export const api = {
  getProducto: (codigo: string) =>
    request<Producto>(`/producto/${codigo}`),

  registrarEntrada: (codigo: string, cantidad: number) =>
    request<MovimientoResponse>('/inventario/entrada', {
      method: 'POST',
      body: JSON.stringify({ codigo, cantidad }),
    }),

  registrarSalida: (codigo: string, cantidad: number) =>
    request<MovimientoResponse>('/inventario/salida', {
      method: 'POST',
      body: JSON.stringify({ codigo, cantidad }),
    }),

  getMovimientos: () =>
    request<Movimiento[]>('/inventario/movimientos'),
}
