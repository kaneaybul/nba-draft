@echo off
setlocal

set "BASE_DIR=%~dp0"
set "FRONTEND_DIR=%BASE_DIR%frontend"
set "VITE_SCRIPT=%FRONTEND_DIR%\node_modules\vite\bin\vite.js"
set "URL=http://127.0.0.1:5173/"

if not exist "%FRONTEND_DIR%\package.json" (
  echo Could not find the frontend app here:
  echo %FRONTEND_DIR%
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo Could not find npm.
  echo.
  echo Install Node.js, then run this launcher again.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo Could not find node.
  echo.
  echo Install Node.js, then run this launcher again.
  pause
  exit /b 1
)

if not exist "%VITE_SCRIPT%" (
  echo Could not find Vite here:
  echo %VITE_SCRIPT%
  echo.
  echo From the frontend folder, run: npm install
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { $response = Invoke-WebRequest -UseBasicParsing -Uri '%URL%' -TimeoutSec 1; if ($response.StatusCode -lt 500) { exit 0 } } catch { exit 1 }"

if errorlevel 1 (
  start "NBA Impact Lab Server" /D "%FRONTEND_DIR%" cmd /k node "%VITE_SCRIPT%" --host 127.0.0.1 --port 5173
  timeout /t 3 /nobreak >nul
)

start "" "%URL%"

endlocal
