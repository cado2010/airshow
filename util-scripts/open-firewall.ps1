# Opens inbound TCP 9443 for AirShow in Windows Firewall.
# Run this in an ELEVATED (Administrator) PowerShell:  & .\open-firewall.ps1
param(
  [int]$Port = 9443
)

$ErrorActionPreference = "Stop"

# Require admin
$isAdmin = ([Security.Principal.WindowsPrincipal] `
  [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
  Write-Host "This script must be run as Administrator." -ForegroundColor Red
  Write-Host "Right-click PowerShell -> 'Run as administrator', then re-run:  & .\open-firewall.ps1"
  exit 1
}

$name = "AirShow HTTPS $Port"

$existing = Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Firewall rule '$name' already exists. Ensuring it is enabled..." -ForegroundColor Yellow
  $existing | Set-NetFirewallRule -Enabled True -Action Allow
} else {
  New-NetFirewallRule -DisplayName $name -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Any | Out-Null
  Write-Host "Created inbound allow rule '$name' for TCP $Port." -ForegroundColor Green
}

Write-Host ""
Write-Host "Done. Remaining external-access checklist:" -ForegroundColor Cyan
Write-Host "  1. Norton: allow inbound TCP $Port (or allow node.exe)."
Write-Host "  2. Router: port-forward external $Port -> 192.168.1.99:$Port (TCP)."
Write-Host "  3. Test from a phone on cellular: https://airshow.opbdf.org:$Port/"
