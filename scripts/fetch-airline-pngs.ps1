# Downloads the broad ICAO-keyed airline logo PNG set (sexym0nk3y/airline-logos,
# 900+ logos, fair-use for identification) into app/public/logos.
# Run this BEFORE scripts/fetch-logos.mjs (which adds SVGs + builds the manifest).
#
# Usage: pwsh scripts/fetch-airline-pngs.ps1
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root 'app/public/logos'
$tmpZip = Join-Path $env:TEMP 'airline-logos.zip'
$tmpDir = Join-Path $env:TEMP 'airline-logos-extract'

Write-Host 'Downloading airline logo PNGs...'
Invoke-WebRequest -Uri 'https://codeload.github.com/sexym0nk3y/airline-logos/zip/refs/heads/main' -OutFile $tmpZip -TimeoutSec 120

if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }
Expand-Archive -Path $tmpZip -DestinationPath $tmpDir -Force

$logoDir = (Get-ChildItem -Path $tmpDir -Recurse -Directory | Where-Object { $_.Name -eq 'logos' } | Select-Object -First 1).FullName
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item -Path (Join-Path $logoDir '*.png') -Destination $target -Force

$count = (Get-ChildItem $target -Filter *.png | Measure-Object).Count
Write-Host "Copied $count PNG logos into $target"
