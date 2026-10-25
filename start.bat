@echo off
rem ============================================================
rem  Listen to me - one-click launcher for Windows.
rem  Double-click this file, or run it from Command Prompt.
rem  It runs "python server.py" (ASCII-only on purpose).
rem ============================================================
cd /d "%~dp0"

where python >nul 2>nul
if not errorlevel 1 goto use_python
where py >nul 2>nul
if not errorlevel 1 goto use_py

echo [X] Python is not installed. Get it from https://www.python.org/downloads/
echo     On the first installer screen tick "Add python.exe to PATH".
goto done

:use_python
python server.py %*
goto done

:use_py
py -3 server.py %*

:done
echo.
echo (Press any key to close this window.)
pause >nul
