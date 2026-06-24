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
  connectionTimeout: 15000,
  requestTimeout:    30000,
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

  // 4b. Agregar columna nombre a inventario_bodega (para productos nuevos que
  //     aún no existen en NovaCaja — la bodega los maneja por su cuenta)
  await run(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id=OBJECT_ID('inventario_bodega') AND name='nombre')
      ALTER TABLE inventario_bodega ADD nombre VARCHAR(200) NULL`)

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
  // 'Bodega' es obligatoria: reactivarla siempre por si alguien la borró
  await run(`UPDATE ubicaciones_bodega SET activa=1 WHERE nombre='Bodega'`)
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

  // 9. Tabla de códigos: relaciona códigos (caja e individual) al MISMO producto.
  //    El stock vive SIEMPRE en piezas bajo codigo_base (el individual). Un código
  //    de caja apunta al mismo codigo_base con unidades = piezas por caja.
  await run(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='codigos_producto' AND xtype='U')
    CREATE TABLE codigos_producto (
      id          INT           IDENTITY(1,1) PRIMARY KEY,
      codigo      VARCHAR(50)   NOT NULL,
      codigo_base VARCHAR(50)   NOT NULL,
      unidades    INT           NOT NULL DEFAULT 1,
      tipo        VARCHAR(12)   NOT NULL DEFAULT 'individual',
      nombre      VARCHAR(200)  NULL,
      creado      DATETIME      NOT NULL DEFAULT GETDATE()
    )`)
  await run(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('codigos_producto') AND name='UQ_codprod_codigo')
      ALTER TABLE codigos_producto ADD CONSTRAINT UQ_codprod_codigo UNIQUE (codigo)`)
  await run(`
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID('codigos_producto') AND name='IX_codprod_base')
      CREATE INDEX IX_codprod_base ON codigos_producto (codigo_base)`)
  // Backfill seguro (NO cambia stock): cada codigo en inventario_bodega que aún no
  // tenga fila se registra como su propia base individual (unidades=1).
  await run(`
    INSERT INTO codigos_producto (codigo, codigo_base, unidades, tipo)
    SELECT DISTINCT i.codigo_barras, i.codigo_barras, 1, 'individual'
    FROM inventario_bodega i
    WHERE NOT EXISTS (SELECT 1 FROM codigos_producto c WHERE c.codigo = i.codigo_barras)`)

  migrated = true
  console.log(' Migración automática completada')
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// 'Sin ubicar' / vacío / NULL siempre cuentan como 'Bodega' (evita stock huérfano)
function normUbic(u) {
  const v = (u ?? '').toString().trim()
  return (!v || v === 'Sin ubicar') ? 'Bodega' : v
}

const _opsEnCurso = new Map()
function adquirirLock(codigo, tipo) {
  const key = `${codigo}:${tipo}`
  if (_opsEnCurso.has(key)) return false
  _opsEnCurso.set(key, true)
  setTimeout(() => _opsEnCurso.delete(key), 5000)
  return true
}

async function getNombre(db, codigo) {
  // 1. Nombre propio de la bodega (override): vale para productos nuevos y para
  //    cuando corrigen un nombre mal puesto. Tiene prioridad sobre NovaCaja.
  try {
    const r2 = await db.request()
      .input('codigo', sql.VarChar(50), codigo)
      .query(`SELECT TOP 1 nombre FROM ${INV}
              WHERE codigo_barras=@codigo AND nombre IS NOT NULL AND nombre<>''`)
    if (r2.recordset[0]?.nombre) return r2.recordset[0].nombre
  } catch {}

  // 1b. Nombre guardado en la relación de códigos (caja/individual). Esto permite
  //     escanear el código de la CAJA aunque el stock viva bajo el individual.
  try {
    const rc = await db.request()
      .input('codigo', sql.VarChar(50), codigo)
      .query(`SELECT TOP 1 nombre FROM ${COD}
              WHERE (codigo=@codigo OR codigo_base=@codigo) AND nombre IS NOT NULL AND nombre<>''`)
    if (rc.recordset[0]?.nombre) return rc.recordset[0].nombre
  } catch {}

  // 2. Nombre del catálogo de NovaCaja
  const r = await db.request()
    .input('codigo', sql.NVarChar(50), codigo)
    .query(`SELECT TOP 1 Art_Descripcion AS nombre FROM ${VISTA}
            WHERE Art_GTIN=@codigo OR CodAlt_Codigo=@codigo OR Art_Codigo=@codigo OR Art_PLU=@codigo
            ORDER BY Art_Codigo`)
  if (r.recordset[0]?.nombre) return r.recordset[0].nombre

  // 3. Último recurso: si el producto YA tiene stock en la bodega aunque sin
  //    nombre, devolver el código para que se pueda buscar/escanear/sacar.
  try {
    const r3 = await db.request()
      .input('codigo', sql.VarChar(50), codigo)
      .query(`SELECT TOP 1 codigo_barras FROM ${INV} WHERE codigo_barras=@codigo`)
    if (r3.recordset[0]) return codigo
  } catch {}

  return null
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

const COD = '[compucaja].[dbo].[codigos_producto]'

// Resuelve cualquier código escaneado a su producto base + cuántas piezas
// representa. Si no hay relación registrada, se comporta como hoy (1 = 1).
async function resolverCodigo(db, codigo) {
  try {
    const r = await db.request()
      .input('codigo', sql.VarChar(50), codigo)
      .query(`SELECT TOP 1 codigo_base, unidades, tipo FROM ${COD} WHERE codigo=@codigo`)
    const row = r.recordset[0]
    if (row) return { codigo_base: row.codigo_base, unidades: Math.max(1, row.unidades || 1), tipo: row.tipo || 'individual' }
  } catch {}
  // Sin relación: el código es su propia base, 1 pieza (comportamiento actual)
  const base = await getCodigoReal(db, codigo)
  return { codigo_base: base, unidades: 1, tipo: 'individual' }
}

// Devuelve las piezas por caja de un producto base (si tiene un código-caja).
async function getPiezasPorCaja(db, codigoBase) {
  try {
    const r = await db.request()
      .input('base', sql.VarChar(50), codigoBase)
      .query(`SELECT TOP 1 unidades FROM ${COD}
              WHERE codigo_base=@base AND tipo='caja' AND unidades>1
              ORDER BY unidades DESC`)
    return r.recordset[0]?.unidades ?? 1
  } catch { return 1 }
}

// Registra/actualiza un código (caja o individual) apuntando a su producto base.
async function upsertCodigo(reqOrTx, { codigo, codigo_base, unidades, tipo, nombre = null }) {
  await reqOrTx.request()
    .input('codigo',   sql.VarChar(50),  codigo)
    .input('base',     sql.VarChar(50),  codigo_base)
    .input('unidades', sql.Int,          unidades)
    .input('tipo',     sql.VarChar(12),  tipo)
    .input('nombre',   sql.VarChar(200), nombre)
    .query(`
      MERGE ${COD} AS t
      USING (SELECT @codigo AS codigo) AS s ON t.codigo = s.codigo
      WHEN MATCHED THEN UPDATE SET codigo_base=@base, unidades=@unidades, tipo=@tipo,
                                   nombre=ISNULL(@nombre, t.nombre)
      WHEN NOT MATCHED THEN INSERT (codigo, codigo_base, unidades, tipo, nombre)
        VALUES (@codigo, @base, @unidades, @tipo, @nombre);`)
}

// ── GET /api/almacen/producto/:codigo ─────────────────────────────────────────
app.get('/api/almacen/producto/:codigo', async (req, res) => {
  try {
    const db = await getPool()
    // Resolver el código escaneado a su producto base + cuántas piezas representa
    const { codigo_base, unidades, tipo } = await resolverCodigo(db, req.params.codigo)
    const nombre = await getNombre(db, codigo_base)
    if (!nombre) return res.status(404).json({ mensaje: 'Producto no encontrado' })
    const [stock, stockPorUbicacion, piezasPorCaja] = await Promise.all([
      getStock(db, codigo_base),
      getStockPorUbicacion(db, codigo_base),
      getPiezasPorCaja(db, codigo_base),
    ])
    res.json({
      codigo: req.params.codigo,   // el código ESCANEADO (las escrituras lo re-resuelven)
      codigo_base, nombre, stock, stockPorUbicacion,
      tipo, unidades,              // del código escaneado (caja => unidades>1)
      piezas_por_caja: piezasPorCaja,
    })
  } catch (err) {
    console.error('getProducto:', err.message)
    res.status(500).json({ mensaje: err.message })
  }
})

// ── POST /api/almacen/entrada ──────────────────────────────────────────────────
app.post('/api/almacen/entrada', async (req, res) => {
  const { codigo, cantidad, ubicacion = 'Bodega' } = req.body
  const ubic = normUbic(ubicacion)
  if (!codigo || !cantidad || cantidad <= 0)
    return res.status(400).json({ mensaje: 'Datos inválidos' })
  try {
    const db = await getPool()
    // Resolver el código escaneado → producto base + piezas que representa.
    // Si escanean el código de la caja, 'cantidad' son cajas y se multiplica.
    const { codigo_base, unidades } = await resolverCodigo(db, codigo)
    const piezas = cantidad * unidades
    const nombre = await getNombre(db, codigo_base)
    if (!nombre) return res.status(404).json({ mensaje: 'Producto no encontrado' })

    if (!adquirirLock(codigo_base, `entrada:${ubic}`))
      return res.json({ ok: true, stockActual: await getStock(db, codigo_base), mensaje: 'Entrada registrada' })

    const stockAntes   = await getStock(db, codigo_base)
    const stockDespues = stockAntes + piezas

    const t = db.transaction()
    await t.begin()
    try {
      await t.request()
        .input('codigo',    sql.VarChar(50), codigo_base)
        .input('cantidad',  sql.Int,         piezas)
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
        .input('codigo',       sql.VarChar(50), codigo_base)
        .input('cantidad',     sql.Int,         piezas)
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

// ── POST /api/almacen/producto-nuevo ───────────────────────────────────────────
// Registra un producto que AÚN NO existe en NovaCaja: guarda su nombre propio en
// inventario_bodega y suma stock al instante (aparece en Inventario e Historial).
// El alta en NovaCaja y el precio los pone el admin después; esto no los espera.
app.post('/api/almacen/producto-nuevo', async (req, res) => {
  const { codigo_barras, codigo_caja, descripcion, cantidad, ubicacion = 'Bodega',
          piezas_por_caja = 1, proveedor = null } = req.body
  const codigo   = String(codigo_barras || '').trim()        // código individual = base
  const codCaja  = String(codigo_caja || '').trim()          // código de la caja (opcional)
  const ppc      = Math.max(1, parseInt(piezas_por_caja) || 1)
  const nombre = String(descripcion || '').trim()
  const ubic   = normUbic(ubicacion)
  const qty    = parseInt(cantidad, 10) || 0   // cantidad inicial es OPCIONAL
  if (!codigo || nombre.length < 2)
    return res.status(400).json({ mensaje: 'Datos inválidos: falta código o descripción' })
  if (codCaja && codCaja === codigo)
    return res.status(400).json({ mensaje: 'El código de la caja y el individual deben ser diferentes' })
  try {
    const db = await getPool()

    // Registrar la relación de códigos (individual = base; caja = N piezas)
    await upsertCodigo(db, { codigo, codigo_base: codigo, unidades: 1, tipo: 'individual', nombre })
    if (codCaja) await upsertCodigo(db, { codigo: codCaja, codigo_base: codigo, unidades: ppc, tipo: 'caja', nombre })

    if (!adquirirLock(codigo, `nuevo:${ubic}`))
      return res.json({ ok: true, stockActual: await getStock(db, codigo), mensaje: 'Producto registrado' })

    const stockAntes   = await getStock(db, codigo)
    const stockDespues = stockAntes + qty

    const t = db.transaction()
    await t.begin()
    try {
      // Suma stock (qty>0) o crea fila con cantidad 0 para que el producto exista
      // y sea buscable, guardando su nombre.
      await t.request()
        .input('codigo',    sql.VarChar(50),  codigo)
        .input('cantidad',  sql.Int,          qty)
        .input('ubicacion', sql.VarChar(50),  ubic)
        .input('nombre',    sql.VarChar(200), nombre)
        .query(`
          MERGE ${INV} AS target
          USING (SELECT @codigo AS codigo_barras, @ubicacion AS ubicacion) AS src
            ON target.codigo_barras=src.codigo_barras AND target.ubicacion=src.ubicacion
          WHEN MATCHED THEN
            UPDATE SET cantidad=target.cantidad+@cantidad, ultima_entrada=GETDATE(),
                       nombre=ISNULL(NULLIF(target.nombre,''),@nombre)
          WHEN NOT MATCHED THEN
            INSERT (codigo_barras,ubicacion,cantidad,nombre,ultima_entrada)
            VALUES (@codigo,@ubicacion,@cantidad,@nombre,GETDATE());`)
      if (qty > 0) {
        await t.request()
          .input('codigo',       sql.VarChar(50), codigo)
          .input('cantidad',     sql.Int,         qty)
          .input('ubicacion',    sql.VarChar(50), ubic)
          .input('stockAntes',   sql.Int,         stockAntes)
          .input('stockDespues', sql.Int,         stockDespues)
          .query(`INSERT INTO ${MOV}(codigo_barras,tipo,cantidad,ubicacion,stock_antes,stock_despues,fecha)
                  VALUES(@codigo,'entrada',@cantidad,@ubicacion,@stockAntes,@stockDespues,GETDATE())`)
      }
      await t.commit()
    } catch (err) { await t.rollback(); throw err }

    // Best-effort: avisar al admin para que lo vea y le ponga precio. No bloquea.
    registrarPendienteAdmin({ codigo, nombre, qty, piezas_por_caja, proveedor }).catch(() => {})

    res.json({ ok: true, stockActual: stockDespues, mensaje: 'Producto nuevo registrado' })
  } catch (err) {
    console.error('producto-nuevo:', err.message)
    res.status(500).json({ mensaje: err.message })
  }
})

// Crea + resuelve el pendiente en el admin (SQLite) para que aparezca en el panel
// y se le pueda poner precio. Si el admin no responde, no afecta el stock.
async function registrarPendienteAdmin({ codigo, nombre, qty, piezas_por_caja, proveedor }) {
  const post = async (path, body) => {
    const r = await fetch(ADMIN_API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return r.ok ? r.json() : null
  }
  const creado = await post('/api/almacen/productos-pendientes', {
    descripcion_proveedor: nombre,
    proveedor: proveedor || null,
    piezas_por_caja: parseInt(piezas_por_caja) || 1,
    cajas: qty,
    origen: 'tc52',
  })
  const id = creado?.id
  if (id) {
    await post(`/api/almacen/productos-pendientes/${id}/resolver`, {
      codigo_barras: codigo,
      piezas_por_caja: parseInt(piezas_por_caja) || 1,
    })
  }
}

// ── POST /api/almacen/salida ───────────────────────────────────────────────────
app.post('/api/almacen/salida', async (req, res) => {
  const { codigo, cantidad, ubicacion } = req.body
  const ubic = normUbic(ubicacion)
  if (!codigo || !cantidad || cantidad <= 0)
    return res.status(400).json({ mensaje: 'Datos inválidos' })
  try {
    const db = await getPool()
    // Resolver código escaneado → base + piezas (si es código de caja, multiplica)
    const { codigo_base, unidades } = await resolverCodigo(db, codigo)
    const piezas = cantidad * unidades
    const nombre = await getNombre(db, codigo_base)
    if (!nombre) return res.status(404).json({ mensaje: 'Producto no encontrado' })

    if (!adquirirLock(codigo_base, `salida:${ubic}`))
      return res.json({ ok: true, stockActual: await getStock(db, codigo_base), mensaje: 'Salida registrada' })

    // Verificar stock en la ubicación especificada (en piezas)
    let stockEnUbic = await getStockEnUbic(db, codigo_base, ubic)

    // Si no hay stock en esa ubicación, buscar en la primera que tenga suficiente
    if (stockEnUbic < piezas) {
      const stockTotal = await getStock(db, codigo_base)
      if (stockTotal < piezas)
        return res.status(400).json({ mensaje: `Stock insuficiente. Total disponible: ${stockTotal} pzas` })

      // Tomar de la ubicación con más stock
      const r = await db.request()
        .input('codigo', sql.VarChar(50), codigo_base)
        .query(`SELECT TOP 1 ubicacion, cantidad FROM ${INV}
                WHERE codigo_barras=@codigo AND cantidad>0
                ORDER BY cantidad DESC`)
      if (!r.recordset[0] || r.recordset[0].cantidad < piezas)
        return res.status(400).json({ mensaje: `Stock insuficiente en ${ubic}. Disponible: ${stockEnUbic} pzas` })

      const ubicReal = r.recordset[0].ubicacion
      stockEnUbic = r.recordset[0].cantidad
      return doSalida(db, codigo_base, piezas, ubicReal, stockEnUbic, res)
    }

    return doSalida(db, codigo_base, piezas, ubic, stockEnUbic, res)
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
    // Decremento atómico: solo descuenta si REALMENTE hay suficiente.
    // Evita stock negativo aunque la verificación previa quedara desfasada.
    const upd = await t.request()
      .input('codigo',    sql.VarChar(50), codigo)
      .input('cantidad',  sql.Int,         cantidad)
      .input('ubicacion', sql.VarChar(50), ubic)
      .query(`UPDATE ${INV} SET cantidad=cantidad-@cantidad, ultima_salida=GETDATE()
              WHERE codigo_barras=@codigo AND ubicacion=@ubicacion AND cantidad>=@cantidad`)
    if (upd.rowsAffected[0] === 0) {
      await t.rollback()
      return res.status(400).json({ mensaje: `Stock insuficiente en ${ubic}. Hay ${stockEnUbic} pzas y se intentó sacar ${cantidad}.` })
    }
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
  const ubic = normUbic(ubicacion)
  if (!codigo || !cantidad || cantidad <= 0)
    return res.status(400).json({ mensaje: 'Datos inválidos' })
  try {
    const db = await getPool()
    const { codigo_base, unidades } = await resolverCodigo(db, codigo)
    const piezas = cantidad * unidades
    const nombre = await getNombre(db, codigo_base)
    if (!nombre) return res.status(404).json({ mensaje: 'Producto no encontrado' })

    if (!adquirirLock(codigo_base, `merma:${ubic}`))
      return res.json({ ok: true, stockActual: await getStock(db, codigo_base), mensaje: 'Merma registrada' })

    let stockEnUbic = await getStockEnUbic(db, codigo_base, ubic)
    if (stockEnUbic < piezas) {
      // Fallback: usar la ubicación con más stock
      const r = await db.request()
        .input('codigo', sql.VarChar(50), codigo_base)
        .query(`SELECT TOP 1 ubicacion, cantidad FROM ${INV}
                WHERE codigo_barras=@codigo AND cantidad>0
                ORDER BY cantidad DESC`)
      const alt = r.recordset[0]
      if (!alt || alt.cantidad < piezas)
        return res.status(400).json({ mensaje: `Stock insuficiente. Disponible: ${await getStock(db, codigo_base)} pzas` })
      stockEnUbic = alt.cantidad
      return doMerma(db, codigo_base, piezas, alt.ubicacion, motivo, notas, res)
    }
    return doMerma(db, codigo_base, piezas, ubic, motivo, notas, res)
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
    const upd = await t.request()
      .input('codigo',    sql.VarChar(50), codigo)
      .input('cantidad',  sql.Int,         cantidad)
      .input('ubicacion', sql.VarChar(50), ubic)
      .query(`UPDATE ${INV} SET cantidad=cantidad-@cantidad, ultima_salida=GETDATE()
              WHERE codigo_barras=@codigo AND ubicacion=@ubicacion AND cantidad>=@cantidad`)
    if (upd.rowsAffected[0] === 0) {
      await t.rollback()
      return res.status(400).json({ mensaje: `Stock insuficiente en ${ubic} para la merma de ${cantidad} pzas.` })
    }
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
    // 1. Movimientos del día (acotado: evita timeouts si hubo un traslado masivo)
    const movRes = await db.request().query(`
      SELECT TOP 250 m.id, m.codigo_barras AS codigo, m.tipo, m.cantidad,
             ISNULL(m.stock_antes,0)          AS stock_antes,
             ISNULL(m.stock_despues,0)        AS stock_despues,
             CONVERT(VARCHAR(23),m.fecha,120) AS fecha,
             m.ubicacion
      FROM ${MOV} m
      WHERE CAST(m.fecha AS DATE)=CAST(GETDATE() AS DATE)
      ORDER BY m.fecha DESC`)
    const movs = movRes.recordset
    if (movs.length === 0) return res.json([])

    // 2. Resolver nombres EN LOTE (1 consulta a INV + 1 a NovaCaja, no por fila)
    const codes = [...new Set(movs.map(m => m.codigo))]
    const inList = codes.map(c => `'${String(c).replace(/'/g, "''")}'`).join(',')
    const nombreInv = {}, nombreVista = {}
    try {
      const r = await db.request().query(`
        SELECT codigo_barras, MAX(nombre) AS nombre FROM ${INV}
        WHERE codigo_barras IN (${inList}) AND nombre IS NOT NULL AND nombre<>''
        GROUP BY codigo_barras`)
      for (const row of r.recordset) nombreInv[row.codigo_barras] = row.nombre
    } catch {}
    try {
      const r = await db.request().query(`
        SELECT Art_GTIN, CodAlt_Codigo, Art_Descripcion FROM ${VISTA}
        WHERE Art_GTIN IN (${inList}) OR CodAlt_Codigo IN (${inList})`)
      for (const row of r.recordset) {
        if (row.Art_GTIN)      nombreVista[row.Art_GTIN]      = row.Art_Descripcion
        if (row.CodAlt_Codigo) nombreVista[row.CodAlt_Codigo] = row.Art_Descripcion
      }
    } catch {}

    res.json(movs.map(m => ({
      id: m.id, codigo: m.codigo,
      nombre: nombreInv[m.codigo] || nombreVista[m.codigo] || m.codigo,
      es_bodega: 1,
      tipo: m.tipo, cantidad: m.cantidad,
      stock_antes: m.stock_antes, stock_despues: m.stock_despues,
      usuario: '', fecha: m.fecha, ubicacion: m.ubicacion,
    })))
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
          ISNULL((
            SELECT TOP 1 nombre FROM ${INV}
            WHERE (codigo_barras = v.Art_GTIN OR codigo_barras = v.CodAlt_Codigo)
              AND nombre IS NOT NULL AND nombre<>''
          ), v.Art_Descripcion)      AS nombre,
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

    // 2. Desglose por ubicación — AGREGADO por ubicación y consistente con el total.
    //    Una misma fila puede pertenecer a varios productos que comparten código
    //    (GTIN/alterno); cada producto suma sus filas por ubicación, y su total es
    //    exactamente la suma de esos chips (chips y total SIEMPRE cuadran).
    const locByProd = {}  // codigo -> { ubicacion -> {ubicacion,cantidad,color} }
    if (products.length > 0) try {
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
        WHERE i.codigo_barras IN (${[...allCodes].join(',')}) AND i.cantidad>0`)
      for (const row of locResult.recordset) {
        for (const p of products) {
          if (p.codigo !== row.codigo_barras && p.codigo_alt !== row.codigo_barras) continue
          if (!locByProd[p.codigo]) locByProd[p.codigo] = {}
          const m = locByProd[p.codigo]
          if (!m[row.ubicacion]) m[row.ubicacion] = { ubicacion: row.ubicacion, cantidad: 0, color: row.color }
          m[row.ubicacion].cantidad += row.cantidad
        }
      }
    } catch {}

    const fromVista = products.map(p => {
      const locs = Object.values(locByProd[p.codigo] ?? {}).sort((a, b) => b.cantidad - a.cantidad)
      const stock = locs.reduce((s, l) => s + l.cantidad, 0)
      return { codigo: p.codigo, nombre: p.nombre, stock, stockPorUbicacion: locs }
    })

    // 3. Productos de la bodega que NO existen en NovaCaja (con o sin nombre).
    //    Incluye los "sin nombre" (se muestran con su código) para que sí se
    //    encuentren y luego se les pueda corregir el nombre con 🏷️.
    let nuevos = []
    try {
      const nuevosRes = await db.request()
        .input('q', sql.NVarChar(100), `%${q}%`)
        .query(`
          SELECT i.codigo_barras, i.nombre, ISNULL(i.ubicacion,'Bodega') AS ubicacion,
                 i.cantidad, ISNULL(u.color,'#6B7280') AS color
          FROM ${INV} i
          LEFT JOIN ${UBIC} u ON u.nombre=ISNULL(i.ubicacion,'Bodega') AND u.activa=1
          WHERE i.cantidad>0
            AND (i.codigo_barras LIKE @q OR (i.nombre IS NOT NULL AND i.nombre LIKE @q))
            AND NOT EXISTS (SELECT 1 FROM ${VISTA} v
                            WHERE v.Art_GTIN=i.codigo_barras OR v.CodAlt_Codigo=i.codigo_barras OR v.Art_Codigo=i.codigo_barras)
          ORDER BY i.codigo_barras, i.cantidad DESC`)
      const map = {}
      for (const row of nuevosRes.recordset) {
        if (!map[row.codigo_barras])
          map[row.codigo_barras] = { codigo: row.codigo_barras, nombre: row.nombre || row.codigo_barras, stock: 0, stockPorUbicacion: [] }
        const m = map[row.codigo_barras]
        m.stock += row.cantidad
        const ex = m.stockPorUbicacion.find(x => x.ubicacion === row.ubicacion)
        if (ex) ex.cantidad += row.cantidad
        else m.stockPorUbicacion.push({ ubicacion: row.ubicacion, cantidad: row.cantidad, color: row.color })
      }
      nuevos = Object.values(map)
    } catch {}

    // 4. Adjuntar piezas_por_caja (tamaño de la caja) a cada producto, para que el
    //    front muestre "= X cajas + Y sueltas". Se busca por el código del producto.
    const todos = [...fromVista, ...nuevos]
    try {
      const cods = new Set()
      for (const p of todos) {
        if (p.codigo)     cods.add(`'${String(p.codigo).replace(/'/g, "''")}'`)
        if (p.codigo_alt) cods.add(`'${String(p.codigo_alt).replace(/'/g, "''")}'`)
      }
      if (cods.size > 0) {
        const r = await db.request().query(`
          SELECT codigo_base, MAX(unidades) AS ppc FROM ${COD}
          WHERE tipo='caja' AND unidades>1 AND codigo_base IN (${[...cods].join(',')})
          GROUP BY codigo_base`)
        const ppcMap = {}
        for (const row of r.recordset) ppcMap[row.codigo_base] = row.ppc
        for (const p of todos) p.piezas_por_caja = ppcMap[p.codigo] || ppcMap[p.codigo_alt] || 1
      }
    } catch {}

    res.json(todos)
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
    const { codigo_base, unidades } = await resolverCodigo(db, codigo)
    const piezas = cantidad * unidades
    const nombre = await getNombre(db, codigo_base)
    if (!nombre) return res.status(404).json({ mensaje: 'Producto no encontrado' })

    if (!adquirirLock(codigo_base, `traslado:${de_ubicacion}:${a_ubicacion}`))
      return res.json({ ok: true, mensaje: 'Traslado registrado' })

    // Buscar el stock en el origen — también acepta filas con ubicacion NULL (como 'Bodega')
    const stockOrigenRes = await db.request()
      .input('codigo',    sql.VarChar(50), codigo_base)
      .input('ubicacion', sql.VarChar(50), de_ubicacion)
      .query(`SELECT ISNULL(SUM(cantidad),0) AS stock FROM ${INV}
              WHERE codigo_barras=@codigo
                AND (ubicacion=@ubicacion OR (ubicacion IS NULL AND @ubicacion='Bodega'))`)
    const stockOrigen = stockOrigenRes.recordset[0]?.stock ?? 0

    if (stockOrigen < piezas)
      return res.status(400).json({ mensaje: `Stock insuficiente en ${de_ubicacion}. Disponible: ${stockOrigen} pzas` })

    const t = db.transaction()
    await t.begin()
    try {
      // Restar del origen — atómico: solo si esa ubicación tiene suficiente.
      const updOrigen = await t.request()
        .input('codigo',    sql.VarChar(50), codigo_base)
        .input('cantidad',  sql.Int,         piezas)
        .input('ubicacion', sql.VarChar(50), de_ubicacion)
        .query(`UPDATE ${INV} SET cantidad=cantidad-@cantidad, ultima_salida=GETDATE()
                WHERE codigo_barras=@codigo AND cantidad>=@cantidad
                  AND (ubicacion=@ubicacion OR (ubicacion IS NULL AND @ubicacion='Bodega'))`)
      if (updOrigen.rowsAffected[0] === 0) {
        await t.rollback()
        return res.status(400).json({ mensaje: `Stock insuficiente en ${de_ubicacion}. Disponible: ${stockOrigen} pzas` })
      }
      // Sumar al destino
      await t.request()
        .input('codigo',    sql.VarChar(50), codigo_base)
        .input('cantidad',  sql.Int,         piezas)
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
        .input('codigo',    sql.VarChar(50), codigo_base)
        .input('cantidad',  sql.Int,         piezas)
        .input('de_ubic',   sql.VarChar(50), de_ubicacion)
        .input('a_ubic',    sql.VarChar(50), a_ubicacion)
        .query(`INSERT INTO ${MOV}(codigo_barras,tipo,cantidad,ubicacion,area,fecha)
                VALUES(@codigo,'traslado',@cantidad,@a_ubic,@de_ubic,GETDATE())`)
      await t.commit()
    } catch (err) { await t.rollback(); throw err }

    res.json({ ok: true, stockActual: await getStock(db, codigo_base), mensaje: `Traslado: ${piezas} pzas de ${de_ubicacion} → ${a_ubicacion}` })
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
    // Traslado y ajuste no se editan por cantidad (su efecto no es un simple +/-).
    if (tipo === 'traslado' || tipo === 'ajuste')
      return res.status(400).json({ mensaje: 'Este movimiento no se puede editar la cantidad. Si está mal, bórralo.' })
    const diferencia = nuevaCantidad - cantVieja
    if (diferencia === 0) return res.json({ ok: true, mensaje: 'Sin cambios' })

    const ajuste = tipo === 'entrada' ? diferencia : -diferencia

    // Todo dentro de una transacción con decremento atómico (no deja negativo)
    const t = db.transaction()
    await t.begin()
    try {
      const upd = await t.request()
        .input('codigo', sql.VarChar(50), codigo_barras)
        .input('ubicacion', sql.VarChar(50), ubicacion)
        .input('ajuste', sql.Int, ajuste)
        .query(`UPDATE ${INV} SET cantidad=cantidad+@ajuste
                WHERE codigo_barras=@codigo AND ubicacion=@ubicacion AND cantidad+@ajuste>=0`)
      if (upd.rowsAffected[0] === 0) {
        await t.rollback()
        return res.status(400).json({ mensaje: `El stock quedaría negativo en ${ubicacion}.` })
      }
      await t.request()
        .input('id', sql.Int, id)
        .input('nuevaCantidad', sql.Int, nuevaCantidad)
        .query(`UPDATE ${MOV} SET cantidad=@nuevaCantidad WHERE id=@id`)
      await t.commit()
    } catch (err) { await t.rollback(); throw err }

    res.json({ ok: true, mensaje: 'Corregido' })
  } catch (err) {
    console.error('editar movimiento:', err.message)
    res.status(500).json({ mensaje: err.message })
  }
})

// Suma cantidad a una ubicación dentro de una transacción (crea la fila si falta)
async function sumarUbicTx(t, codigo, ubic, cantidad) {
  if (cantidad <= 0) return
  await t.request()
    .input('codigo',    sql.VarChar(50), codigo)
    .input('ubicacion', sql.VarChar(50), ubic)
    .input('cantidad',  sql.Int,         cantidad)
    .query(`
      MERGE ${INV} AS target
      USING (SELECT @codigo AS codigo_barras, @ubicacion AS ubicacion) AS src
        ON target.codigo_barras=src.codigo_barras AND target.ubicacion=src.ubicacion
      WHEN MATCHED THEN UPDATE SET cantidad=target.cantidad+@cantidad, ultima_entrada=GETDATE()
      WHEN NOT MATCHED THEN INSERT (codigo_barras,ubicacion,cantidad,ultima_entrada)
        VALUES (@codigo,@ubicacion,@cantidad,GETDATE());`)
}

// Quita hasta `cantidad` de UNA ubicación, sin pasar de 0. Devuelve lo quitado.
async function quitarUbicTx(t, codigo, ubic, cantidad) {
  if (cantidad <= 0) return 0
  const r = await t.request()
    .input('codigo', sql.VarChar(50), codigo).input('ubicacion', sql.VarChar(50), ubic)
    .query(`SELECT ISNULL(SUM(cantidad),0) AS s FROM ${INV} WHERE codigo_barras=@codigo AND ubicacion=@ubicacion`)
  const quitar = Math.min(r.recordset[0]?.s ?? 0, cantidad)
  if (quitar > 0) {
    await t.request()
      .input('codigo', sql.VarChar(50), codigo).input('ubicacion', sql.VarChar(50), ubic).input('q', sql.Int, quitar)
      .query(`UPDATE ${INV} SET cantidad=cantidad-@q, ultima_salida=GETDATE()
              WHERE codigo_barras=@codigo AND ubicacion=@ubicacion`)
  }
  return quitar
}

// Quita `cantidad` del producto: primero de la ubicación preferida y, si no
// alcanza (porque ya se movió), del resto (más stock primero). Nunca deja negativo.
async function quitarProductoTx(t, codigo, ubicPreferida, cantidad) {
  let restante = cantidad - await quitarUbicTx(t, codigo, ubicPreferida, cantidad)
  while (restante > 0) {
    const r = await t.request().input('codigo', sql.VarChar(50), codigo)
      .query(`SELECT TOP 1 ubicacion FROM ${INV} WHERE codigo_barras=@codigo AND cantidad>0 ORDER BY cantidad DESC`)
    const ubic = r.recordset[0]?.ubicacion
    if (!ubic) break
    const q = await quitarUbicTx(t, codigo, ubic, restante)
    if (q <= 0) break
    restante -= q
  }
}

// ── DELETE /api/almacen/movimientos/:id — borrar y revertir su efecto en stock ─
// Siempre se puede borrar: revierte lo que se pueda sin dejar stock negativo.
app.delete('/api/almacen/movimientos/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  if (isNaN(id)) return res.status(400).json({ mensaje: 'ID inválido' })
  try {
    const db = await getPool()
    const r = await db.request().input('id', sql.Int, id)
      .query(`SELECT codigo_barras, tipo, cantidad,
                     ISNULL(ubicacion,'Bodega') AS ubicacion,
                     ISNULL(area,'Bodega')      AS area
              FROM ${MOV} WHERE id=@id`)
    const mov = r.recordset[0]
    if (!mov) return res.status(404).json({ mensaje: 'Movimiento no encontrado' })
    const { codigo_barras, tipo, cantidad, ubicacion, area } = mov

    const t = db.transaction()
    await t.begin()
    try {
      if (tipo === 'ajuste') {
        // 'ajuste' es solo un registro de auditoría del reajuste; borrarlo NO revierte
        // el stock (no tiene una dirección simple). Solo se elimina la fila del historial.
      } else if (tipo === 'salida' || tipo === 'merma') {
        // Devolver el stock a su ubicación
        await sumarUbicTx(t, codigo_barras, ubicacion, cantidad)
      } else if (tipo === 'traslado') {
        // Regresar al origen lo que todavía quede en el destino (ubicacion=destino, area=origen)
        const movido = await quitarUbicTx(t, codigo_barras, ubicacion, cantidad)
        await sumarUbicTx(t, codigo_barras, area, movido)
      } else {
        // entrada (o cualquier otro tipo que sume): quitar del producto sin dejar negativo
        await quitarProductoTx(t, codigo_barras, ubicacion, cantidad)
      }
      await t.request().input('id', sql.Int, id).query(`DELETE FROM ${MOV} WHERE id=@id`)
      await t.commit()
    } catch (err) { await t.rollback(); throw err }

    res.json({ ok: true, stockActual: await getStock(db, codigo_barras), mensaje: 'Movimiento borrado' })
  } catch (err) {
    console.error('borrar movimiento:', err.message)
    res.status(500).json({ mensaje: err.message })
  }
})

// ── POST /api/almacen/producto/:codigo/nombre — corregir el nombre ─────────────
// Solo afecta productos que la bodega maneja por su cuenta (guardados en
// inventario_bodega). Rechaza nombres que sean solo números (eso es un código).
app.post('/api/almacen/producto/:codigo/nombre', async (req, res) => {
  const codigo = String(req.params.codigo || '').trim()
  const nombre = String(req.body?.nombre || '').trim()
  if (!codigo) return res.status(400).json({ mensaje: 'Código inválido' })
  if (nombre.length < 3) return res.status(400).json({ mensaje: 'El nombre debe tener al menos 3 letras' })
  if (/^[\d\s.-]+$/.test(nombre)) return res.status(400).json({ mensaje: 'El nombre no puede ser solo números (eso es un código)' })
  try {
    const db = await getPool()
    // Aplica el nombre a TODAS las filas del producto (todas las ubicaciones)
    const r = await db.request()
      .input('codigo', sql.VarChar(50),  codigo)
      .input('nombre', sql.VarChar(200), nombre)
      .query(`UPDATE ${INV} SET nombre=@nombre WHERE codigo_barras=@codigo`)
    // Si no había ninguna fila (producto sin stock en bodega), crea una en blanco
    // solo para guardar el nombre corregido (cantidad 0, no afecta inventario).
    if (r.rowsAffected[0] === 0) {
      await db.request()
        .input('codigo', sql.VarChar(50),  codigo)
        .input('nombre', sql.VarChar(200), nombre)
        .query(`
          MERGE ${INV} AS target
          USING (SELECT @codigo AS codigo_barras, 'Bodega' AS ubicacion) AS src
            ON target.codigo_barras=src.codigo_barras AND target.ubicacion=src.ubicacion
          WHEN MATCHED THEN UPDATE SET nombre=@nombre
          WHEN NOT MATCHED THEN INSERT (codigo_barras,ubicacion,cantidad,nombre)
            VALUES (@codigo,'Bodega',0,@nombre);`)
    }
    res.json({ ok: true, nombre, mensaje: 'Nombre actualizado' })
  } catch (err) {
    console.error('editar nombre:', err.message)
    res.status(500).json({ mensaje: err.message })
  }
})

// ── POST /api/almacen/codigos/vincular — ligar un código de caja a un producto ─
// Body: { codigo_base, codigo_caja, piezas_por_caja }. El stock vive en piezas
// bajo codigo_base; el código de caja representa N piezas.
app.post('/api/almacen/codigos/vincular', async (req, res) => {
  const codigoBase = String(req.body?.codigo_base || '').trim()
  const codigoCaja = String(req.body?.codigo_caja || '').trim()
  const ppc = Math.max(2, parseInt(req.body?.piezas_por_caja) || 0)
  if (!codigoBase || !codigoCaja) return res.status(400).json({ mensaje: 'Falta el código base o el de la caja' })
  if (codigoBase === codigoCaja)  return res.status(400).json({ mensaje: 'El código de la caja debe ser diferente al individual' })
  if (!(ppc >= 2)) return res.status(400).json({ mensaje: 'Las piezas por caja deben ser 2 o más' })
  try {
    const db = await getPool()
    if (!adquirirLock(codigoBase, `vincular:${codigoCaja}`))
      return res.json({ ok: true, piezas_por_caja: ppc, mensaje: 'Vinculación en curso' })
    // El producto base debe existir (tener nombre/stock) — evita códigos huérfanos
    const nombreBase = await getNombre(db, codigoBase)
    if (!nombreBase)
      return res.status(400).json({ mensaje: 'El producto base no existe en la bodega. Regístralo primero en Nuevos.' })
    // No permitir vincular como caja un código que ya tiene stock propio (sería otro producto)
    const yaTiene = await getStock(db, codigoCaja)
    if (yaTiene > 0)
      return res.status(400).json({ mensaje: `Ese código ya tiene stock propio (${yaTiene}); no se puede usar como código de caja.` })
    const t = db.transaction()
    await t.begin()
    try {
      await upsertCodigo(t, { codigo: codigoBase, codigo_base: codigoBase, unidades: 1, tipo: 'individual', nombre: nombreBase })
      await upsertCodigo(t, { codigo: codigoCaja, codigo_base: codigoBase, unidades: ppc, tipo: 'caja', nombre: nombreBase })
      await t.commit()
    } catch (err) { await t.rollback(); throw err }
    res.json({ ok: true, piezas_por_caja: ppc, mensaje: `Caja vinculada: 1 caja = ${ppc} piezas` })
  } catch (err) {
    console.error('vincular codigo:', err.message)
    res.status(500).json({ mensaje: err.message })
  }
})

// ── POST /api/almacen/codigos/:codigo/reinterpretar — corregir stock mal contado ─
// Multiplica el stock actual del producto por un factor (ej. ×12 cuando se
// registraron cajas como si fueran piezas). Deja un movimiento 'ajuste'.
app.post('/api/almacen/codigos/:codigo/reinterpretar', async (req, res) => {
  const codigo = String(req.params.codigo || '').trim()
  const factor = Math.round(Number(req.body?.factor))
  if (!codigo) return res.status(400).json({ mensaje: 'Código inválido' })
  if (!(factor >= 2)) return res.status(400).json({ mensaje: 'El factor debe ser un número entero de 2 o más (las piezas que trae la caja)' })
  try {
    const db = await getPool()
    const { codigo_base } = await resolverCodigo(db, codigo)
    if (!adquirirLock(codigo_base, 'reinterpretar'))
      return res.json({ ok: true, mensaje: 'Operación en curso' })

    const rows = (await db.request().input('codigo', sql.VarChar(50), codigo_base)
      .query(`SELECT ubicacion, cantidad FROM ${INV} WHERE codigo_barras=@codigo AND cantidad>0`)).recordset
    if (rows.length === 0) return res.status(400).json({ mensaje: 'Este producto no tiene stock para reajustar' })

    const t = db.transaction()
    await t.begin()
    try {
      for (const r of rows) {
        const nuevo = Math.round(r.cantidad * factor)
        const delta = nuevo - r.cantidad
        await t.request()
          .input('codigo', sql.VarChar(50), codigo_base)
          .input('ubic',   sql.VarChar(50), r.ubicacion)
          .input('nuevo',  sql.Int,         nuevo)
          .query(`UPDATE ${INV} SET cantidad=@nuevo WHERE codigo_barras=@codigo AND ubicacion=@ubic`)
        await t.request()
          .input('codigo', sql.VarChar(50), codigo_base)
          .input('delta',  sql.Int,         Math.abs(delta))
          .input('ubic',   sql.VarChar(50), r.ubicacion)
          .input('notas',  sql.VarChar(200), `Reajuste ×${factor}: ${r.cantidad} → ${nuevo}`)
          .query(`INSERT INTO ${MOV}(codigo_barras,tipo,cantidad,ubicacion,notas,fecha)
                  VALUES(@codigo,'ajuste',@delta,@ubic,@notas,GETDATE())`)
      }
      await t.commit()
    } catch (err) { await t.rollback(); throw err }

    res.json({ ok: true, stockActual: await getStock(db, codigo_base), mensaje: `Stock reajustado ×${factor}` })
  } catch (err) {
    console.error('reinterpretar:', err.message)
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

// Borrar ubicaciones quedó DESHABILITADO: borrar áreas (p.ej. 'Bodega') causaba
// que el stock cayera en 'Sin ubicar' y se descuadrara el inventario.
app.delete('/api/almacen/ubicaciones/areas/:id', async (_req, res) => {
  return res.status(403).json({ mensaje: 'Borrar ubicaciones está deshabilitado' })
})

// ── POST /api/almacen/ubicaciones/mover — mover TODO el stock de un área a otra ─
// Sirve para corregir áreas creadas por error (p.ej. 'Bogeda' → 'Bodega').
const AREAS_FIJAS = ['Bodega', 'Casita 1', 'Casita 2', 'USA', 'Cocina', 'Refrigerador']
app.post('/api/almacen/ubicaciones/mover', async (req, res) => {
  const de = String(req.body?.de || '').trim()
  const a  = normUbic(req.body?.a)
  const eliminarOrigen = req.body?.eliminarOrigen !== false
  if (!de || !a)   return res.status(400).json({ mensaje: 'Falta origen o destino' })
  if (de === a)    return res.status(400).json({ mensaje: 'El origen y el destino deben ser diferentes' })
  try {
    const db = await getPool()
    const cnt = await db.request().input('de', sql.VarChar(50), de)
      .query(`SELECT COUNT(*) AS productos, ISNULL(SUM(cantidad),0) AS piezas
              FROM ${INV} WHERE ubicacion=@de AND cantidad>0`)
    const productos = cnt.recordset[0]?.productos ?? 0
    const piezas    = cnt.recordset[0]?.piezas ?? 0

    const t = db.transaction()
    await t.begin()
    try {
      // 1. Registrar el traslado de cada producto (para el Historial / trazabilidad)
      await t.request().input('de', sql.VarChar(50), de).input('a', sql.VarChar(50), a)
        .query(`INSERT INTO ${MOV}(codigo_barras,tipo,cantidad,ubicacion,area,fecha)
                SELECT codigo_barras,'traslado',cantidad,@a,@de,GETDATE()
                FROM ${INV} WHERE ubicacion=@de AND cantidad>0`)
      // 2. Sumar al destino (junta cantidades si el producto ya existía allá)
      await t.request().input('de', sql.VarChar(50), de).input('a', sql.VarChar(50), a)
        .query(`MERGE ${INV} AS tgt
                USING (SELECT codigo_barras, cantidad, nombre FROM ${INV} WHERE ubicacion=@de AND cantidad>0) AS src
                  ON tgt.codigo_barras=src.codigo_barras AND tgt.ubicacion=@a
                WHEN MATCHED THEN
                  UPDATE SET cantidad=tgt.cantidad+src.cantidad, ultima_entrada=GETDATE(),
                             nombre=ISNULL(NULLIF(tgt.nombre,''),src.nombre)
                WHEN NOT MATCHED THEN
                  INSERT (codigo_barras,ubicacion,cantidad,nombre,ultima_entrada)
                  VALUES (src.codigo_barras,@a,src.cantidad,src.nombre,GETDATE());`)
      // 3. Vaciar el origen
      await t.request().input('de', sql.VarChar(50), de)
        .query(`DELETE FROM ${INV} WHERE ubicacion=@de`)
      // 4. Quitar el área de origen si se pidió y NO es una de las fijas
      const quitada = eliminarOrigen && !AREAS_FIJAS.includes(de)
      if (quitada) {
        await t.request().input('de', sql.VarChar(50), de)
          .query(`UPDATE ${UBIC} SET activa=0 WHERE nombre=@de`)
      }
      await t.commit()
      res.json({ ok: true, productos, piezas, quitada,
                 mensaje: `Se movieron ${piezas} pzas (${productos} productos) de ${de} a ${a}` })
    } catch (err) { await t.rollback(); throw err }
  } catch (err) {
    console.error('mover ubicacion:', err.message)
    res.status(500).json({ mensaje: err.message })
  }
})

// ── GET /api/almacen/inventario — todo el stock por producto y ubicación ───────
app.get('/api/almacen/inventario', async (_req, res) => {
  try {
    const db = await getPool()
    const result = await db.request().query(`
      SELECT
        i.codigo_barras                                          AS codigo,
        ISNULL(NULLIF(i.nombre,''), ISNULL(v.Art_Descripcion, i.codigo_barras)) AS nombre,
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

// ── Proxy a la API admin (recepción por cajas + productos pendientes) ─────────
// Estas rutas viven solo en lacasitadeli-admin/apps/api (puerto 3002). El TC52
// las consume a través de aquí, así no hay otra URL ni CORS que configurar.
// Si la API admin no responde -> 502.
const ADMIN_API = process.env.ADMIN_API_URL || 'http://localhost:3002'
async function proxyAdmin(req, res) {
  try {
    const opts = { method: req.method, headers: {} }
    if (!['GET', 'HEAD'].includes(req.method)) {
      opts.headers['Content-Type'] = 'application/json'
      opts.body = JSON.stringify(req.body ?? {})
    }
    const r = await fetch(ADMIN_API + req.originalUrl, opts)
    const text = await r.text()
    res.status(r.status)
       .set('Content-Type', r.headers.get('content-type') || 'application/json')
       .send(text)
  } catch (e) {
    res.status(502).json({ mensaje: 'API admin no disponible: ' + e.message })
  }
}
app.use('/api/recepcion', proxyAdmin)
app.all('/api/almacen/productos-pendientes', proxyAdmin)
app.all('/api/almacen/productos-pendientes/*', proxyAdmin)
app.all('/api/almacen/buscar-coincidencias', proxyAdmin)

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
