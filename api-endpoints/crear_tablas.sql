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
      codigo_barras   VARCHAR(50)   NOT NULL UNIQUE,
      cantidad        INT           NOT NULL DEFAULT 0,
      ultima_entrada  DATETIME      NULL,
      ultima_salida   DATETIME      NULL,
      creado          DATETIME      NOT NULL DEFAULT GETDATE()
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

-- ── Eliminar CHECK constraint de tipo si excluye 'merma' ─────────────────────
DECLARE @ck NVARCHAR(255)
SELECT @ck = name FROM sys.check_constraints
WHERE parent_object_id = OBJECT_ID('movimientos_bodega')
IF @ck IS NOT NULL
    EXEC('ALTER TABLE movimientos_bodega DROP CONSTRAINT ' + @ck)
GO

-- ── Vista de inventario completo ──────────────────────────────────────────────
IF OBJECT_ID('v_inventario_completo') IS NOT NULL
    DROP VIEW v_inventario_completo;
GO

CREATE VIEW v_inventario_completo AS
SELECT
  v.Art_GTIN                AS codigo_barras,
  v.Art_Descripcion         AS nombre,
  ISNULL(i.cantidad, 0)     AS stock,
  i.ultima_entrada,
  i.ultima_salida
FROM [compucaja].[dbo].[VArticulosUnificados] v
LEFT JOIN inventario_bodega i ON i.codigo_barras = v.Art_GTIN;
GO
