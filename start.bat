@echo off
title Solar Customer Files
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install it from https://nodejs.org and run this file again.
  pause
  exit /b 1
)

if not exist "server\.env" (
  echo The file server\.env is missing. Copy server\.env.example to server\.env and put the MongoDB Atlas link in it.
  pause
  exit /b 1
)

if not exist "server\node_modules" (
  echo First start: installing the server. This takes a few minutes...
  pushd server
  call npm install --no-fund --no-audit
  popd
)

if not exist "client\node_modules" (
  echo First start: installing the screens...
  pushd client
  call npm install --no-fund --no-audit
  popd
)

if not exist "client\dist\index.html" (
  echo Building the screens...
  pushd client
  call npm run build
  popd
)

rem Open the browser a few seconds after the server starts.
start "" cmd /c "timeout /t 5 >nul & start http://localhost:4000"

cd server
node src/index.js
pause
