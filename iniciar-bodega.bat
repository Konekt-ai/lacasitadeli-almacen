@echo off
title Bodega TC52
echo.
echo  [1/2] Compilando app...
cd /d "%~dp0pwa-bodega"

npm run build
if errorlevel 1 (
  echo.
  echo  ERROR: Fallo la compilacion. Revisa los errores de arriba.
  pause
  exit /b 1
)

echo.
echo  [2/2] Iniciando servidor...
echo  Ctrl+C para detener
echo.
node server.js
pause
