-- ============================================================
-- Ejecuta esto en SQL Server Management Studio (compucaja)
-- Crea y actualiza tablas de bodega. Seguro de ejecutar múltiples veces.
-- ============================================================
USE [compucaja]
GO

-- ── Tabla de stock ────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='inventario_bodega' AND xtype='U')
BEGIN
    CREATE TABLE inventario_bodega (
      id              INT           IDENTITY(1,1) PRIMARY KEY,
      codigo_barras   VARCHAR(50)   NOT NULL,
      ubicacion       VARCHAR(50)   NOT NULL DEFAULT 'Bodega',
      cantidad        INT           NOT NULL DEFAULT 0,
      ultima_entrada  DATETIME      NULL,
      ultima_salida   DATETIME      NULL,
      creado          DATETIME      NOT NULL DEFAULT GETDATE(),
      CONSTRAINT UQ_inv_codigo_ubicacion UNIQUE (codigo_barras, ubicacion)
    );
    CREATE INDEX ix_inventario_codigo ON inventario_bodega(codigo_barras);
END
GO

-- ── Tabla de movimientos ──────────────────────────────────────────────────────
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='movimientos_bodega' AND xtype='U')
BEGIN
    CREATE TABLE movimientos_bodega (
      id              INT           IDENTITY(1,1) PRIMARY KEY,
      codigo_barras   VARCHAR(50)   NOT NULL,
      tipo            VARCHAR(10)   NOT NULL,
      cantidad        INT           NOT NULL,
      ubicacion       VARCHAR(50)   NULL,
      stock_antes     INT           NULL,
      stock_despues   INT           NULL,
      motivo          VARCHAR(30)   NULL,
      area            VARCHAR(30)   NULL,
      notas           VARCHAR(200)  NULL,
      fecha           DATETIME      NOT NULL DEFAULT GETDATE()
    );
    CREATE INDEX ix_movimientos_codigo ON movimientos_bodega(codigo_barras);
    CREATE INDEX ix_movimientos_fecha  ON movimientos_bodega(fecha);
END
GO

-- ── Agregar columnas nuevas si la tabla ya existía ────────────────────────────
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('movimientos_bodega') AND name = 'stock_antes')
    ALTER TABLE movimientos_bodega ADD stock_antes INT NULL;
GO
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('movimientos_bodega') AND name = 'stock_despues')
    ALTER TABLE movimientos_bodega ADD stock_despues INT NULL;
GO
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('movimientos_bodega') AND name = 'motivo')
    ALTER TABLE movimientos_bodega ADD motivo VARCHAR(30) NULL;
GO
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('movimientos_bodega') AND name = 'area')
    ALTER TABLE movimientos_bodega ADD area VARCHAR(30) NULL;
GO
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('movimientos_bodega') AND name = 'notas')
    ALTER TABLE movimientos_bodega ADD notas VARCHAR(200) NULL;
GO
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('movimientos_bodega') AND name = 'ubicacion')
    ALTER TABLE movimientos_bodega ADD ubicacion VARCHAR(50) NULL;
GO

-- ── Eliminar CHECK constraint de tipo si existe ───────────────────────────────
DECLARE @ck NVARCHAR(255)
SELECT @ck = name FROM sys.check_constraints
WHERE parent_object_id = OBJECT_ID('movimientos_bodega')
IF @ck IS NOT NULL
    EXEC('ALTER TABLE movimientos_bodega DROP CONSTRAINT ' + @ck)
GO

-- ── Tabla de ubicaciones ──────────────────────────────────────────────────────
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='ubicaciones_bodega' AND xtype='U')
BEGIN
    CREATE TABLE ubicaciones_bodega (
      id     INT          IDENTITY(1,1) PRIMARY KEY,
      nombre VARCHAR(50)  NOT NULL UNIQUE,
      color  VARCHAR(7)   NOT NULL DEFAULT '#5F5E5A',
      activa BIT          NOT NULL DEFAULT 1,
      orden  INT          NOT NULL DEFAULT 99
    );
    INSERT INTO ubicaciones_bodega (nombre, color, orden) VALUES
      ('Bodega',       '#1D9E75', 1),
      ('Casita 1',     '#3B82F6', 2),
      ('Casita 2',     '#8B5CF6', 3),
      ('USA',          '#F59E0B', 4),
      ('Cocina',       '#E07B39', 5),
      ('Refrigerador', '#06B6D4', 6);
END
GO

-- ── Actualizar nombres de ubicaciones por defecto si siguen siendo los viejos ─
-- (si ya tienes 'Tienda Casita 1' en vez de 'Casita 1', esto los renombra)
IF EXISTS (SELECT * FROM ubicaciones_bodega WHERE nombre = 'Tienda Casita 1')
    UPDATE ubicaciones_bodega SET nombre = 'Casita 1', color = '#3B82F6', orden = 2 WHERE nombre = 'Tienda Casita 1';
GO
IF EXISTS (SELECT * FROM ubicaciones_bodega WHERE nombre = 'Tienda Casita 2')
    UPDATE ubicaciones_bodega SET nombre = 'Casita 2', color = '#8B5CF6', orden = 3 WHERE nombre = 'Tienda Casita 2';
GO
IF EXISTS (SELECT * FROM ubicaciones_bodega WHERE nombre = 'Otro')
    UPDATE ubicaciones_bodega SET nombre = 'USA', color = '#F59E0B', orden = 4 WHERE nombre = 'Otro';
GO
-- Agregar USA si no existe y no viene del renombrado anterior
IF NOT EXISTS (SELECT * FROM ubicaciones_bodega WHERE nombre = 'USA')
    INSERT INTO ubicaciones_bodega (nombre, color, orden) VALUES ('USA', '#F59E0B', 4);
GO
-- Asegurar que Casita 1 y Casita 2 existen
IF NOT EXISTS (SELECT * FROM ubicaciones_bodega WHERE nombre = 'Casita 1')
    INSERT INTO ubicaciones_bodega (nombre, color, orden) VALUES ('Casita 1', '#3B82F6', 2);
GO
IF NOT EXISTS (SELECT * FROM ubicaciones_bodega WHERE nombre = 'Casita 2')
    INSERT INTO ubicaciones_bodega (nombre, color, orden) VALUES ('Casita 2', '#8B5CF6', 3);
GO

-- ── Migración: columna ubicacion en inventario_bodega ──────────────────────────
-- Paso 1: Agregar columna si no existe
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('inventario_bodega') AND name = 'ubicacion')
BEGIN
    ALTER TABLE inventario_bodega ADD ubicacion VARCHAR(50) NULL;
    UPDATE inventario_bodega SET ubicacion = 'Bodega' WHERE ubicacion IS NULL;
    ALTER TABLE inventario_bodega ALTER COLUMN ubicacion VARCHAR(50) NOT NULL;
END
GO

-- Paso 2: Rellenar NULLs con 'Bodega' (idempotente)
UPDATE inventario_bodega SET ubicacion = 'Bodega' WHERE ubicacion IS NULL OR ubicacion = '';
GO

-- Paso 3: DEFAULT constraint para ubicacion
IF NOT EXISTS (
    SELECT * FROM sys.default_constraints
    WHERE parent_object_id = OBJECT_ID('inventario_bodega') AND name = 'DF_inv_ubicacion'
)
    ALTER TABLE inventario_bodega ADD CONSTRAINT DF_inv_ubicacion DEFAULT 'Bodega' FOR ubicacion;
GO

-- Paso 4: Hacer ubicacion NOT NULL
BEGIN TRY
    ALTER TABLE inventario_bodega ALTER COLUMN ubicacion VARCHAR(50) NOT NULL;
END TRY BEGIN CATCH END CATCH
GO

-- Paso 5: Eliminar índice único antiguo sobre SOLO codigo_barras y agregar compuesto
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE object_id = OBJECT_ID('inventario_bodega') AND name = 'UQ_inv_codigo_ubicacion')
BEGIN
    -- Buscar y eliminar cualquier unique que cubra solo codigo_barras
    DECLARE @dropSql NVARCHAR(MAX) = ''
    SELECT @dropSql = 'ALTER TABLE inventario_bodega DROP CONSTRAINT ' + i.name
    FROM sys.indexes i
    INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
    INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
    WHERE i.object_id = OBJECT_ID('inventario_bodega')
      AND i.is_unique = 1
      AND i.is_primary_key = 0
      AND c.name = 'codigo_barras'
    GROUP BY i.name
    HAVING COUNT(*) = 1

    IF LEN(@dropSql) > 0 EXEC(@dropSql)

    -- Agregar UNIQUE compuesto
    ALTER TABLE inventario_bodega ADD CONSTRAINT UQ_inv_codigo_ubicacion UNIQUE (codigo_barras, ubicacion);
END
GO

-- ── Vista de inventario completo ──────────────────────────────────────────────
IF OBJECT_ID('v_inventario_completo') IS NOT NULL
    DROP VIEW v_inventario_completo;
GO

CREATE VIEW v_inventario_completo AS
SELECT
  v.Art_GTIN                          AS codigo_barras,
  v.Art_Descripcion                   AS nombre,
  ISNULL(totales.cantidad, 0)         AS stock_total,
  totales.ubicaciones
FROM [compucaja].[dbo].[VArticulosUnificados] v
LEFT JOIN (
    SELECT
      codigo_barras,
      SUM(cantidad) AS cantidad,
      COUNT(DISTINCT ubicacion) AS ubicaciones
    FROM inventario_bodega
    GROUP BY codigo_barras
) totales ON totales.codigo_barras = v.Art_GTIN;
GO
