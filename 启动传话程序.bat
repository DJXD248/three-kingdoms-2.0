@echo off
chcp 65001 >nul
title 三国卡牌 联机测试 一键启动
cd /d "%~dp0"

set "NODE_DIR="
for /d %%D in ("%USERPROFILE%\.workbuddy\binaries\node\versions\*") do (
  if exist "%%D\node.exe" set "NODE_DIR=%%D"
)
if defined NODE_DIR set "PATH=%NODE_DIR%;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo [起不来] 没找到运行环境，请把这一行字发给助手。
  pause
  exit /b 1
)

echo 正在打开两个窗口，测试期间都不要关...
start "1 传话程序 别关" node "%~dp0scripts\net-relay.mjs" 8787
start "2 游戏页面 别关" "%~dp0node_modules\.bin\vite.cmd" preview --host 0.0.0.0 --port 4173

echo.
echo ==========================================
echo  两个黑色窗口已打开，测试期间都别关。
echo  两台电脑浏览器打开： http://192.168.1.50:4173
echo  游戏里地址栏填：     ws://192.168.1.50:8787
echo  地址若变了，以 1 号窗口里显示的两行为准。
echo ==========================================
echo.
echo 这个提示窗口现在可以关掉。
pause
