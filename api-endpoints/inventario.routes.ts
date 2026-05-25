// routes/inventario.ts
// Pega este archivo en tu API existente (:3002)
// Requiere: npm install mssql
// npm install -D @types/mssql

import { Router, Request, Response } from 'express'
import sql from 'mssql'

const router = Router()

// ── Configuración SQL Server ──────────────────────────────────────────────────
// Mueve esto a un archivo de config o variables de entorno
const sqlConfig: sql.config = {
  server: process.env.DB_SERVER ?? 'localhost',
  database: process.env.DB_NAME ?? 'TuBaseDeDatos',
  user: process.env.DB_USER ?? 'sa',
  password: process.env.DB_PASS ?? 'tu_password',
  options: {
    encrypt: false,           // false para SQL Server local
    trustServerCertificate: true,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
}

// Pool de conexiones (se reutiliza en toda la app)
let pool: sql.ConnectionPool | null = null

async function getPool(): Promise<sql.ConnectionPool> {
  if (!pool) pool = await sql.connect(sqlConfig)
  return pool
}

// ── GET /producto/:codigo ─────────────────────────────────────────────────────
// Busca en la tabla de artículos de Nova Caja + stock propio
router.get('/producto/:codigo', async (req: Request, res: Response) => {
  const { codigo } = req.params
  try {
    const db = await getPool()

    // Ajusta 'articulos' y los nombres de columnas a los de tu BD de Nova Caja
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

    if (result.recordset.length === 0) {
      return res.status(404).json({ mensaje: 'Producto no encontrado' })
    }

    res.json(result.recordset[0])
  } catch (err) {
    console.error('Error getProducto:', err)
    res.status(500).json({ mensaje: 'Error al consultar producto' })
  }
})

// ── POST /inventario/entrada ──────────────────────────────────────────────────
// Suma cantidad al stock (recepción de trailer)
router.post('/inventario/entrada', async (req: Request, res: Response) => {
  const { codigo, cantidad } = req.body as { codigo: string; cantidad: number }

  if (!codigo || !cantidad || cantidad <= 0) {
    return res.status(400).json({ mensaje: 'Datos inválidos' })
  }

  try {
    const db = await getPool()
    const t = db.transaction()
    await t.begin()

    try {
      // Upsert: si ya existe el registro de inventario lo actualiza, si no lo crea
      await t.request()
        .input('codigo', sql.VarChar(50), codigo)
        .input('cantidad', sql.Int, cantidad)
        .query(`
          MERGE inventario_bodega AS target
          USING (SELECT @codigo AS codigo_barras) AS source
            ON target.codigo_barras = source.codigo_barras
          WHEN MATCHED THEN
            UPDATE SET cantidad = target.cantidad + @cantidad,
                       ultima_entrada = GETDATE()
          WHEN NOT MATCHED THEN
            INSERT (codigo_barras, cantidad, ultima_entrada)
            VALUES (@codigo, @cantidad, GETDATE());
        `)

      // Registrar movimiento en historial
      await t.request()
        .input('codigo', sql.VarChar(50), codigo)
        .input('cantidad', sql.Int, cantidad)
        .query(`
          INSERT INTO movimientos_bodega (codigo_barras, tipo, cantidad, fecha)
          VALUES (@codigo, 'entrada', @cantidad, GETDATE())
        `)

      await t.commit()

      // Regresar stock actualizado
      const stockResult = await db.request()
        .input('codigo', sql.VarChar(50), codigo)
        .query(`SELECT ISNULL(cantidad, 0) AS stock FROM inventario_bodega WHERE codigo_barras = @codigo`)

      const stockActual = stockResult.recordset[0]?.stock ?? cantidad

      res.json({ ok: true, stockActual, mensaje: 'Entrada registrada' })
    } catch (err) {
      await t.rollback()
      throw err
    }
  } catch (err) {
    console.error('Error entrada:', err)
    res.status(500).json({ mensaje: 'Error al registrar entrada' })
  }
})

// ── POST /inventario/salida ───────────────────────────────────────────────────
// Resta cantidad del stock (salida de bodega)
router.post('/inventario/salida', async (req: Request, res: Response) => {
  const { codigo, cantidad } = req.body as { codigo: string; cantidad: number }

  if (!codigo || !cantidad || cantidad <= 0) {
    return res.status(400).json({ mensaje: 'Datos inválidos' })
  }

  try {
    const db = await getPool()

    // Verificar stock suficiente
    const stockResult = await db.request()
      .input('codigo', sql.VarChar(50), codigo)
      .query(`SELECT ISNULL(cantidad, 0) AS stock FROM inventario_bodega WHERE codigo_barras = @codigo`)

    const stockActual = stockResult.recordset[0]?.stock ?? 0
    if (stockActual < cantidad) {
      return res.status(400).json({
        mensaje: `Stock insuficiente. Disponible: ${stockActual} pzas`
      })
    }

    const t = db.transaction()
    await t.begin()

    try {
      await t.request()
        .input('codigo', sql.VarChar(50), codigo)
        .input('cantidad', sql.Int, cantidad)
        .query(`
          UPDATE inventario_bodega
          SET cantidad = cantidad - @cantidad,
              ultima_salida = GETDATE()
          WHERE codigo_barras = @codigo
        `)

      await t.request()
        .input('codigo', sql.VarChar(50), codigo)
        .input('cantidad', sql.Int, cantidad)
        .query(`
          INSERT INTO movimientos_bodega (codigo_barras, tipo, cantidad, fecha)
          VALUES (@codigo, 'salida', @cantidad, GETDATE())
        `)

      await t.commit()

      const nuevoStock = stockActual - cantidad
      res.json({ ok: true, stockActual: nuevoStock, mensaje: 'Salida registrada' })
    } catch (err) {
      await t.rollback()
      throw err
    }
  } catch (err) {
    console.error('Error salida:', err)
    res.status(500).json({ mensaje: 'Error al registrar salida' })
  }
})

// ── GET /inventario/movimientos ───────────────────────────────────────────────
// Historial del día actual
router.get('/inventario/movimientos', async (_req: Request, res: Response) => {
  try {
    const db = await getPool()
    const result = await db.request().query(`
      SELECT
        m.id,
        m.codigo_barras  AS codigo,
        a.descripcion    AS nombre,
        m.tipo,
        m.cantidad,
        m.fecha
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

export default router
