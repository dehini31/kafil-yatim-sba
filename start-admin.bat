@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js n'est pas installe. Installez la version LTS depuis https://nodejs.org puis relancez. & pause & exit /b 1)
if not exist node_modules (echo Installation des composants, patientez... & call npm install --omit=dev || (pause & exit /b 1))
if not exist .env (call node scripts\setup.js)
start "" http://127.0.0.1:8787/admin/
echo Administration lancee sur http://127.0.0.1:8787/admin/  - laissez cette fenetre ouverte.
node server\index.js
pause
