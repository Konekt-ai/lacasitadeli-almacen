# PWA Bodega – TC52
Control de inventario para Zebra TC52 vía Progressive Web App.

---

## Estructura de archivos

```
pwa-bodega/                   ← este proyecto (PWA)
├── src/
│   ├── api/inventario.ts     ← cliente HTTP a tu API
│   ├── hooks/useBarcodeScan  ← detecta el scanner automáticamente
│   ├── pages/
│   │   ├── Recepcion.tsx
│   │   ├── Salida.tsx
│   │   └── Historial.tsx
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── .env                      ← pon aquí la IP de tu PC
├── vite.config.ts
└── package.json

api-endpoints/                ← archivos para tu API existente (:3002)
├── inventario.routes.ts      ← pega esto en tu proyecto de API
└── crear_tablas.sql          ← ejecuta esto en SQL Server
```

---

## Paso 1 – SQL Server

Abre SQL Server Management Studio y ejecuta `crear_tablas.sql`.
Ajusta los nombres de columna de la tabla `articulos` de Nova Caja si son diferentes.

---

## Paso 2 – API (:3002)

Instala el driver de SQL Server:
```bash
npm install mssql
npm install -D @types/mssql
```

Pega `inventario.routes.ts` en tu carpeta de rutas y regístralo en tu server principal:
```ts
// En tu server.ts o app.ts existente
import inventarioRouter from './routes/inventario.routes'

app.use('/', inventarioRouter)
```

Agrega las variables de entorno de la BD a tu `.env`:
```env
DB_SERVER=localhost
DB_NAME=TuBaseDeDatos
DB_USER=sa
DB_PASS=tu_password
```

Asegúrate de tener CORS habilitado:
```ts
import cors from 'cors'
app.use(cors({ origin: '*' }))
```

---

## Paso 3 – PWA (este proyecto)

```bash
# Instalar dependencias
npm install

# Cambiar la IP en .env a la IP local de la PC donde corre tu API
# Ejemplo: VITE_API_URL=http://192.168.1.50:3002

# Modo desarrollo (en la misma red que el TC52)
npm run dev
# → disponible en http://TU_IP:3003

# Build para producción
npm run build
# → genera /dist, sírvelo con Express estático o con:
npm run preview
```

---

## Paso 4 – Servir el build con Express

Agrega esto a tu servidor existente en `:3002`, o crea un `server-pwa.ts` en `:3003`:

```ts
import express from 'express'
import path from 'path'

const pwa = express()
pwa.use(express.static(path.join(__dirname, '../pwa-bodega/dist')))
pwa.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../pwa-bodega/dist/index.html'))
})
pwa.listen(3003, '0.0.0.0', () => console.log('PWA en :3003'))
```

---

## Paso 5 – TC52

1. Conectar el TC52 al mismo WiFi que la PC
2. Abrir Chrome en el TC52
3. Ir a `http://192.168.1.X:3003` (la IP de tu PC)
4. Menú de Chrome → "Agregar a pantalla de inicio"
5. Listo — queda como ícono de app

---

## Ajustes de columnas de Nova Caja

Si tu tabla de artículos tiene nombres de columna diferentes, edita
las queries en `inventario.routes.ts`:

| Lo que dice el archivo | Cámbialo por el tuyo |
|---|---|
| `articulos` | nombre de tu tabla |
| `codigo_barras` | columna del código |
| `descripcion` | columna del nombre del producto |
