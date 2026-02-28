$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

Write-Host "Starting database migrations..." -ForegroundColor Cyan
Write-Host ""
Write-Host "Running migrations using Node.js..." -ForegroundColor Yellow
node scripts/migrate.js

Write-Host ""
Write-Host "Migration script completed" -ForegroundColor Green