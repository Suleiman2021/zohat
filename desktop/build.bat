@echo off
REM ============================================================
REM  ZOHAT - Windows desktop app builder
REM  NOTE: keep this file ASCII-only. cmd.exe reads .bat files
REM  with the system codepage and breaks on Arabic text.
REM ============================================================
setlocal
cd /d "%~dp0"

echo.
echo ============================================
echo   ZOHAT - Windows App Builder
echo ============================================
echo.

REM ---- locate Python ----
set "PY="
where python >nul 2>&1 && set "PY=python"
if not defined PY (
    where py >nul 2>&1 && set "PY=py -3"
)
if not defined PY (
    echo [ERROR] Python was not found on this computer.
    echo         Install it from https://python.org
    echo         and tick "Add python.exe to PATH" during setup.
    echo.
    pause
    exit /b 1
)
echo Using Python: %PY%
echo.

REM ---- step 1: build environment ----
echo [1/4] Preparing build environment...
if not exist ".venv\Scripts\python.exe" %PY% -m venv .venv
if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Could not create the virtual environment.
    echo.
    pause
    exit /b 1
)
set "VPY=.venv\Scripts\python.exe"

REM ---- step 2: pip + build tools ----
REM  Python 3.12+ no longer ships setuptools inside new venvs, and one of
REM  pywebview's dependencies (proxy_tools) needs it to build. Install it first.
echo [2/4] Updating pip and build tools...
"%VPY%" -m pip install --upgrade pip setuptools wheel --timeout 60 --retries 5 --quiet
if errorlevel 1 (
    echo [ERROR] Could not update pip / setuptools. Check your internet connection.
    echo.
    pause
    exit /b 1
)

REM ---- step 3: dependencies ----
echo [3/4] Installing pywebview + pyinstaller (this may take a minute)...
"%VPY%" -m pip install -r requirements.txt --timeout 60 --retries 5
if errorlevel 1 (
    echo.
    echo [warn] Normal install failed, retrying without build isolation...
    "%VPY%" -m pip install -r requirements.txt --no-build-isolation --timeout 60 --retries 5
)
if errorlevel 1 (
    echo [ERROR] Failed to install the required packages.
    echo         Check your internet connection and try again.
    echo.
    pause
    exit /b 1
)

REM ---- step 4: build ----
echo [4/4] Building Zohat.exe ...
"%VPY%" -m PyInstaller --noconfirm --onefile --windowed --name Zohat --icon icon.ico zohat_desktop.py
if errorlevel 1 (
    echo [ERROR] The build failed. See the messages above.
    echo.
    pause
    exit /b 1
)

echo.
if exist "dist\Zohat.exe" (
    echo ============================================
    echo   BUILD SUCCESSFUL
    echo.
    echo   File: %cd%\dist\Zohat.exe
    echo   Send this single file to your staff.
    echo ============================================
) else (
    echo [ERROR] Zohat.exe was not produced.
)
echo.
pause
