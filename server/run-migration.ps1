$ErrorActionPreference = "Stop"
Set-Location "d:\suitegenie\tweet-genie\server"

Write-Host "🔄 Starting database migrations..." -ForegroundColor Cyan

# Run the Node.js migration script
Write-Host ""
Write-Host "📊 Running migrations using Node.js..." -ForegroundColor Yellow
node run-migrations.js

Write-Host ""
Write-Host "✅ Migration script completed" -ForegroundColor Green
