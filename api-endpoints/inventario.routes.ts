import { Router, Request, Response } from 'express'
import sql from 'mssql'

const router = Router()

const sqlConfig: sql.config = {
  server: process.env.DB_SERVER ?? 'localhost',
  database: process.env.DB_NAME ?? 'TuBaseDeDatos',
  user: process.env.DB_USER ?? 'sa',
  password: process.env.DB_PASS ?? 'tu_password',
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
}

let pool: sql.ConnectionPool | null = null
async function getPool(): Promise<sql.ConnectionPool> {
  if (!pool) pool = await sql.connect(sqlConfig)
  return pool
}

router.get('/api/almacen/producto/:codigo', async (req: Request, res: Response) => {
  const { codigo } = req.params
  try {
    const db = await getPool()
    const result = await db.request()
      .input('codigo', sql.VarChar(50), codigo)
      .query(`
        SELECT
          a.codigo_barras   AS codigo,
          a.descripcion     AS nombre,
          ISNULL(i.cantidad, 0) AS stock
        FROM articulos a
        LEFT JOIN inventario_bodega i ON i.codigo_barras = a.codigo_barras
        WHERE a.codigo_barras = @codigo
      `)

    if (result.recordset.length === 0) return res.status(404).json({ mensaje: 'Producto no encontrado' })
    res.json(result.recordset[0])
  } catch (err) {
    console.error('Error getProducto:', err)
    res.status(500).json({ mensaje: 'Error al consultar producto' })
  }
})

router.post('/api/almacen/entrada', async (req: Request, res: Response) => {
  const { codigo, cantidad } = req.body as { codigo: string; cantidad: number }
  if (!codigo || !cantidad || cantidad <= 0) return res.status(400).json({ mensaje: 'Datos inválidos' })

  try {
    const db = await getPool()
    const t = db.transaction()
    await t.begin()
    try {
      await t.request()
        .input('codigo', sql.VarChar(50), codigo)
        .input('cantidad', sql.Int, cantidad)
        .query(`
          MERGE inventario_bodega AS target
          USING (SELECT @codigo AS codigo_barras) AS source
            ON target.codigo_barras = source.codigo_barras
          WHEN MATCHED THEN
            UPDATE SET cantidad = target.cantidad + @cantidad, ultima_entrada = GETDATE()
          WHEN NOT MATCHED THEN
            INSERT (codigo_barras, cantidad, ultima_entrada) VALUES (@codigo, @cantidad, GETDATE());
        `)

      await t.request()
        .input('codigo', sql.VarChar(50), codigo)
        .input('cantidad', sql.Int, cantidad)
        .query(`
          INSERT INTO movimientos_bodega (codigo_barras, tipo, cantidad, fecha)
          VALUES (@codigo, 'entrada', @cantidad, GETDATE())
        `)

      await t.commit()
      const stockRes = await db.request().input('codigo', sql.VarChar(50), codigo)
        .query(`SELECT ISNULL(cantidad, 0) AS stock FROM inventario_bodega WHERE codigo_barras = @codigo`)
      
      res.json({ ok: true, stockActual: stockRes.recordset[0]?.stock ?? cantidad, mensaje: 'Entrada registrada' })
    } catch (err) { await t.rollback(); throw err }
  } catch (err) {
    console.error('Error entrada:', err)
    res.status(500).json({ mensaje: 'Error al registrar entrada' })
  }
})

router.post('/api/almacen/salida', async (req: Request, res: Response) => {
  const { codigo, cantidad } = req.body as { codigo: string; cantidad: number }
  if (!codigo || !cantidad || cantidad <= 0) return res.status(400).json({ mensaje: 'Datos inválidos' })

  try {
    const db = await getPool()
    const stockRes = await db.request().input('codigo', sql.VarChar(50), codigo)
      .query(`SELECT ISNULL(cantidad, 0) AS stock FROM inventario_bodega WHERE codigo_barras = @codigo`)

    const stockActual = stockRes.recordset[0]?.stock ?? 0
    if (stockActual < cantidad) return res.status(400).json({ mensaje: `Stock insuficiente. Disponible: ${stockActual} pzas` })

    const t = db.transaction()
    await t.begin()
    try {
      await t.request()
        .input('codigo', sql.VarChar(50), codigo)
        .input('cantidad', sql.Int, cantidad)
        .query(`UPDATE inventario_bodega SET cantidad = cantidad - @cantidad, ultima_salida = GETDATE() WHERE codigo_barras = @codigo`)

      await t.request()
        .input('codigo', sql.VarChar(50), codigo)
        .input('cantidad', sql.Int, cantidad)
        .query(`INSERT INTO movimientos_bodega (codigo_barras, tipo, cantidad, fecha) VALUES (@codigo, 'salida', @cantidad, GETDATE())`)

      await t.commit()
      res.json({ ok: true, stockActual: stockActual - cantidad, mensaje: 'Salida registrada' })
    } catch (err) { await t.rollback(); throw err }
  } catch (err) {
    console.error('Error salida:', err)
    res.status(500).json({ mensaje: 'Error al registrar salida' })
  }
})

router.get('/api/almacen/movimientos', async (_req: Request, res: Response) => {
  try {
    const db = await getPool()
    const result = await db.request().query(`
      SELECT m.id, m.codigo_barras AS codigo, a.descripcion AS nombre, m.tipo, m.cantidad, m.fecha
      FROM movimientos_bodega m
      LEFT JOIN articulos a ON a.codigo_barras = m.codigo_barras
      WHERE CAST(m.fecha AS DATE) = CAST(GETDATE() AS DATE)
      ORDER BY m.fecha DESC
    `)
    res.json(result.recordset)
  } catch (err) {
    console.error('Error movimientos:', err)
    res.status(500).json({ mensaje: 'Error al obtener movimientos' })
  }
})

// ── POST para EDITAR (Corregido para evadir el error 207 de SQL Server) ────────────
router.post('/api/almacen/movimientos/:id/editar', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10)
  const { nuevaCantidad } = req.body as { nuevaCantidad: number }

  if (isNaN(id) || !nuevaCantidad || nuevaCantidad <= 0) {
    return res.status(400).json({ mensaje: 'Datos inválidos para editar' })
  }

  try {
    const db = await getPool()

    const movResult = await db.request().input('id', sql.Int, id)
      .query(`SELECT codigo_barras, tipo, cantidad FROM movimientos_bodega WHERE id = @id`)

    if (movResult.recordset.length === 0) {
      return res.status(404).json({ mensaje: 'Movimiento no encontrado' })
    }

    const { codigo_barras, tipo, cantidad: cantidadVieja } = movResult.recordset[0]
    const diferencia = nuevaCantidad - cantidadVieja

    if (diferencia !== 0) {
      const ajusteStock = tipo === 'entrada' ? diferencia : -diferencia

      if (ajusteStock < 0) {
        const stockResult = await db.request().input('codigo', sql.VarChar(50), codigo_barras)
          .query(`SELECT ISNULL(cantidad, 0) AS stock FROM inventario_bodega WHERE codigo_barras = @codigo`)
        
        const stockActual = stockResult.recordset[0]?.stock ?? 0
        if (stockActual + ajusteStock < 0) {
          return res.status(400).json({ mensaje: `Ajuste inválido. El stock quedaría en negativo (${stockActual + ajusteStock}).` })
        }
      }

      // 🔴 AQUÍ ESTÁ LA MAGIA: Pasamos el número directo a SQL en lugar de usar la arroba
      await db.request()
        .input('codigo', sql.VarChar(50), codigo_barras)
        .query(`UPDATE inventario_bodega SET cantidad = cantidad + (${ajusteStock}) WHERE codigo_barras = @codigo`)

      // Igual aquí para la nueva cantidad
      await db.request()
        .input('id', sql.Int, id)
        // Seguramente la tienes así:
        .query(`UPDATE movimintos_bodega SET cantidad = ${nuevaCantidad} WHERE id = @id`)
    }

    res.json({ ok: true, mensaje: 'Corregido correctamente' })
  } catch (err) {
    console.error('------- ERROR EN EDITAR MOVIMIENTO -------')
    console.error(err)
    const mensajeReal = err instanceof Error ? err.message : 'Error desconocido en SQL'
    res.status(500).json({ mensaje: `Error BD: ${mensajeReal}` })
  }
})

export default router