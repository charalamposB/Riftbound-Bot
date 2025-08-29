@echo off
cd /d C:\riftbound-bot

echo Building project...
npm run build

echo Restarting bot with PM2...
pm2 restart riftbound-bot

echo Done!
pause