@echo off
REM Setup Windows Task Scheduler for Anime Birthday Bot
REM Run this as Administrator

set BOT_PATH=%~dp0..
set NODE_PATH=node

echo ===========================================
echo   Anime Birthday Bot - Task Scheduler Setup
echo ===========================================
echo.

REM Create the scheduled task
REM Runs daily at 8:30 AM Argentina time (11:30 UTC)
schtasks /create /tn "AnimeBirthdayBot" /tr "cmd /c cd /d \"%BOT_PATH%\" && %NODE_PATH% index.js" /sc daily /st 11:30 /f

if %errorlevel% equ 0 (
    echo.
    echo Task created successfully!
    echo The bot will run daily at 8:30 AM Argentina time.
    echo.
    echo To view the task: schtasks /query /tn "AnimeBirthdayBot"
    echo To delete the task: schtasks /delete /tn "AnimeBirthdayBot" /f
    echo To run manually: schtasks /run /tn "AnimeBirthdayBot"
) else (
    echo.
    echo Failed to create task. Make sure you're running as Administrator.
)

echo.
pause
