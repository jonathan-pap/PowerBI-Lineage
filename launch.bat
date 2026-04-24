@echo off
setlocal

REM ---- Power BI Lineage launcher ----
REM If this is a git clone with a clean working tree, fetch the latest
REM from origin/main (fast-forward only). Then build if dist/ is stale
REM (missing, or older than HEAD), and start the app.

cd /d "%~dp0"

set "NEED_BUILD=0"
set "HEAD_BEFORE="
set "HEAD_AFTER="

REM Only attempt git pull when this looks like a clone and git is available.
if exist ".git" (
  where git >nul 2>&1
  if %errorlevel%==0 (
    REM Skip pull if the working tree has uncommitted changes — don't clobber dev work.
    git diff --quiet >nul 2>&1
    set "DIRTY_UNSTAGED=%errorlevel%"
    git diff --cached --quiet >nul 2>&1
    set "DIRTY_STAGED=%errorlevel%"
    if "%DIRTY_UNSTAGED%"=="0" if "%DIRTY_STAGED%"=="0" (
      for /f "delims=" %%H in ('git rev-parse HEAD 2^>nul') do set "HEAD_BEFORE=%%H"
      echo Checking for updates...
      git pull --ff-only --quiet
      if errorlevel 1 (
        echo   ^(pull skipped or failed — continuing with local copy^)
      )
      for /f "delims=" %%H in ('git rev-parse HEAD 2^>nul') do set "HEAD_AFTER=%%H"
      if not "%HEAD_BEFORE%"=="%HEAD_AFTER%" (
        echo Updated to new revision — will rebuild.
        set "NEED_BUILD=1"
      )
    ) else (
      echo Local changes detected — skipping git pull.
    )
  )
)

if not exist "dist\app.js" set "NEED_BUILD=1"

if "%NEED_BUILD%"=="1" (
  echo Building...
  call npm install
  call npm run build
  if errorlevel 1 (
    echo Build failed.
    pause
    exit /b 1
  )
)

node dist\app.js

endlocal
