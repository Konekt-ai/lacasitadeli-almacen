-- ============================================================
-- Ejecuta esto en tu SQL Server Management Studio
-- Crea las dos tablas nuevas sin tocar las de Nova Caja
-- ============================================================

-- Tabla de stock por producto
CREATE TABLE inventario_bodega (
  id              INT           IDENTITY(1,1) PRIMARY KEY,
  codigo_barras   VARCHAR(50)   NOT NULL UNIQUE,
  cantidad        INT           NOT NULL DEFAULT 0,
  ultima_entrada  DATETIME      NULL,
  ultima_salida   DATETIME      NULL,
  creado          DATETIME      NOT NULL DEFAULT GETDATE(),

  CONSTRAINT chk_cantidad_positiva CHECK (cantidad >= 0)
);

-- Índice para búsqueda rápida por código
CREATE INDEX ix_inventario_codigo ON inventario_bodega(codigo_barras);

-- ─────────────────────────────────────────────────────────────

-- Tabla de historial de movimientos
CREATE TABLE movimientos_bodega (
  id              INT           IDENTITY(1,1) PRIMARY KEY,
  codigo_barras   VARCHAR(50)   NOT NULL,
  tipo            VARCHAR(10)   NOT NULL CHECK (tipo IN ('entrada', 'salida')),
  cantidad        INT           NOT NULL CHECK (cantidad > 0),
  fecha           DATETIME      NOT NULL DEFAULT GETDATE(),
  usuario         VARCHAR(50)   NULL      -- opcional: para saber quién hizo el movimiento
);

-- Índices para historial
CREATE INDEX ix_movimientos_codigo ON movimientos_bodega(codigo_barras);
CREATE INDEX ix_movimientos_fecha  ON movimientos_bodega(fecha);

-- ─────────────────────────────────────────────────────────────
-- Vista útil para el panel admin: artículos + su stock actual
-- Ajusta 'articulos', 'codigo_barras' y 'descripcion'
-- a los nombres reales de tu tabla de Nova Caja
-- ─────────────────────────────────────────────────────────────

CREATE VIEW v_inventario_completo AS
SELECT
  a.codigo_barras,
  a.descripcion   AS nombre,
  ISNULL(i.cantidad, 0)       AS stock,
  i.ultima_entrada,
  i.ultima_salida
FROM articulos a
LEFT JOIN inventario_bodega i ON i.codigo_barras = a.codigo_barras;
