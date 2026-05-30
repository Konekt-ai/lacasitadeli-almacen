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
let migrated = false

async function getPool() {
  if (!pool) pool = await sql.connect(sqlConfig)
  return pool
}

// ── Auto-migración al arrancar ────────────────────────────────────────────────
// Ejecuta cada bloque por separado y tolera errores (idempotente)
async function autoMigrate(db) {
  if (migrated) return
  const run = async (sql_text) => {
    try { await db.request().query(sql_text) } catch {}
  }

  // 1. Crear inventario_bodega si no existe
  await run(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='inventario_bodega' AND xtype='U')
    CREATE TABLE inventario_bodega (
      id            INT           IDENTITY(1,1) PRIMARY KEY,
      codigo_barras VARCHAR(50)   NOT NULL,
      ubicacion     VARCHAR(50)   NOT NULL DEFAULT 'Bodega',
      cantidad      INT           NOT NULL DEFAULT 0,
      ultima_entrada DATETIME     NULL,
      ultima_salida  DATETIME     NULL,
      creado        DATETIME      NOT NULL DEFAULT GETDATE()
    )`)

  // 2. Crear movimientos_bodega si no existe
  await run(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='movimientos_bodega' AND xtype='U')
    CREATE TABLE movimientos_bodega (
      id            INT           IDENTITY(1,1) PRIMARY KEY,
      codigo_barras VARCHAR(50)   NOT NULL,
      tipo          VARCHAR(10)   NOT NULL,
      cantidad      INT           NOT NULL,
      ubicacion     VARCHAR(50)   NULL,
      stock_antes   INT           NULL,
      stock_despues INT           NULL,
      motivo        VARCHAR(30)   NULL,
      area          VARCHAR(30)   NULL,
      notas         VARCHAR(200)  NULL,
      fecha         DATETIME      NOT NULL DEFAULT GETDATE()
    )`)

  // 3. Agregar columna ubicacion a inventario_bodega si no existe
  await run(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id=OBJECT_ID('inventario_bodega') AND name='ubicacion')
      ALTER TABLE inventario_bodega ADD ubicacion VARCHAR(50) NULL`)

  // 4. Agregar columna ubicacion a movimientos_bodega si no existe
  await run(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id=OBJECT_ID('movimientos_bodega') AND name='ubicacion')
      ALTER TABLE movimientos_bodega ADD ubicacion VARCHAR(50) NULL`)

  // 5. Crear ubicaciones_bodega si no existe e insertar ubicaciones
  await run(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='ubicaciones_bodega' AND xtype='U')
    BEGIN
      CREATE TABLE ubicaciones_bodega (
        id     INT          IDENTITY(1,1) PRIMARY KEY,
        nombre VARCHAR(50)  NOT NULL UNIQUE,
        color  VARCHAR(7)   NOT NULL DEFAULT '#5F5E5A',
        activa BIT          NOT NULL DEFAULT 1,
        orden  INT          NOT NULL DEFAULT 99
      )
      INSERT INTO ubicaciones_bodega (nombre,color,orden) VALUES
        ('Bodega','#1D9E75',1),('Casita 1','#3B82F6',2),
        ('Casita 2','#8B5CF6',3),('USA','#F59E0B',4),
        ('Cocina','#E07B39',5),('Refrigerador','#06B6D4',6)
    END`)

  // 6. Asegurar que las ubicaciones correctas existen
  const ubics = [
    ['Bodega','#1D9E75',1],['Casita 1','#3B82F6',2],['Casita 2','#8B5CF6',3],
    ['USA','#F59E0B',4],['Cocina','#E07B39',5],['Refrigerador','#06B6D4',6]
  ]
  for (const [nombre,color,orden] of ubics) {
    await run(`
      IF NOT EXISTS (SELECT 1 FROM ubicaciones_bodega WHERE nombre='${nombre}')
        INSERT INTO ubicaciones_bodega (nombre,color,orden) VALUES ('${nombre}','${color}',${orden})`)
  }
  // Renombrar ubicaciones viejas
  await run(`UPDATE ubicaciones_bodega SET nombre='Casita 1',color='#3B82F6',orden=2 WHERE nombre='Tienda Casita 1'`)
  await run(`UPDATE ubicaciones_bodega SET nombre='Casita 2',color='#8B5CF6',orden=3 WHERE nombre='Tienda Casita 2'`)
  await run(`UPDATE ubicaciones_bodega SET nombre='USA',color='#F59E0B',orden=4 WHERE nombre='Otro'`)

  // 7. CONSOLIDAR: filas con ubicacion NULL → 'Bodega'
  //    Primero: sumar las cantidades NULL al registro 'Bodega' si ya existe
  await run(`
    UPDATE b
    SET b.cantidad = b.cantidad + n.cantidad,
        b.ultima_entrada = ISNULL(b.ultima_entrada, n.ultima_entrada)
    FROM inventario_bodega b
    JOIN inventario_bodega n
      ON n.codigo_barras = b.codigo_barras
     AND (n.ubicacion IS NULL OR n.ubicacion = '' OR n.ubicacion = 'Sin ubicar')
     AND b.ubicacion = 'Bodega'`)

  //    Eliminar las filas NULL que ya fueron sumadas (donde existe 'Bodega')
  await run(`
    DELETE n
    FROM inventario_bodega n
    WHERE (n.ubicacion IS NULL OR n.ubicacion = '' OR n.ubicacion = 'Sin ubicar')
      AND EXISTS (
        SELECT 1 FROM inventario_bodega b
        WHERE b.codigo_barras = n.codigo_barras AND b.ubicacion = 'Bodega'
      )`)

  //    Renombrar las que quedaron sin 'Bodega' → asignarlas a 'Bodega'
  await run(`
    UPDATE inventario_bodega
    SET ubicacion = 'Bodega'
    WHERE ubicacion IS NULL OR ubicacion = '' OR ubicacion = 'Sin ubicar'`)

  // 8. Agregar UNIQUE compuesto (codigo_barras, ubicacion) si no existe
  await run(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('inventario_bodega') AND name='UQ_inv_codigo_ubicacion')
    BEGIN
      -- Eliminar el único antiguo en solo codigo_barras si existe
      DECLARE @uq NVARCHAR(255)
      SELECT @uq = i.name FROM sys.indexes i
        JOIN sys.index_columns ic ON i.object_id=ic.object_id AND i.index_id=ic.index_id
        JOIN sys.columns c ON ic.object_id=c.object_id AND ic.column_id=c.column_id
      WHERE i.object_id=OBJECT_ID('inventario_bodega')
        AND i.is_unique=1 AND i.is_primary_key=0 AND c.name='codigo_barras'
      GROUP BY i.name HAVING COUNT(*)=1
      IF @uq IS NOT NULL EXEC('ALTER TABLE inventario_bodega DROP CONSTRAINT '+@uq)
      ALTER TABLE inventario_bodega ADD CONSTRAINT UQ_inv_codigo_ubicacion UNIQUE (codigo_barras,ubicacion)
    END`)

  migrated = true
  console.log(' Migración automática completada')
}

// ── Helpers ───────────────────────────────────────────────────────────────────
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
    .query(`SELECT TOP 1 Art_Descripcion AS nombre FROM ${VISTA}
            WHERE Art_GTIN=@codigo OR CodAlt_Codigo=@codigo ORDER BY Art_Codigo`)
  return r.recordset[0]?.nombre ?? null
}

async function getStock(db, codigo) {
  const r = await db.request()
    .input('codigo', sql.VarChar(50), codigo)
    .query(`SELECT ISNULL(SUM(cantidad),0) AS stock FROM ${INV} WHERE codigo_barras=@codigo`)
  return r.recordset[0]?.stock ?? 0
}

async function getStockEnUbic(db, codigo, ubicacion) {
  const r = await db.request()
    .input('codigo',    sql.VarChar(50), codigo)
    .input('ubicacion', sql.VarChar(50), ubicacion)
    .query(`SELECT ISNULL(SUM(cantidad),0) AS stock FROM ${INV}
            WHERE codigo_barras=@codigo AND ubicacion=@ubicacion`)
  return r.recordset[0]?.stock ?? 0
}

// Resiliente: funciona con o sin ubicaciones_bodega, con o sin columna ubicacion
async function getStockPorUbicacion(db, codigo) {
  // Intento 1: query completa con JOIN a ubicaciones_bodega
  try {
    const r = await db.request()
      .input('codigo', sql.VarChar(50), codigo)
      .query(`
        SELECT ISNULL(i.ubicacion,'Bodega') AS ubicacion,
               i.cantidad,
               ISNULL(u.color,'#6B7280')   AS color
        FROM ${INV} i
        LEFT JOIN ${UBIC} u ON u.nombre=ISNULL(i.ubicacion,'Bodega') AND u.activa=1
        WHERE i.codigo_barras=@codigo AND i.cantidad>0
        ORDER BY i.cantidad DESC`)
    if (r.recordset.length > 0) return r.recordset
  } catch {}

  // Intento 2: sin ubicaciones_bodega (puede que la tabla no exista aún)
  try {
    const r = await db.request()
      .input('codigo', sql.VarChar(50), codigo)
      .query(`
        SELECT ISNULL(ubicacion,'Bodega') AS ubicacion,
               cantidad,
               '#6B7280' AS color
        FROM ${INV}
        WHERE codigo_barras=@codigo AND cantidad>0
        ORDER BY cantidad DESC`)
    if (r.recordset.length > 0) return r.recordset
  } catch {}

  // Intento 3: sin columna ubicacion (tabla muy antigua)
  try {
    const r = await db.request()
      .input('codigo', sql.VarChar(50), codigo)
      .query(`SELECT ISNULL(SUM(cantidad),0) AS total FROM ${INV} WHERE codigo_barras=@codigo`)
    const total = r.recordset[0]?.total ?? 0
    if (total > 0) return [{ ubicacion: 'Bodega', cantidad: total, color: '#1D9E75' }]
  } catch {}

  return []
}

// Devuelve el código canónico guardado en inventario_bodega para este producto
// (puede ser Art_GTIN o CodAlt_Codigo según cómo se escaneó por primera vez)
async function getCodigoReal(db, codigo) {
  // Buscar primero en inventario_bodega con el código exacto
  const r1 = await db.request()
    .input('codigo', sql.VarChar(50), codigo)
    .query(`SELECT TOP 1 codigo_barras FROM ${INV} WHERE codigo_barras=@codigo`)
  if (r1.recordset[0]) return r1.recordset[0].codigo_barras

  // Si no está, buscar el código alterno en VISTA y luego en inventario_bodega
  try {
    const r2 = await db.request()
      .input('codigo', sql.NVarChar(50), codigo)
      .query(`SELECT TOP 1 Art_GTIN, CodAlt_Codigo FROM ${VISTA}
              WHERE Art_GTIN=@codigo OR CodAlt_Codigo=@codigo`)
    if (r2.recordset[0]) {
      const { Art_GTIN, CodAlt_Codigo } = r2.recordset[0]
      for (const c of [Art_GTIN, CodAlt_Codigo]) {
        if (!c) continue
        const r3 = await db.request()
          .input('c', sql.VarChar(50), c)
          .query(`SELECT TOP 1 codigo_barras FROM ${INV} WHERE codigo_barras=@c`)
        if (r3.recordset[0]) return r3.recordset[0].codigo_barras
      }
    }
  } catch {}

  // Devolver el código original si no hay nada en inventario aún
  return codigo
}

// ── GET /api/almacen/producto/:codigo ─────────────────────────────────────────
app.get('/api/almacen/producto/:codigo', async (req, res) => {
  try {
    const db = await getPool()
    const nombre = await getNombre(db, req.params.codigo)
    if (!nombre) return res.status(404).json({ mensaje: 'Producto no encontrado' })
    // Usar el código real almacenado en inventario_bodega para encontrar el stock
    const codigoReal = await getCodigoReal(db, req.params.codigo)
    const [stock, stockPorUbicacion] = await Promise.all([
      getStock(db, codigoReal),
      getStockPorUbicacion(db, codigoReal),
    ])
    res.json({ codigo: req.params.codigo, nombre, stock, stockPorUbicacion })
  } catch (err) {
    console.error('getProducto:', err.message)
    res.status(500).json({ mensaje: err.message })
  }
})

// ── POST /api/almacen/entrada ──────────────────────────────────────────────────
app.post('/api/almacen/entrada', async (req, res) => {
  const { codigo, cantidad, ubicacion = 'Bodega' } = req.body
  const ubic = ubicacion || 'Bodega'
  if (!codigo || !cantidad || cantidad <= 0)
    return res.status(400).json({ mensaje: 'Datos inválidos' })
  try {
    const db = await getPool()
    const nombre = await getNombre(db, codigo)
    if (!nombre) return res.status(404).json({ mensaje: 'Producto no encontrado' })

    if (!adquirirLock(codigo, `entrada:${ubic}`))
      return res.json({ ok: true, stockActual: await getStock(db, codigo), mensaje: 'Entrada registrada' })

    const stockAntes   = await getStock(db, codigo)
    const stockDespues = stockAntes + cantidad

    const t = db.transaction()
    await t.begin()
    try {
      await t.request()
        .input('codigo',    sql.VarChar(50), codigo)
        .input('cantidad',  sql.Int,         cantidad)
        .input('ubicacion', sql.VarChar(50), ubic)
        .query(`
          MERGE ${INV} AS target
          USING (SELECT @codigo AS codigo_barras, @ubicacion AS ubicacion) AS src
            ON target.codigo_barras=src.codigo_barras AND target.ubicacion=src.ubicacion
          WHEN MATCHED THEN
            UPDATE SET cantidad=target.cantidad+@cantidad, ultima_entrada=GETDATE()
          WHEN NOT MATCHED THEN
            INSERT (codigo_barras,ubicacion,cantidad,ultima_entrada)
            VALUES (@codigo,@ubicacion,@cantidad,GETDATE());`)
      await t.request()
        .input('codigo',       sql.VarChar(50), codigo)
        .input('cantidad',     sql.Int,         cantidad)
        .input('ubicacion',    sql.VarChar(50), ubic)
        .input('stockAntes',   sql.Int,         stockAntes)
        .input('stockDespues', sql.Int,         stockDespues)
        .query(`INSERT INTO ${MOV}(codigo_barras,tipo,cantidad,ubicacion,stock_antes,stock_despues,fecha)
                VALUES(@codigo,'entrada',@cantidad,@ubicacion,@stockAntes,@stockDespues,GETDATE())`)
      await t.commit()
    } catch (err) { await t.rollback(); throw err }

    res.json({ ok: true, stockActual: stockDespues, mensaje: 'Entrada registrada' })
  } catch (err) {
    console.error('entrada:', err.message)
    res.status(500).json({ mensaje: err.message })
  }
})

// ── POST /api/almacen/salida ───────────────────────────────────────────────────
app.post('/api/almacen/salida', async (req, res) => {
  const { codigo, cantidad, ubicacion } = req.body
  const ubic = ubicacion || 'Bodega'
  if (!codigo || !cantidad || cantidad <= 0)
    return res.status(400).json({ mensaje: 'Datos inválidos' })
  try {
    const db = await getPool()
    const nombre = await getNombre(db, codigo)
    if (!nombre) return res.status(404).json({ mensaje: 'Producto no encontrado' })

    if (!adquirirLock(codigo, `salida:${ubic}`))
      return res.json({ ok: true, stockActual: await getStock(db, codigo), mensaje: 'Salida registrada' })

    // Verificar stock en la ubicación especificada
    let stockEnUbic = await getStockEnUbic(db, codigo, ubic)

    // Si no hay stock en esa ubicación, buscar en la primera que tenga suficiente
    if (stockEnUbic < cantidad) {
      const stockTotal = await getStock(db, codigo)
      if (stockTotal < cantidad)
        return res.status(400).json({ mensaje: `Stock insuficiente. Total disponible: ${stockTotal} pzas` })

      // Tomar de la ubicación con más stock
      const r = await db.request()
        .input('codigo', sql.VarChar(50), codigo)
        .query(`SELECT TOP 1 ubicacion, cantidad FROM ${INV}
                WHERE codigo_barras=@codigo AND cantidad>0
                ORDER BY cantidad DESC`)
      if (!r.recordset[0] || r.recordset[0].cantidad < cantidad)
        return res.status(400).json({ mensaje: `Stock insuficiente en ${ubic}. Disponible: ${stockEnUbic} pzas` })

      const ubicReal = r.recordset[0].ubicacion
      stockEnUbic = r.recordset[0].cantidad
      return doSalida(db, codigo, cantidad, ubicReal, stockEnUbic, res)
    }

    return doSalida(db, codigo, cantidad, ubic, stockEnUbic, res)
  } catch (err) {
    console.error('salida:', err.message)
    res.status(500).json({ mensaje: err.message })
  }
})

async function doSalida(db, codigo, cantidad, ubic, stockEnUbic, res) {
  const stockAntes   = await getStock(db, codigo)
  const stockDespues = stockAntes - cantidad
  const t = db.transaction()
  await t.begin()
  try {
    await t.request()
      .input('codigo',    sql.VarChar(50), codigo)
      .input('cantidad',  sql.Int,         cantidad)
      .input('ubicacion', sql.VarChar(50), ubic)
      .query(`UPDATE ${INV} SET cantidad=cantidad-@cantidad, ultima_salida=GETDATE()
              WHERE codigo_barras=@codigo AND ubicacion=@ubicacion`)
    await t.request()
      .input('codigo',       sql.VarChar(50), codigo)
      .input('cantidad',     sql.Int,         cantidad)
      .input('ubicacion',    sql.VarChar(50), ubic)
      .input('stockAntes',   sql.Int,         stockAntes)
      .input('stockDespues', sql.Int,         stockDespues)
      .query(`INSERT INTO ${MOV}(codigo_barras,tipo,cantidad,ubicacion,stock_antes,stock_despues,fecha)
              VALUES(@codigo,'salida',@cantidad,@ubicacion,@stockAntes,@stockDespues,GETDATE())`)
    await t.commit()
  } catch (err) { await t.rollback(); throw err }
  res.json({ ok: true, stockActual: stockDespues, mensaje: 'Salida registrada' })
}

// ── POST /api/almacen/merma ────────────────────────────────────────────────────
app.post('/api/almacen/merma', async (req, res) => {
  const { codigo, cantidad, motivo, ubicacion = 'Bodega', notas } = req.body
  const ubic = ubicacion || 'Bodega'
  if (!codigo || !cantidad || cantidad <= 0)
    return res.status(400).json({ mensaje: 'Datos inválidos' })
  try {
    const db = await getPool()
    const nombre = await getNombre(db, codigo)
    if (!nombre) return res.status(404).json({ mensaje: 'Producto no encontrado' })

    if (!adquirirLock(codigo, `merma:${ubic}`))
      return res.json({ ok: true, stockActual: await getStock(db, codigo), mensaje: 'Merma registrada' })

    let stockEnUbic = await getStockEnUbic(db, codigo, ubic)
    if (stockEnUbic < cantidad) {
      // Fallback: usar la ubicación con más stock
      const r = await db.request()
        .input('codigo', sql.VarChar(50), codigo)
        .query(`SELECT TOP 1 ubicacion, cantidad FROM ${INV}
                WHERE codigo_barras=@codigo AND cantidad>=0
                ORDER BY cantidad DESC`)
      const alt = r.recordset[0]
      if (!alt || alt.cantidad < cantidad)
        return res.status(400).json({ mensaje: `Stock insuficiente. Disponible: ${await getStock(db, codigo)} pzas` })
      stockEnUbic = alt.cantidad
      return doMerma(db, codigo, cantidad, alt.ubicacion, motivo, notas, res)
    }
    return doMerma(db, codigo, cantidad, ubic, motivo, notas, res)
  } catch (err) {
    console.error('merma:', err.message)
    res.status(500).json({ mensaje: err.message })
  }
})

async function doMerma(db, codigo, cantidad, ubic, motivo, notas, res) {
  const stockAntes   = await getStock(db, codigo)
  const stockDespues = stockAntes - cantidad
  const t = db.transaction()
  await t.begin()
  try {
    await t.request()
      .input('codigo',    sql.VarChar(50), codigo)
      .input('cantidad',  sql.Int,         cantidad)
      .input('ubicacion', sql.VarChar(50), ubic)
      .query(`UPDATE ${INV} SET cantidad=cantidad-@cantidad, ultima_salida=GETDATE()
              WHERE codigo_barras=@codigo AND ubicacion=@ubicacion`)
    await t.request()
      .input('codigo',       sql.VarChar(50),  codigo)
      .input('cantidad',     sql.Int,           cantidad)
      .input('ubicacion',    sql.VarChar(50),   ubic)
      .input('motivo',       sql.VarChar(30),   motivo || null)
      .input('notas',        sql.VarChar(200),  notas  || null)
      .input('stockAntes',   sql.Int,           stockAntes)
      .input('stockDespues', sql.Int,           stockDespues)
      .query(`INSERT INTO ${MOV}(codigo_barras,tipo,cantidad,ubicacion,motivo,area,notas,stock_antes,stock_despues,fecha)
              VALUES(@codigo,'merma',@cantidad,@ubicacion,@motivo,@ubicacion,@notas,@stockAntes,@stockDespues,GETDATE())`)
    await t.commit()
  } catch (err) { await t.rollback(); throw err }
  res.json({ ok: true, stockActual: stockDespues, mensaje: 'Merma registrada' })
}

// ── GET /api/almacen/movimientos ──────────────────────────────────────────────
app.get('/api/almacen/movimientos', async (_req, res) => {
  try {
    const db = await getPool()
    const result = await db.request().query(`
      SELECT m.id,
             m.codigo_barras                            AS codigo,
             ISNULL(v.Art_Descripcion,m.codigo_barras)  AS nombre,
             m.tipo, m.cantidad,
             ISNULL(m.stock_antes,0)                    AS stock_antes,
             ISNULL(m.stock_despues,0)                  AS stock_despues,
             ''                                         AS usuario,
             CONVERT(VARCHAR(23),m.fecha,120)            AS fecha,
             m.ubicacion
      FROM ${MOV} m
      OUTER APPLY (SELECT TOP 1 Art_Descripcion FROM ${VISTA}
                   WHERE Art_GTIN=m.codigo_barras OR CodAlt_Codigo=m.codigo_barras) v
      WHERE CAST(m.fecha AS DATE)=CAST(GETDATE() AS DATE)
      ORDER BY m.fecha DESC`)
    res.json(result.recordset)
  } catch (err) {
    console.error('movimientos:', err.message)
    res.status(500).json({ mensaje: err.message })
  }
})

// ── GET /api/almacen/buscar?q=... ─────────────────────────────────────────────
app.get('/api/almacen/buscar', async (req, res) => {
  const q = (req.query.q ?? '').toString().trim()
  if (q.length < 2) return res.json([])
  try {
    const db = await getPool()

    // 1. Productos con stock total — busca por GTIN Y por código alterno (CodAlt_Codigo)
    const result = await db.request()
      .input('q', sql.NVarChar(100), `%${q}%`)
      .query(`
        SELECT TOP 15
          v.Art_GTIN                 AS codigo,
          ISNULL(v.CodAlt_Codigo,'') AS codigo_alt,
          v.Art_Descripcion          AS nombre,
          ISNULL((
            SELECT SUM(cantidad) FROM ${INV}
            WHERE codigo_barras = v.Art_GTIN
               OR codigo_barras = v.CodAlt_Codigo
          ), 0) AS stock
        FROM ${VISTA} v
        WHERE v.Art_Descripcion LIKE @q
           OR v.Art_GTIN        LIKE @q
           OR v.CodAlt_Codigo   LIKE @q
        ORDER BY v.Art_Descripcion`)

    const products = result.recordset
    if (products.length === 0) return res.json([])

    // 2. Desglose por ubicación — busca por ambos códigos
    const locMap = {}
    try {
      const allCodes = new Set()
      for (const p of products) {
        if (p.codigo)     allCodes.add(`'${p.codigo.replace(/'/g, "''")}'`)
        if (p.codigo_alt) allCodes.add(`'${p.codigo_alt.replace(/'/g, "''")}'`)
      }
      const locResult = await db.request().query(`
        SELECT i.codigo_barras, ISNULL(i.ubicacion,'Bodega') AS ubicacion,
               i.cantidad, ISNULL(u.color,'#6B7280') AS color
        FROM ${INV} i
        LEFT JOIN ${UBIC} u ON u.nombre=ISNULL(i.ubicacion,'Bodega') AND u.activa=1
        WHERE i.codigo_barras IN (${[...allCodes].join(',')}) AND i.cantidad>0
        ORDER BY i.codigo_barras, i.cantidad DESC`)
      for (const row of locResult.recordset) {
        // Asociar la fila al producto que tenga ese código (GTIN o alterno)
        const prod = products.find(p => p.codigo === row.codigo_barras || p.codigo_alt === row.codigo_barras)
        if (prod) {
          if (!locMap[prod.codigo]) locMap[prod.codigo] = []
          locMap[prod.codigo].push({ ubicacion: row.ubicacion, cantidad: row.cantidad, color: row.color })
        }
      }
    } catch {}

    res.json(products.map(p => ({
      codigo:            p.codigo,
      nombre:            p.nombre,
      stock:             p.stock,
      stockPorUbicacion: locMap[p.codigo] ?? [],
    })))
  } catch (err) {
    console.error('buscar:', err.message)
    res.status(500).json({ mensaje: err.message })
  }
})

// ── POST /api/almacen/traslado ─────────────────────────────────────────────────
app.post('/api/almacen/traslado', async (req, res) => {
  const { codigo, cantidad, de_ubicacion, a_ubicacion } = req.body
  if (!codigo || !cantidad || cantidad <= 0 || !de_ubicacion || !a_ubicacion)
    return res.status(400).json({ mensaje: 'Datos inválidos' })
  if (de_ubicacion === a_ubicacion)
    return res.status(400).json({ mensaje: 'El origen y destino deben ser diferentes' })
  try {
    const db = await getPool()
    const nombre = await getNombre(db, codigo)
    if (!nombre) return res.status(404).json({ mensaje: 'Producto no encontrado' })

    if (!adquirirLock(codigo, `traslado:${de_ubicacion}:${a_ubicacion}`))
      return res.json({ ok: true, mensaje: 'Traslado registrado' })

    // Buscar el stock en el origen — también acepta filas con ubicacion NULL (como 'Bodega')
    const stockOrigenRes = await db.request()
      .input('codigo',    sql.VarChar(50), codigo)
      .input('ubicacion', sql.VarChar(50), de_ubicacion)
      .query(`SELECT ISNULL(SUM(cantidad),0) AS stock FROM ${INV}
              WHERE codigo_barras=@codigo
                AND (ubicacion=@ubicacion OR (ubicacion IS NULL AND @ubicacion='Bodega'))`)
    const stockOrigen = stockOrigenRes.recordset[0]?.stock ?? 0

    if (stockOrigen < cantidad)
      return res.status(400).json({ mensaje: `Stock insuficiente en ${de_ubicacion}. Disponible: ${stockOrigen} pzas` })

    const t = db.transaction()
    await t.begin()
    try {
      // Restar del origen (también actualiza filas con ubicacion NULL si el origen es Bodega)
      await t.request()
        .input('codigo',    sql.VarChar(50), codigo)
        .input('cantidad',  sql.Int,         cantidad)
        .input('ubicacion', sql.VarChar(50), de_ubicacion)
        .query(`UPDATE ${INV} SET cantidad=cantidad-@cantidad, ultima_salida=GETDATE()
                WHERE codigo_barras=@codigo
                  AND (ubicacion=@ubicacion OR (ubicacion IS NULL AND @ubicacion='Bodega'))`)
      // Sumar al destino
      await t.request()
        .input('codigo',    sql.VarChar(50), codigo)
        .input('cantidad',  sql.Int,         cantidad)
        .input('ubicacion', sql.VarChar(50), a_ubicacion)
        .query(`
          MERGE ${INV} AS target
          USING (SELECT @codigo AS codigo_barras, @ubicacion AS ubicacion) AS src
            ON target.codigo_barras=src.codigo_barras AND target.ubicacion=src.ubicacion
          WHEN MATCHED THEN
            UPDATE SET cantidad=target.cantidad+@cantidad, ultima_entrada=GETDATE()
          WHEN NOT MATCHED THEN
            INSERT (codigo_barras,ubicacion,cantidad,ultima_entrada)
            VALUES (@codigo,@ubicacion,@cantidad,GETDATE());`)
      // Registrar movimiento
      await t.request()
        .input('codigo',    sql.VarChar(50), codigo)
        .input('cantidad',  sql.Int,         cantidad)
        .input('de_ubic',   sql.VarChar(50), de_ubicacion)
        .input('a_ubic',    sql.VarChar(50), a_ubicacion)
        .query(`INSERT INTO ${MOV}(codigo_barras,tipo,cantidad,ubicacion,area,fecha)
                VALUES(@codigo,'traslado',@cantidad,@a_ubic,@de_ubic,GETDATE())`)
      await t.commit()
    } catch (err) { await t.rollback(); throw err }

    res.json({ ok: true, stockActual: await getStock(db, codigo), mensaje: `Traslado: ${cantidad} pzas de ${de_ubicacion} → ${a_ubicacion}` })
  } catch (err) {
    console.error('traslado:', err.message)
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
      .query(`SELECT codigo_barras,tipo,cantidad,ISNULL(ubicacion,'Bodega') AS ubicacion FROM ${MOV} WHERE id=@id`)
    if (!movResult.recordset[0]) return res.status(404).json({ mensaje: 'Movimiento no encontrado' })

    const { codigo_barras, tipo, cantidad: cantVieja, ubicacion } = movResult.recordset[0]
    const diferencia = nuevaCantidad - cantVieja
    if (diferencia === 0) return res.json({ ok: true, mensaje: 'Sin cambios' })

    const ajuste = tipo === 'entrada' ? diferencia : -diferencia
    if (ajuste < 0) {
      const s = await getStockEnUbic(db, codigo_barras, ubicacion)
      if (s + ajuste < 0)
        return res.status(400).json({ mensaje: `El stock quedaría negativo en ${ubicacion}.` })
    }

    await db.request()
      .input('codigo', sql.VarChar(50), codigo_barras)
      .input('ubicacion', sql.VarChar(50), ubicacion)
      .input('ajuste', sql.Int, ajuste)
      .query(`UPDATE ${INV} SET cantidad=cantidad+@ajuste WHERE codigo_barras=@codigo AND ubicacion=@ubicacion`)
    await db.request()
      .input('id', sql.Int, id)
      .input('nuevaCantidad', sql.Int, nuevaCantidad)
      .query(`UPDATE ${MOV} SET cantidad=@nuevaCantidad WHERE id=@id`)

    res.json({ ok: true, mensaje: 'Corregido' })
  } catch (err) {
    console.error('editar movimiento:', err.message)
    res.status(500).json({ mensaje: err.message })
  }
})

// ── GET/POST/DELETE /api/almacen/ubicaciones/areas ────────────────────────────
app.get('/api/almacen/ubicaciones/areas', async (_req, res) => {
  try {
    const db = await getPool()
    const r = await db.request()
      .query(`SELECT id,nombre,color FROM ${UBIC} WHERE activa=1 ORDER BY orden,nombre`)
    res.json(r.recordset)
  } catch (err) { res.status(500).json({ mensaje: err.message }) }
})

app.post('/api/almacen/ubicaciones/areas', async (req, res) => {
  const { nombre, color } = req.body
  if (!nombre?.trim()) return res.status(400).json({ mensaje: 'Nombre requerido' })
  try {
    const db = await getPool()
    await db.request()
      .input('nombre', sql.VarChar(50), nombre.trim())
      .input('color',  sql.VarChar(7),  color || '#5F5E5A')
      .query(`INSERT INTO ${UBIC}(nombre,color) VALUES(@nombre,@color)`)
    const r = await db.request()
      .query(`SELECT id,nombre,color FROM ${UBIC} WHERE activa=1 ORDER BY orden,nombre`)
    res.json(r.recordset)
  } catch (err) { res.status(500).json({ mensaje: err.message }) }
})

app.delete('/api/almacen/ubicaciones/areas/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) return res.status(400).json({ mensaje: 'ID inválido' })
  try {
    const db = await getPool()
    await db.request().input('id', sql.Int, id)
      .query(`UPDATE ${UBIC} SET activa=0 WHERE id=@id`)
    const r = await db.request()
      .query(`SELECT id,nombre,color FROM ${UBIC} WHERE activa=1 ORDER BY orden,nombre`)
    res.json(r.recordset)
  } catch (err) { res.status(500).json({ mensaje: err.message }) }
})

// ── GET /api/almacen/inventario — todo el stock por producto y ubicación ───────
app.get('/api/almacen/inventario', async (_req, res) => {
  try {
    const db = await getPool()
    const result = await db.request().query(`
      SELECT
        i.codigo_barras                                          AS codigo,
        ISNULL(v.Art_Descripcion, i.codigo_barras)               AS nombre,
        ISNULL(i.ubicacion, 'Bodega')                            AS ubicacion,
        i.cantidad,
        ISNULL(u.color, '#6B7280')                               AS color
      FROM ${INV} i
      OUTER APPLY (
        SELECT TOP 1 Art_Descripcion FROM ${VISTA}
        WHERE Art_GTIN=i.codigo_barras OR CodAlt_Codigo=i.codigo_barras
      ) v
      LEFT JOIN ${UBIC} u ON u.nombre=ISNULL(i.ubicacion,'Bodega') AND u.activa=1
      WHERE i.cantidad > 0
      ORDER BY nombre, i.ubicacion`)
    res.json(result.recordset)
  } catch (err) {
    console.error('inventario:', err.message)
    res.status(500).json({ mensaje: err.message })
  }
})

// ── Stubs ─────────────────────────────────────────────────────────────────────
app.post('/api/almacen/producto-ubicacion', (_req, res) => res.json({ ok: true }))
app.get('/api/almacen/pedidos', (_req, res) => res.json([]))

// ── Frontend estático ─────────────────────────────────────────────────────────
app.use(express.static(join(__dirname, 'dist')))
app.get('*', (_req, res) => res.sendFile(join(__dirname, 'dist', 'index.html')))

// ── Arranque: migración primero, servidor después ────────────────────────────
async function main() {
  console.log(' Preparando base de datos...')
  try {
    const db = await getPool()
    await autoMigrate(db)
  } catch (err) {
    console.error(' Advertencia migración:', err.message)
  }
  app.listen(PORT, '0.0.0.0', () => {
    const ip = getLocalIP()
    console.log(`\n Bodega TC52 listo!`)
    console.log(` Abre en el TC52: http://${ip}:${PORT}\n`)
  })
}
main()
