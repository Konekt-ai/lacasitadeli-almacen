@echo off
title Servidor Bodega PWA
cd /d "%~dp0pwa-bodega"

echo Liberando puerto 3003...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3003" ^| findstr "LISTENING" 2^>nul') do (
    taskkill /PID %%a /F >nul 2>&1
)

echo Iniciando servidor...
node server.js
