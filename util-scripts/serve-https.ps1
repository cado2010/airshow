# Starts the AirShow server over HTTPS on port 9443 using the Let's Encrypt cert.
# Usage:  powershell -ExecutionPolicy Bypass -File .\serve-https.ps1  (or: npm run serve:https)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
# Read the user-readable copies produced by install-cert.ps1 (certbot's own
# files under letsencrypt\config\ are locked to SYSTEM/Administrators).
$tls = Join-Path $root 'server\creds\tls'
$env:PORT = '9443'
$env:STATIC_DIR = Join-Path $root 'app\dist'
$env:TLS_KEY_PATH  = Join-Path $tls 'privkey.pem'
$env:TLS_CERT_PATH = Join-Path $tls 'fullchain.pem'
if (-not (Test-Path $env:TLS_CERT_PATH)) {
  Write-Host "Cert not found at $env:TLS_CERT_PATH" -ForegroundColor Yellow
  Write-Host "Run (as Administrator) once to install it:" -ForegroundColor Yellow
  Write-Host "  powershell -ExecutionPolicy Bypass -File .\install-cert.ps1" -ForegroundColor Yellow
  exit 1
}
Write-Host "Starting AirShow (HTTPS) on https://airshow.opbdf.org:9443 ..." -ForegroundColor Cyan
Push-Location (Join-Path $root 'server')
try { npx tsx src/dev.ts } finally { Pop-Location }
