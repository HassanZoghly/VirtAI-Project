@echo off
title Python Deep Cache Cleaner

:: ============================================
:: Go to project root
:: ============================================
cd /d "%~dp0.."

echo ============================================
echo Cleaning ALL Python cache/temp files...
echo Project Root:
echo %CD%
echo ============================================

:: -----------------------------
:: Delete cache directories
:: -----------------------------
for /d /r %%d in (__pycache__) do @if exist "%%d" rd /s /q "%%d"
for /d /r %%d in (.pytest_cache) do @if exist "%%d" rd /s /q "%%d"
for /d /r %%d in (.mypy_cache) do @if exist "%%d" rd /s /q "%%d"
for /d /r %%d in (.ruff_cache) do @if exist "%%d" rd /s /q "%%d"
for /d /r %%d in (.ipynb_checkpoints) do @if exist "%%d" rd /s /q "%%d"
for /d /r %%d in (.tox) do @if exist "%%d" rd /s /q "%%d"
for /d /r %%d in (.nox) do @if exist "%%d" rd /s /q "%%d"
for /d /r %%d in (build) do @if exist "%%d" rd /s /q "%%d"
for /d /r %%d in (dist) do @if exist "%%d" rd /s /q "%%d"
for /d /r %%d in (*.egg-info) do @if exist "%%d" rd /s /q "%%d"

:: -----------------------------
:: Delete compiled files
:: -----------------------------
del /s /f /q *.pyc 2>nul
del /s /f /q *.pyo 2>nul
del /s /f /q *.pyd 2>nul

:: -----------------------------
:: Delete temp/log files
:: -----------------------------
del /s /f /q *.log 2>nul
del /s /f /q *.tmp 2>nul

echo.
echo ============================================
echo DONE CLEANING
echo ============================================

pause
