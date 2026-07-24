@echo off
chcp 65001 >nul
REM ===== بناء برنامج زوهات لويندوز (ملف .exe واحد) =====
cd /d "%~dp0"

echo.
echo [1/3] تهيئة بيئة البناء...
if not exist ".venv" (
    python -m venv .venv
)
call .venv\Scripts\activate.bat

echo [2/3] تثبيت الأدوات المطلوبة...
python -m pip install --upgrade pip --quiet
python -m pip install -r requirements.txt --quiet

echo [3/3] بناء الملف التنفيذي...
pyinstaller --noconfirm --onefile --windowed ^
  --name "Zohat" ^
  --icon "icon.ico" ^
  --add-data "icon.ico;." ^
  zohat_desktop.py

echo.
if exist "dist\Zohat.exe" (
    echo ============================================
    echo   تم البناء بنجاح!
    echo   الملف: %~dp0dist\Zohat.exe
    echo   أرسل هذا الملف للموظفين مباشرة.
    echo ============================================
) else (
    echo [خطأ] لم يكتمل البناء — راجع الرسائل أعلاه.
)
echo.
pause
