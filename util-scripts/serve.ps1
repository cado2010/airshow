# Starts the AirShow server over HTTP on port 9443, serving the built frontend.
# Usage:  powershell -ExecutionPolicy Bypass -File .\serve.ps1   (or: npm run serve)
$ErrorActionPreference = 'Stop'
# This script lives in util-scripts/, so the repo root is its parent.
$root = Split-Path -Parent $PSScriptRoot
$env:PORT = '9443'
$env:STATIC_DIR = Join-Path $root 'app\dist'
Remove-Item Env:TLS_KEY_PATH  -ErrorAction SilentlyContinue
Remove-Item Env:TLS_CERT_PATH -ErrorAction SilentlyContinue
Write-Host "Starting AirShow (HTTP) on http://localhost:9443 ..." -ForegroundColor Cyan
Push-Location (Join-Path $root 'server')
try { npx tsx src/dev.ts } finally { Pop-Location }
