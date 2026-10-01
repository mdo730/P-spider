@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."

set "OUT=hpoi-seed"
set "LOG=%OUT%\_run.log"
if not exist "%OUT%" mkdir "%OUT%"

rem --- via Clash proxy (direct hpoi is blocked) ---
set "NODE_USE_ENV_PROXY=1"
set "HTTP_PROXY=http://127.0.0.1:7897"
set "HTTPS_PROXY=http://127.0.0.1:7897"
set "NO_PROXY=127.0.0.1,localhost"

echo ============================================================
echo   hpoi full seed crawler (via Clash proxy)
echo   Output : %CD%\%OUT%
echo   Log    : %CD%\%LOG%
echo   Resume : close window then double-click again to continue
echo   Stop   : just close this window
echo ============================================================
echo.

:loop
powershell -NoProfile -ExecutionPolicy Bypass -Command "& node 'scripts\build-hpoi-seed.mjs' --types company,series,hobby,works,charactar,person --delay 400 --concurrency 1 %* 2>&1 | Tee-Object -FilePath 'hpoi-seed\_run.log' -Append; exit $LASTEXITCODE"
if errorlevel 1 (
  echo.
  echo [!] Interrupted. Auto-resume in 10s ...
  timeout /t 10 /nobreak >nul
  goto loop
)

echo.
echo [OK] Done. Seed files in: %CD%\%OUT%
pause
endlocal
