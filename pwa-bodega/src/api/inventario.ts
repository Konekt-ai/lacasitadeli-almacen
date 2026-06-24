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
  codigo_base?: string
  tipo?: 'individual' | 'caja'   // del código ESCANEADO
  unidades?: number              // piezas que representa el código escaneado
  piezas_por_caja?: number       // tamaño de la caja del producto (1 si no tiene)
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
  tipo: 'entrada' | 'salida' | 'merma' | 'traslado'
  cantidad: number
  stock_antes: number
  stock_despues: number
  usuario: string
  fecha: string
  ubicacion?: string | null
  es_bodega?: number   // 1 = producto que maneja la bodega (se puede editar su nombre)
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

// Orden de compra esperada (MSSQL recepciones_esperadas) — lo que viene en el trailer
export interface RecepcionEsperada {
  id: number
  referencia: string | null
  proveedor: string | null
  fecha_esperada: string | null
  destino_esperado: string | null
  estatus: 'Pendiente' | 'Parcial' | 'Recibida' | 'Cancelada'
  notas: string | null
  creado: string
  num_items: number
  total_cajas_esperadas: number
  total_piezas_esperadas: number
}

// ── Recepción con conversión caja→pieza (/api/recepcion/*) ──
export interface AbrirRecepcionResponse {
  ok: boolean
  id: number      // id de la recepción real (recepcionRealId)
  nueva: boolean
}

export interface ItemRecepcionResponse {
  ok: boolean
  id: number
  piezas_resultantes: number
  nombre: string
  piezas_por_caja: number
}

export interface ItemRecepcionInput {
  codigo_barras: string
  cajas_recibidas: number
  ubicacion: string
  piezas_por_caja?: number
  lote?: string | null
  caducidad?: string | null
}

// ── Productos nuevos pendientes (staging — aún sin código en NovaCaja) ──
export interface ProductoPendiente {
  id: number
  proveedor: string | null
  sku_proveedor: string | null
  descripcion_proveedor: string
  unidad: string | null
  piezas_por_caja: number
  cajas: number
  precio_unitario: number | null
  estado: string
  codigo_barras: string | null
  origen: string
  created_at: string
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
      body: JSON.stringify({ codigo, cantidad, nombre, pedido_id: pedidoId ?? null, ubicacion: ubicacion ?? 'Bodega' }),
    }),

  // Registra un producto que aún NO existe en NovaCaja: crea su nombre propio en
  // la bodega y suma stock al instante (visible en Inventario e Historial).
  crearProductoNuevo: (p: {
    codigo_barras: string; codigo_caja?: string; descripcion: string; cantidad: number
    ubicacion: string; piezas_por_caja?: number; proveedor?: string | null
  }) =>
    request<MovimientoResponse>('/api/almacen/producto-nuevo', {
      method: 'POST',
      body: JSON.stringify(p),
    }),

  // Liga un código de caja a un producto base (1 caja = N piezas)
  vincularCodigoCaja: (codigo_base: string, codigo_caja: string, piezas_por_caja: number) =>
    request<{ ok: boolean; piezas_por_caja: number; mensaje: string }>(
      '/api/almacen/codigos/vincular', {
        method: 'POST',
        body: JSON.stringify({ codigo_base, codigo_caja, piezas_por_caja }),
      }),

  // Reajusta el stock mal contado multiplicándolo por un factor (ej. ×12)
  reinterpretarStock: (codigo: string, factor: number) =>
    request<{ ok: boolean; stockActual: number; mensaje: string }>(
      `/api/almacen/codigos/${encodeURIComponent(codigo)}/reinterpretar`, {
        method: 'POST',
        body: JSON.stringify({ factor }),
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

  eliminarMovimiento: (id: number) =>
    request<{ ok: boolean; stockActual: number; mensaje: string }>(
      `/api/almacen/movimientos/${id}`, { method: 'DELETE' }),

  actualizarNombre: (codigo: string, nombre: string) =>
    request<{ ok: boolean; nombre: string; mensaje: string }>(
      `/api/almacen/producto/${encodeURIComponent(codigo)}/nombre`, {
        method: 'POST',
        body: JSON.stringify({ nombre }),
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

  // Mueve TODO el inventario de un área a otra (corrige áreas creadas por error)
  moverInventario: (de: string, a: string, eliminarOrigen = true) =>
    request<{ ok: boolean; productos: number; piezas: number; quitada: boolean; mensaje: string }>(
      '/api/almacen/ubicaciones/mover', {
        method: 'POST',
        body: JSON.stringify({ de, a, eliminarOrigen }),
      }),

  getPedidosAbiertos: () =>
    request<PedidoResumen[]>('/api/almacen/pedidos?estado=activos'),

  // Órdenes esperadas (MSSQL) — fuente real para recibir por cajas en el TC52
  getRecepcionesEsperadas: () =>
    request<RecepcionEsperada[]>('/api/recepcion/esperadas?estado=activos'),

  // Abre (o continúa) una recepción real ligada a un pedido. id=null = sin orden.
  abrirRecepcionReal: (recepcionEsperadaId: number | null, recibidoPor = 'TC52') =>
    request<AbrirRecepcionResponse>('/api/recepcion/reales/abrir', {
      method: 'POST',
      body: JSON.stringify({ recepcion_esperada_id: recepcionEsperadaId, recibido_por: recibidoPor }),
    }),

  // Agrega un renglón (caja) a la recepción real abierta. Convierte caja→pieza.
  agregarItemRecepcion: (recepcionRealId: number, item: ItemRecepcionInput) =>
    request<ItemRecepcionResponse>(`/api/recepcion/reales/${recepcionRealId}/items`, {
      method: 'POST',
      body: JSON.stringify(item),
    }),

  // ── Productos nuevos pendientes ──
  getPendientes: (q = '') =>
    request<ProductoPendiente[]>(`/api/almacen/productos-pendientes/buscar?q=${encodeURIComponent(q)}`),

  // Registra un producto nuevo que aún no existe en el catálogo (queda pendiente).
  crearPendiente: (p: {
    descripcion_proveedor: string; proveedor?: string | null; sku_proveedor?: string | null
    unidad?: string | null; piezas_por_caja?: number; cajas?: number
  }) =>
    request<{ ok: boolean; id: number; yaExistia?: boolean }>('/api/almacen/productos-pendientes', {
      method: 'POST',
      body: JSON.stringify({ ...p, origen: 'tc52' }),
    }),

  // Asigna el código de barras real a un pendiente al llegar a bodega.
  resolverPendiente: (id: number, codigo_barras: string, piezas_por_caja?: number) =>
    request<{ ok: boolean; codigo_barras: string; equivalencia: boolean }>(
      `/api/almacen/productos-pendientes/${id}/resolver`, {
        method: 'POST',
        body: JSON.stringify({ codigo_barras, piezas_por_caja }),
      }),
}
