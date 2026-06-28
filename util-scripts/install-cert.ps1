# Copies the Let's Encrypt certificate into a user-readable folder so the
# non-elevated AirShow server can read it. certbot locks the files under
# ...\letsencrypt\config\ to SYSTEM/Administrators, so a normal-user server
# process gets EPERM reading them directly.
#
# Run this ONCE as Administrator after issuing the cert, and again after each
# renewal — or wire it as a certbot deploy hook:
#   certbot ... --deploy-hook "powershell -ExecutionPolicy Bypass -File C:\dev\airshow\install-cert.ps1"
$ErrorActionPreference = 'Stop'
# This script lives in util-scripts/, so the repo root is its parent.
$root = Split-Path -Parent $PSScriptRoot
$live = Join-Path $root 'server\creds\letsencrypt\config\live\airshow.opbdf.org'
$dst = Join-Path $root 'server\creds\tls'

New-Item -ItemType Directory -Force -Path $dst | Out-Null
Copy-Item (Join-Path $live 'fullchain.pem') (Join-Path $dst 'fullchain.pem') -Force
Copy-Item (Join-Path $live 'privkey.pem') (Join-Path $dst 'privkey.pem') -Force

# Make sure the interactive (non-admin) user can read the copies. New files
# inherit the folder ACL, but grant explicitly to be safe.
icacls $dst /grant "$($env:USERNAME):(OI)(CI)R" /T | Out-Null

Write-Host "Installed cert -> $dst" -ForegroundColor Green
Write-Host "Now start the server (non-admin) with: npm run serve:https" -ForegroundColor Cyan
