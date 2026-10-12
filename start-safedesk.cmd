@echo off
setlocal DisableDelayedExpansion
cd /d "%~dp0"
if errorlevel 1 goto directory_error
node "%~dp0scripts\safedesk\start.mjs" %*
set "desk_status=%errorlevel%"
if not "%desk_status%"=="0" (
  echo SafeDesk stopped with an error. Review the message above.
  pause
)
exit /b %desk_status%

:directory_error
echo Could not open the SafeDesk repository folder.
pause
exit /b 1
