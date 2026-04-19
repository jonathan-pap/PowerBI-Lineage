@echo off
setlocal

REM ---- Power BI Lineage — browser-mode launcher ----
REM Builds the static bundle under docs\ (if needed), then starts a
REM local static server so the dashboard can run entirely in the
REM browser via the File System Access API. Zero Node code executes
REM against your PBIP folder — files stay in the browser.
REM
REM Requires Chrome, Edge, or Opera. Firefox and Safari can't use
REM this mode (File System Access API not implemented).

cd /d "%~dp0"

REM Build first-time or after a clean.
if not exist "docs\index.html" (
  echo Building browser bundle...
  call npm install
  call npm run build:browser
  if errorlevel 1 (
    echo Build failed.
    pause
    exit /b 1
  )
)

node scripts\serve-browser.mjs

endlocal
