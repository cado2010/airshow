# Starts the AirShow server over HTTPS on port 9443 using the Let's Encrypt cert.
# Usage:  powershell -ExecutionPolicy Bypass -File .\serve-https.ps1  (or: npm run serve:https)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$live = Join-Path $root 'server\creds\letsencrypt\config\live\airshow.opbdf.org'
$env:PORT = '9443'
$env:STATIC_DIR = Join-Path $root 'app\dist'
$env:TLS_KEY_PATH  = Join-Path $live 'privkey.pem'
$env:TLS_CERT_PATH = Join-Path $live 'fullchain.pem'
if (-not (Test-Path $env:TLS_CERT_PATH)) {
  Write-Host "Cert not found at $env:TLS_CERT_PATH - run certbot first (see docs)." -ForegroundColor Yellow
  exit 1
}
Write-Host "Starting AirShow (HTTPS) on https://airshow.opbdf.org:9443 ..." -ForegroundColor Cyan
Push-Location (Join-Path $root 'server')
try { npx tsx src/dev.ts } finally { Pop-Location }
