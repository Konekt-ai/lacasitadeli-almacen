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
const PORT = process.env.PORT ?? 3002

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

const VISTA = '[compucaja].[dbo].[VArticulosUnificados]'
const INV   = '[compucaja].[dbo].[inventario_bodega]'
const MOV   = '[compucaja].[dbo].[movimientos_bodega]'
const UBIC  = '[compucaja].[dbo].[ubicaciones_bodega]'

let pool = null
async function getPool() {
  if (!pool) pool = await sql.connect(sqlConfig)
  return pool
}

// Lock en memoria — Node.js es single-thread, esto es atómico
const _opsEnCurso = new Map()
function adquirirLock(codigo, tipo) {
  const key = `${codigo}:${tipo}`
  if (_opsEnCurso.has(key)) return false
  _opsEnCurso.set(key, true)
  setTimeout(() => _opsEnCurso.delete(key), 5000)
  return true
}

async function getNombre(db, codigo) {
  const r = await db.request()
    .input('codigo', sql.NVarChar(50), codigo)
    .query(`
      SELECT TOP 1 Art_Descripcion AS nombre
      FROM ${VISTA}
      WHERE Art_GTIN = @codigo OR CodAlt_Codigo = @codigo
      ORDER BY Art_Codigo
    `)
  return r.recordset[0]?.nombre ?? null
}

async function getStock(db, codigo) {
  const r = await db.request()
    .input('codigo', sql.VarChar(50), codigo)
    .query(`SELECT ISNULL(cantidad, 0) AS stock FROM ${INV} WHERE codigo_barras = @codigo`)
  return r.recordset[0]?.stock ?? 0
}

async function getUbicacion(db, codigo) {
  const r = await db.request()
    .input('codigo', sql.VarChar(50), codigo)
    .query(`SELECT ubicacion FROM ${INV} WHERE codigo_barras = @codigo`)
  return r.recordset[0]?.ubicacion ?? null
}

// ── GET /api/almacen/producto/:codigo ─────────────────────────────────────────
app.get('/api/almacen/producto/:codigo', async (req, res) => {
  const { codigo } = req.params
  try {
    const db = await getPool()
    const nombre = await getNombre(db, codigo)
    if (!nombre) return res.status(404).json({ mensaje: 'Producto no encontrado' })
    const [stock, ubicacion] = await Promise.all([getStock(db, codigo), getUbicacion(db, codigo)])
    res.json({ codigo, nombre, stock, ubicacion })
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
    const nombre = await getNombre(db, codigo)
    if (!nombre) return res.status(404).json({ mensaje: 'Producto no encontrado' })

    if (!adquirirLock(codigo, 'entrada'))
      return res.json({ ok: true, stockActual: await getStock(db, codigo), mensaje: 'Entrada registrada' })

    const stockAntes   = await getStock(db, codigo)
    const stockDespues = stockAntes + cantidad

    const t = db.transaction()
    await t.begin()
    try {
      await t.request()
        .input('codigo',   sql.VarChar(50), codigo)
        .input('cantidad', sql.Int,         cantidad)
        .query(`
          MERGE ${INV} AS target
          USING (SELECT @codigo AS codigo_barras) AS source
            ON target.codigo_barras = source.codigo_barras
          WHEN MATCHED THEN
            UPDATE SET cantidad = target.cantidad + @cantidad, ultima_entrada = GETDATE()
          WHEN NOT MATCHED THEN
            INSERT (codigo_barras, cantidad, ultima_entrada) VALUES (@codigo, @cantidad, GETDATE());
        `)
      await t.request()
        .input('codigo',   sql.VarChar(50), codigo)
        .input('cantidad', sql.Int,         cantidad)
        .query(`INSERT INTO ${MOV} (codigo_barras, tipo, cantidad, fecha) VALUES (@codigo, 'entrada', @cantidad, GETDATE())`)
      await t.commit()
    } catch (err) { await t.rollback(); throw err }

    res.json({ ok: true, stockActual: stockDespues, mensaje: 'Entrada registrada' })
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
    const nombre = await getNombre(db, codigo)
    if (!nombre) return res.status(404).json({ mensaje: 'Producto no encontrado' })

    if (!adquirirLock(codigo, 'salida'))
      return res.json({ ok: true, stockActual: await getStock(db, codigo), mensaje: 'Salida registrada' })

    const stockAntes = await getStock(db, codigo)
    if (stockAntes < cantidad)
      return res.status(400).json({ mensaje: `Stock insuficiente. Disponible: ${stockAntes} pzas` })

    const stockDespues = stockAntes - cantidad

    const t = db.transaction()
    await t.begin()
    try {
      await t.request()
        .input('codigo',   sql.VarChar(50), codigo)
        .input('cantidad', sql.Int,         cantidad)
        .query(`UPDATE ${INV} SET cantidad = cantidad - @cantidad, ultima_salida = GETDATE() WHERE codigo_barras = @codigo`)
      await t.request()
        .input('codigo',   sql.VarChar(50), codigo)
        .input('cantidad', sql.Int,         cantidad)
        .query(`INSERT INTO ${MOV} (codigo_barras, tipo, cantidad, fecha) VALUES (@codigo, 'salida', @cantidad, GETDATE())`)
      await t.commit()
    } catch (err) { await t.rollback(); throw err }

    res.json({ ok: true, stockActual: stockDespues, mensaje: 'Salida registrada' })
  } catch (err) {
    console.error('salida:', err)
    res.status(500).json({ mensaje: err.message })
  }
})

// ── POST /api/almacen/merma ────────────────────────────────────────────────────
app.post('/api/almacen/merma', async (req, res) => {
  const { codigo, cantidad } = req.body
  if (!codigo || !cantidad || cantidad <= 0)
    return res.status(400).json({ mensaje: 'Datos inválidos' })
  try {
    const db = await getPool()
    const nombre = await getNombre(db, codigo)
    if (!nombre) return res.status(404).json({ mensaje: 'Producto no encontrado' })

    if (!adquirirLock(codigo, 'merma'))
      return res.json({ ok: true, stockActual: await getStock(db, codigo), mensaje: 'Merma registrada' })

    const stockAntes = await getStock(db, codigo)
    if (stockAntes < cantidad)
      return res.status(400).json({ mensaje: `Stock insuficiente. Disponible: ${stockAntes} pzas` })

    const t = db.transaction()
    await t.begin()
    try {
      await t.request()
        .input('codigo',   sql.VarChar(50), codigo)
        .input('cantidad', sql.Int,         cantidad)
        .query(`UPDATE ${INV} SET cantidad = cantidad - @cantidad, ultima_salida = GETDATE() WHERE codigo_barras = @codigo`)
      await t.request()
        .input('codigo',   sql.VarChar(50), codigo)
        .input('cantidad', sql.Int,         cantidad)
        .query(`INSERT INTO ${MOV} (codigo_barras, tipo, cantidad, fecha) VALUES (@codigo, 'salida', @cantidad, GETDATE())`)
      await t.commit()
    } catch (err) { await t.rollback(); throw err }

    res.json({ ok: true, stockActual: stockAntes - cantidad, mensaje: 'Merma registrada' })
  } catch (err) {
    console.error('merma:', err)
    res.status(500).json({ mensaje: err.message })
  }
})

// ── GET /api/almacen/movimientos ──────────────────────────────────────────────
app.get('/api/almacen/movimientos', async (_req, res) => {
  try {
    const db = await getPool()
    const result = await db.request().query(`
      SELECT
        m.id,
        m.codigo_barras                              AS codigo,
        ISNULL(v.Art_Descripcion, m.codigo_barras)   AS nombre,
        m.tipo,
        m.cantidad,
        0                                            AS stock_antes,
        0                                            AS stock_despues,
        ''                                           AS usuario,
        CONVERT(VARCHAR(23), m.fecha, 120)           AS fecha
      FROM ${MOV} m
      OUTER APPLY (
        SELECT TOP 1 Art_Descripcion
        FROM ${VISTA}
        WHERE Art_GTIN = m.codigo_barras OR CodAlt_Codigo = m.codigo_barras
      ) v
      WHERE CAST(m.fecha AS DATE) = CAST(GETDATE() AS DATE)
      ORDER BY m.fecha DESC
    `)
    res.json(result.recordset)
  } catch (err) {
    console.error('movimientos:', err)
    res.status(500).json({ mensaje: err.message })
  }
})

// ── GET /api/almacen/buscar?q=... ─────────────────────────────────────────────
app.get('/api/almacen/buscar', async (req, res) => {
  const q = (req.query.q ?? '').toString().trim()
  if (q.length < 2) return res.json([])
  try {
    const db = await getPool()
    const result = await db.request()
      .input('q', sql.NVarChar(100), `%${q}%`)
      .query(`
        SELECT TOP 15
          v.Art_GTIN        AS codigo,
          v.Art_Descripcion AS nombre,
          ISNULL(i.cantidad, 0) AS stock,
          i.ubicacion
        FROM ${VISTA} v
        LEFT JOIN ${INV} i ON i.codigo_barras = v.Art_GTIN
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

// ── POST /api/almacen/movimientos/:id/editar ──────────────────────────────────
app.post('/api/almacen/movimientos/:id/editar', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  const { nuevaCantidad } = req.body
  if (isNaN(id) || !nuevaCantidad || nuevaCantidad <= 0)
    return res.status(400).json({ mensaje: 'Datos inválidos' })
  try {
    const db = await getPool()
    const movResult = await db.request()
      .input('id', sql.Int, id)
      .query(`SELECT codigo_barras, tipo, cantidad FROM ${MOV} WHERE id = @id`)

    if (movResult.recordset.length === 0)
      return res.status(404).json({ mensaje: 'Movimiento no encontrado' })

    const { codigo_barras, tipo, cantidad: cantidadVieja } = movResult.recordset[0]
    const diferencia = nuevaCantidad - cantidadVieja
    if (diferencia === 0) return res.json({ ok: true, mensaje: 'Sin cambios' })

    const ajuste = tipo === 'entrada' ? diferencia : -diferencia

    if (ajuste < 0) {
      const stockRes = await db.request()
        .input('codigo', sql.VarChar(50), codigo_barras)
        .query(`SELECT ISNULL(cantidad, 0) AS stock FROM ${INV} WHERE codigo_barras = @codigo`)
      const stockActual = stockRes.recordset[0]?.stock ?? 0
      if (stockActual + ajuste < 0)
        return res.status(400).json({ mensaje: `El stock quedaría negativo (${stockActual + ajuste} pzas).` })
    }

    await db.request()
      .input('codigo', sql.VarChar(50), codigo_barras)
      .input('ajuste', sql.Int,         ajuste)
      .query(`UPDATE ${INV} SET cantidad = cantidad + @ajuste WHERE codigo_barras = @codigo`)

    await db.request()
      .input('id',            sql.Int, id)
      .input('nuevaCantidad', sql.Int, nuevaCantidad)
      .query(`UPDATE ${MOV} SET cantidad = @nuevaCantidad WHERE id = @id`)

    res.json({ ok: true, mensaje: 'Corregido correctamente' })
  } catch (err) {
    console.error('editar movimiento:', err)
    res.status(500).json({ mensaje: err.message })
  }
})

// ── GET /api/almacen/ubicaciones ──────────────────────────────────────────────
app.get('/api/almacen/ubicaciones', async (_req, res) => {
  try {
    const db = await getPool()
    const r = await db.request().query(
      `SELECT id, nombre, color FROM ${UBIC} WHERE activa = 1 ORDER BY orden, nombre`
    )
    res.json(r.recordset)
  } catch (err) {
    console.error('ubicaciones:', err)
    res.status(500).json({ mensaje: err.message })
  }
})

// ── POST /api/almacen/ubicaciones ─────────────────────────────────────────────
app.post('/api/almacen/ubicaciones', async (req, res) => {
  const { nombre, color } = req.body
  if (!nombre?.trim()) return res.status(400).json({ mensaje: 'Nombre requerido' })
  try {
    const db = await getPool()
    await db.request()
      .input('nombre', sql.VarChar(50), nombre.trim())
      .input('color',  sql.VarChar(7),  color || '#5F5E5A')
      .query(`INSERT INTO ${UBIC} (nombre, color) VALUES (@nombre, @color)`)
    const r = await db.request().query(
      `SELECT id, nombre, color FROM ${UBIC} WHERE activa = 1 ORDER BY orden, nombre`
    )
    res.json(r.recordset)
  } catch (err) {
    console.error('crear ubicacion:', err)
    res.status(500).json({ mensaje: err.message })
  }
})

// ── DELETE /api/almacen/ubicaciones/:id ───────────────────────────────────────
app.delete('/api/almacen/ubicaciones/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) return res.status(400).json({ mensaje: 'ID inválido' })
  try {
    const db = await getPool()
    await db.request()
      .input('id', sql.Int, id)
      .query(`UPDATE ${UBIC} SET activa = 0 WHERE id = @id`)
    const r = await db.request().query(
      `SELECT id, nombre, color FROM ${UBIC} WHERE activa = 1 ORDER BY orden, nombre`
    )
    res.json(r.recordset)
  } catch (err) {
    console.error('eliminar ubicacion:', err)
    res.status(500).json({ mensaje: err.message })
  }
})

// ── POST /api/almacen/producto-ubicacion ──────────────────────────────────────
app.post('/api/almacen/producto-ubicacion', async (req, res) => {
  const { codigo, ubicacion } = req.body
  if (!codigo) return res.status(400).json({ mensaje: 'Código requerido' })
  try {
    const db = await getPool()
    // Si aún no hay fila en inventario_bodega, creamos una con stock 0
    await db.request()
      .input('codigo',    sql.VarChar(50), codigo)
      .input('ubicacion', sql.VarChar(50), ubicacion || null)
      .query(`
        MERGE ${INV} AS target
        USING (SELECT @codigo AS codigo_barras) AS source
          ON target.codigo_barras = source.codigo_barras
        WHEN MATCHED THEN
          UPDATE SET ubicacion = @ubicacion
        WHEN NOT MATCHED THEN
          INSERT (codigo_barras, cantidad, ubicacion) VALUES (@codigo, 0, @ubicacion);
      `)
    res.json({ ok: true })
  } catch (err) {
    console.error('producto-ubicacion:', err)
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
