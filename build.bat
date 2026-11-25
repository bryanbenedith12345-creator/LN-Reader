@echo off
setlocal
cd /d "%~dp0"
title Simple LN Reader - build

rem Builds dist\Simple LN Reader\Simple LN Reader.exe from the files in this
rem folder. Needs Python 3.10+ and installs PyInstaller the first time.

set "PY="
for %%P in (py python) do (
  if not defined PY (
    where %%P >nul 2>nul && set "PY=%%P"
  )
)
if not defined PY (
  echo.
  echo   Python 3 was not found on PATH.
  echo   Install it from https://www.python.org/downloads/ and run this file again.
  echo.
  pause
  exit /b 1
)
if /i "%PY%"=="py" set "PY=py -3"

%PY% -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Building needs Python 3.10 or newer.
  echo.
  pause
  exit /b 1
)

echo   Checking the build tools...
%PY% -c "import PyInstaller" >nul 2>nul
if errorlevel 1 (
  echo   Installing PyInstaller, this only happens once...
  %PY% -m pip install --disable-pip-version-check --quiet --no-input "pyinstaller>=6.0"
  if errorlevel 1 (
    echo.
    echo   PyInstaller could not be installed. Check the connection and try again.
    echo.
    pause
    exit /b 1
  )
)
%PY% -c "import webview" >nul 2>nul
if errorlevel 1 (
  echo   Installing pywebview...
  %PY% -m pip install --disable-pip-version-check --quiet --no-input pywebview
)

rem The spec file finds app\, build\app.ico and build\version.txt by itself, so
rem the build also works when this folder is moved or copied elsewhere.
set "WORK=%TEMP%\lnreader-build"
echo   Building Simple LN Reader.exe, this takes about a minute...
%PY% -m PyInstaller --noconfirm --clean --log-level WARN --distpath "%~dp0dist" --workpath "%WORK%" "%~dp0build\lnreader.spec"
if errorlevel 1 (
  echo.
  echo   The build failed. The messages above say what went wrong.
  echo.
  pause
  exit /b 1
)
if exist "%WORK%" rd /s /q "%WORK%"

echo.
echo   Done. The app is here:
echo     %~dp0dist\Simple LN Reader\Simple LN Reader.exe
echo.
echo   That folder is self contained: copy it anywhere and run the exe.
echo   Books, downloads and settings are created in data\ next to the exe.
echo.
pause
exit /b 0
