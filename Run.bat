@echo off
setlocal
cd /d "%~dp0"
title LN Reader

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
  echo   LN Reader needs Python 3.10 or newer.
  echo.
  pause
  exit /b 1
)

rem The native window uses pywebview; Chrome/Edge app mode and the default
rem browser are used automatically when it is not available.
%PY% -c "import webview" >nul 2>nul
if errorlevel 1 (
  echo   Preparing the reading window, this only happens once...
  %PY% -m pip install --disable-pip-version-check --quiet --no-input pywebview >nul 2>nul
)

rem Launch without a console window; problems are shown as a dialog and
rem written to data\last-error.log. Keep the launcher version in sync with PY.
set "WINPY="
if /i "%PY%"=="py -3" (
  where pyw >nul 2>nul && set "WINPY=pyw -3"
)
if not defined WINPY (
  where pythonw >nul 2>nul && set "WINPY=pythonw"
)
if not defined WINPY (
  where pyw >nul 2>nul && set "WINPY=pyw"
)
if defined WINPY (
  start "" %WINPY% "%~dp0app\server.py" %*
) else (
  start "" %PY% "%~dp0app\server.py" %*
)
exit /b 0
