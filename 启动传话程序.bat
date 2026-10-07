@echo off
chcp 65001 >nul
title 三国卡牌 联机传话程序
echo ==========================================
echo  三国卡牌 联机传话程序（只转发，不算牌）
echo ==========================================
echo  用法：房主这台机器双击本窗口开着，
echo        然后两边游戏里都填窗口里显示的那个地址。
echo  关掉本窗口 = 停掉传话。
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo [缺东西] 这台机器没装 Node.js，传话程序跑不起来。
  echo          请装 Node 24 后再双击本文件。
  pause
  exit /b 1
)
node "%~dp0scripts\net-relay.mjs"
pause
