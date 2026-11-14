@echo off
setlocal
cd /d "%~dp0"
title LN Reader - Desktop Light Novel Reader

echo ========================================================
echo    LN Reader - High-Performance Desktop EPUB Reader
echo ========================================================
echo.

:: Check if Python is installed
where python >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Python is not installed or not in PATH.
    echo Please install Python 3.10+ from python.org and ensure "Add to PATH" is checked.
    echo.
    pause
    exit /b 1
)

:: Set environment variables for minimal RAM footprint
set QT_API=pyside6
set QTWEBENGINE_CHROMIUM_FLAGS=--enable-low-end-device-mode --renderer-process-limit=1 --js-flags="--max-old-space-size=128 --optimize-for-size" --disable-background-networking --disable-sync --disable-speech-api --disable-gpu-shader-disk-cache --disk-cache-size=10485760 --media-cache-size=10485760 --disable-features=Translate,OptimizationHints,MediaRouter,CalculateNativeWinOcclusion
set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=%QTWEBENGINE_CHROMIUM_FLAGS%

echo [i] Starting LN Reader Desktop Application...
python app.py

if %ERRORLEVEL% neq 0 (
    echo.
    echo [!] Application exited with error code %ERRORLEVEL%.
    pause
)
