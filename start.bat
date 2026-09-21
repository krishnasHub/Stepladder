@echo off
rem Foothold - start the dev server and open the game.
rem
rem Usage:  start.bat           pick the first free port from 5199 up
rem         start.bat 5200      use exactly this port, or fail if it is taken
rem         set NO_OPEN=1       start the server without opening a browser
rem
rem Ctrl-C stops the server. cmd.exe will then ask
rem "Terminate batch job (Y/N)?" - that prompt is just Windows tidying up;
rem the server is already stopped by the time you see it.

setlocal enabledelayedexpansion
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed, or is not on your PATH.
  echo Install v18 or newer from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies ^(first run only^)...
  call npm install
  if errorlevel 1 (
    echo npm install failed. Fix the errors above and try again.
    echo.
    pause
    exit /b 1
  )
)

rem An explicit port is a request, so honour it strictly and fail loudly if it
rem is taken. With no port given, find a free one - and leave strictPort off so
rem Vite can still recover if it gets claimed between the check and the bind.
set "REQUESTED=%~1"
set "STRICT="
if not "%REQUESTED%"=="" (
  set "PORT=%REQUESTED%"
  set "STRICT=--strictPort"
) else (
  set "PORT="
  for /f "usebackq delims=" %%i in (`node "%~dp0scripts\find-port.mjs" 5199`) do set "PORT=%%i"
  if "!PORT!"=="" set "PORT=5199"
)

set "OPEN_FLAG=--open"
if "%NO_OPEN%"=="1" set "OPEN_FLAG="

echo.
echo   Foothold  -^>  http://localhost:!PORT!
echo   Ctrl-C to stop.
echo.

rem Foreground on purpose: Ctrl-C reaches Vite directly, so nothing is left
rem holding the port afterwards.
call npx vite --port !PORT! !STRICT! !OPEN_FLAG!

echo.
echo Server stopped.
if not "%REQUESTED%"=="" echo If port !PORT! was in use, run start.bat with no port to pick a free one.
endlocal
