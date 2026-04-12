@echo off
setlocal

set "BASE_DIR=%~dp0"
set "PYLAUNCH=py"
set "LAUNCH_SCRIPT=%BASE_DIR%script\draft\scv_editor.py"

if not exist "%LAUNCH_SCRIPT%" (
  echo Could not find the SCV editor launch script here:
  echo %LAUNCH_SCRIPT%
  pause
  exit /b 1
)

where %PYLAUNCH% >nul 2>nul
if errorlevel 1 (
  echo Could not find the Windows Python launcher: %PYLAUNCH%
  echo.
  echo Install Python or update Launch SCV Editor.cmd to point at python.exe.
  pause
  exit /b 1
)

pushd "%BASE_DIR%"
%PYLAUNCH% "%LAUNCH_SCRIPT%"
popd

endlocal
