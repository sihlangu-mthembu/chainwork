@echo off
rem Chainwork on Aevum: update the repo, then run scripts\aevum.ps1. Double-click to run.
cd /d C:\dev\chainwork
set "PATH=C:\Program Files\nodejs;%APPDATA%\npm;%LOCALAPPDATA%\pnpm;%USERPROFILE%\.foundry\bin;%PATH%"
if not exist "C:\Program Files\nodejs\node.exe" goto nonode
if not exist "%USERPROFILE%\.foundry\bin\forge.exe" goto noforge
call pnpm --version >NUL 2>&1
if errorlevel 1 (
  echo Installing pnpm...
  call npm install -g pnpm@9.15.0
)
git fetch origin
git switch main
rem The deployment file is now in the repository: set the local copy aside so the update applies.
git ls-files --error-unmatch deployments/aevum.json >NUL 2>&1
if errorlevel 1 if exist deployments\aevum.json move /y deployments\aevum.json deployments\aevum.local.json >NUL
git pull --ff-only
call pnpm install
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\aevum.ps1 %*
echo.
pause
exit /b 0
:nonode
echo Node.js was not found in C:\Program Files\nodejs.
pause
exit /b 1
:noforge
echo Foundry (forge.exe) was not found in %USERPROFILE%\.foundry\bin.
pause
exit /b 1
