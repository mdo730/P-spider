@echo off
chcp 65001 >nul
setlocal
pushd "%~dp0.."

rem ================= EDIT ONLY THIS LINE =================
rem Clash Verge -> 设置 -> 打开「外部控制」后设置的 secret
set "CLASH_SECRET=set-your-secret114514"
rem ======================================================
set "CLASH_URL=http://127.0.0.1:9097"
set "CLASH_GROUP=GLOBAL"
set "PROXY=http://127.0.0.1:7897"

set "NODE_USE_ENV_PROXY=1"
set "HTTP_PROXY=%PROXY%"
set "HTTPS_PROXY=%PROXY%"
set "NO_PROXY=127.0.0.1,localhost"

if not exist "hpoi-seed" mkdir "hpoi-seed"

echo ============================================================
echo   hpoi seed crawler  (via Clash proxy + auto node switch)
echo   Proxy  : %PROXY%
echo   Clash  : %CLASH_URL%   group=%CLASH_GROUP%
echo   Output : %CD%\hpoi-seed
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
echo [OK] Done. Seed files in: %CD%\hpoi-seed
pause
popd
endlocal
