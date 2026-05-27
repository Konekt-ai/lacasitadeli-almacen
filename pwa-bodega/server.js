import 'dotenv/config'
import express from 'express'
import sql from 'mssql'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { networkInterfaces } from 'os'

function getLocalIP() {
  for (const iface of Object.values(networkInterfaces())) {
    for (const addr of iface ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address
    }
  }
  return 'localhost'
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT ?? 3003

const app = express()
app.use(express.json())

const sqlConfig = {
  server:   process.env.MSSQL_SERVER   ?? 'localhost',
  database: process.env.MSSQL_DATABASE ?? 'compucaja',
  user:     process.env.MSSQL_USER     ?? 'sa',
  password: process.env.MSSQL_PASSWORD ?? 'compucaja',
  port:     parseInt(process.env.MSSQL_PORT ?? '1433'),
  options:  { encrypt: false, trustServerCertificate: true },
  pool:     { max: 10, min: 0, idleTimeoutMillis: 30000 },
}

const VISTA    = '[compucaja].[dbo].[VArticulosUnificados]'
const COMPUEJE = '[compucaja].[dbo].[Compueje]'

// Ajusta estos valores según tu configuración de Nova Caja
const ALM_BODEGA  = parseInt(process.env.ALM_CODIGO  ?? '1')
const TMA_ENTRADA = parseInt(process.env.TMA_ENTRADA ?? '7')
const TMA_SALIDA  = parseInt(process.env.TMA_SALIDA  ?? '7')
const FOL_TDA     = parseInt(process.env.FOL_TDA     ?? '1')
const FOL_EST     = parseInt(process.env.FOL_EST     ?? '7')   // Est_Codigo real en Folios
const FOL_DOC     = parseInt(process.env.FOL_DOC     ?? '1')   // Doc_Codigo real en Folios

let pool = null
async function getPool() {
  if (!pool) pool = await sql.connect(sqlConfig)
  return pool
}

// ── helpers ───────────────────────────────────────────────────────────────────

// Devuelve { Art_Codigo, nombre } buscando por código de barras
async function getArticulo(db, codigo) {
  const r = await db.request()
    .input('codigo', sql.NVarChar(50), codigo)
    .query(`
      SELECT TOP 1 Art_Codigo, Art_Descripcion AS nombre
      FROM ${VISTA}
      WHERE Art_GTIN = @codigo OR CodAlt_Codigo = @codigo
    `)
  return r.recordset[0] ?? null
}

// Stock actual = CE_ExistenciaU del movimiento más reciente del artículo
async function getStock(db, artCodigo) {
  const r = await db.request()
    .input('artCodigo', sql.NVarChar(50), String(artCodigo))
    .input('alm', sql.BigInt, ALM_BODEGA)
    .query(`
      SELECT TOP 1 CE_ExistenciaU AS stock
      FROM ${COMPUEJE}
      WHERE Art_Codigo = @artCodigo AND Alm_Codigo = @alm
      ORDER BY CE_Fecha DESC, FolConsecutivo DESC, CE_ColConsecutivo DESC
    `)
  return Math.max(0, Math.floor(r.recordset[0]?.stock ?? 0))
}

// Inserta una fila en Folios + Compueje dentro de una transacción.
// cantidad positiva = entrada, negativa = salida.
async function insertarMovimiento(db, artCodigo, cantidad, nuevoStock, tma) {
  const t = db.transaction()
  await t.begin()
  try {
    // Siguiente consecutivo en Folios para este namespace (con bloqueo para evitar duplicados)
    const fr = await t.request()
      .input('foltda', sql.BigInt, FOL_TDA)
      .input('folest', sql.BigInt, FOL_EST)
      .input('foldoc', sql.BigInt, FOL_DOC)
      .query(`
        SELECT ISNULL(MAX(Consecutivo), 0) + 1 AS nextFolio
        FROM [compucaja].[dbo].[Folios] WITH (UPDLOCK, HOLDLOCK)
        WHERE Tda_Codigo = @foltda AND Est_Codigo = @folest AND Doc_Codigo = @foldoc
      `)
    const folio = fr.recordset[0].nextFolio

    // 1) Insertar folio (requerido por FK_Compueje_Folios)
    await t.request()
      .input('foltda', sql.BigInt, FOL_TDA)
      .input('folest', sql.BigInt, FOL_EST)
      .input('foldoc', sql.BigInt, FOL_DOC)
      .input('folio',  sql.BigInt, folio)
      .query(`
        INSERT INTO [compucaja].[dbo].[Folios] (Tda_Codigo, Est_Codigo, Doc_Codigo, Consecutivo)
        VALUES (@foltda, @folest, @foldoc, @folio)
      `)

    // 2) Insertar movimiento en Compueje
    await t.request()
      .input('artCodigo',  sql.NVarChar(50),   String(artCodigo))
      .input('cantidad',   sql.Decimal(18, 4), cantidad)
      .input('existencia', sql.Decimal(18, 4), nuevoStock)
      .input('folio',      sql.BigInt,          folio)
      .input('tma',        sql.BigInt,          tma)
      .input('alm',        sql.BigInt,          ALM_BODEGA)
      .input('foltda',     sql.BigInt,          FOL_TDA)
      .input('folest',     sql.BigInt,          FOL_EST)
      .input('foldoc',     sql.BigInt,          FOL_DOC)
      .query(`
        INSERT INTO ${COMPUEJE}
          (FolTda_Codigo, FolEst_Codigo, FolDoc_Codigo, FolConsecutivo, CE_ColConsecutivo,
           Art_Codigo, Alm_Codigo, TMA_Codigo, CE_Cantidad, CE_ExistenciaU,
           CE_Importe, CE_CostoUnitario, CE_Fecha, CE_Compensado, AlmTda_Codigo,
           CE_PorConsolidar, CE_Referencia1, CE_Referencia2, CE_Observaciones)
        VALUES
          (@foltda, @folest, @foldoc, @folio, 1,
           @artCodigo, @alm, @tma, @cantidad, @existencia,
           0, 0, GETDATE(), 0, @alm,
           0, '', '', 'Bodega')
      `)

    await t.commit()
  } catch (err) {
    await t.rollback()
    throw err
  }
}

// ── GET /api/almacen/producto/:codigo ─────────────────────────────────────────
app.get('/api/almacen/producto/:codigo', async (req, res) => {
  const { codigo } = req.params
  try {
    const db = await getPool()
    const art = await getArticulo(db, codigo)
    if (!art) return res.status(404).json({ mensaje: 'Producto no encontrado' })
    const stock = await getStock(db, art.Art_Codigo)
    res.json({ codigo, nombre: art.nombre, stock })
  } catch (err) {
    console.error('getProducto:', err)
    res.status(500).json({ mensaje: err.message })
  }
})

// ── POST /api/almacen/entrada ──────────────────────────────────────────────────
app.post('/api/almacen/entrada', async (req, res) => {
  const { codigo, cantidad } = req.body
  if (!codigo || !cantidad || cantidad <= 0)
    return res.status(400).json({ mensaje: 'Datos inválidos' })
  try {
    const db = await getPool()
    const art = await getArticulo(db, codigo)
    if (!art) return res.status(404).json({ mensaje: 'Producto no encontrado' })

    const stockActual = await getStock(db, art.Art_Codigo)
    const nuevoStock  = stockActual + cantidad

    await insertarMovimiento(db, art.Art_Codigo, cantidad, nuevoStock, TMA_ENTRADA)
    res.json({ ok: true, stockActual: nuevoStock, mensaje: 'Entrada registrada' })
  } catch (err) {
    console.error('entrada:', err)
    res.status(500).json({ mensaje: err.message })
  }
})

// ── POST /api/almacen/salida ───────────────────────────────────────────────────
app.post('/api/almacen/salida', async (req, res) => {
  const { codigo, cantidad } = req.body
  if (!codigo || !cantidad || cantidad <= 0)
    return res.status(400).json({ mensaje: 'Datos inválidos' })
  try {
    const db = await getPool()
    const art = await getArticulo(db, codigo)
    if (!art) return res.status(404).json({ mensaje: 'Producto no encontrado' })

    const stockActual = await getStock(db, art.Art_Codigo)
    if (stockActual < cantidad)
      return res.status(400).json({ mensaje: `Stock insuficiente. Disponible: ${stockActual} pzas` })

    const nuevoStock = stockActual - cantidad
    // CE_Cantidad negativa identifica salidas en Compueje
    await insertarMovimiento(db, art.Art_Codigo, -cantidad, nuevoStock, TMA_SALIDA)
    res.json({ ok: true, stockActual: nuevoStock, mensaje: 'Salida registrada' })
  } catch (err) {
    console.error('salida:', err)
    res.status(500).json({ mensaje: err.message })
  }
})

// ── GET /api/almacen/movimientos ──────────────────────────────────────────────
app.get('/api/almacen/movimientos', async (_req, res) => {
  try {
    const db = await getPool()
    const result = await db.request()
      .input('alm', sql.BigInt, ALM_BODEGA)
      .query(`
        SELECT
          c.FolConsecutivo                              AS id,
          ISNULL(v.Art_GTIN, CAST(c.Art_Codigo AS NVARCHAR(50))) AS codigo,
          v.Art_Descripcion                             AS nombre,
          CASE WHEN c.CE_Cantidad >= 0 THEN 'entrada' ELSE 'salida' END AS tipo,
          ABS(c.CE_Cantidad)                            AS cantidad,
          c.CE_Fecha                                    AS fecha
        FROM ${COMPUEJE} c
        OUTER APPLY (
          SELECT TOP 1 Art_Descripcion, Art_GTIN
          FROM ${VISTA}
          WHERE Art_Codigo = c.Art_Codigo
        ) v
        WHERE CAST(c.CE_Fecha AS DATE) = CAST(GETDATE() AS DATE)
          AND c.Alm_Codigo        = @alm
          AND c.CE_Observaciones  = 'Bodega'
        ORDER BY c.CE_Fecha DESC
      `)
    res.json(result.recordset)
  } catch (err) {
    console.error('movimientos:', err)
    res.status(500).json({ mensaje: err.message })
  }
})

// ── GET /buscar?q=... ──────────────────────────────────────────────────────────
app.get('/buscar', async (req, res) => {
  const q = (req.query.q ?? '').toString().trim()
  if (q.length < 2) return res.json([])
  try {
    const db = await getPool()
    const result = await db.request()
      .input('q',   sql.NVarChar(100), `%${q}%`)
      .input('alm', sql.BigInt,         ALM_BODEGA)
      .query(`
        SELECT TOP 15
          v.Art_GTIN        AS codigo,
          v.Art_Descripcion AS nombre,
          ISNULL((
            SELECT TOP 1 CE_ExistenciaU
            FROM ${COMPUEJE}
            WHERE Art_Codigo = v.Art_Codigo AND Alm_Codigo = @alm
            ORDER BY CE_Fecha DESC, FolConsecutivo DESC
          ), 0) AS stock
        FROM ${VISTA} v
        WHERE v.Art_Descripcion LIKE @q
           OR v.Art_GTIN        LIKE @q
           OR v.CodAlt_Codigo   LIKE @q
        ORDER BY v.Art_Descripcion
      `)
    res.json(result.recordset)
  } catch (err) {
    console.error('buscar:', err)
    res.status(500).json({ mensaje: err.message })
  }
})

// ── GET /api/almacen/diagnostico — muestra estructura de Folios ───────────────
app.get('/api/almacen/diagnostico', async (_req, res) => {
  try {
    const db = await getPool()
    const cols = await db.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'Folios'
      ORDER BY ORDINAL_POSITION
    `)
    const sample = await db.request().query(`SELECT TOP 3 * FROM [compucaja].[dbo].[Folios]`)
    res.json({ columnas: cols.recordset, muestra: sample.recordset })
  } catch (err) {
    res.status(500).json({ mensaje: err.message })
  }
})

// ── Frontend estático ─────────────────────────────────────────────────────────
app.use(express.static(join(__dirname, 'dist')))
app.get('*', (_req, res) => res.sendFile(join(__dirname, 'dist', 'index.html')))

app.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIP()
  console.log(`\n Bodega TC52 listo!`)
  console.log(` Abre en el TC52: http://${ip}:${PORT}\n`)
})
