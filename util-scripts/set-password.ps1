# Update the password of an EXISTING AirShow login user.
# The password is read with a hidden prompt and passed to the Node helper via an
# environment variable, so it never appears in the command line / process list.
# The user's role is preserved; this script will NOT create a new user.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\set-password.ps1
#   powershell -ExecutionPolicy Bypass -File .\set-password.ps1 -Email you@example.com
[CmdletBinding()]
param(
  [string]$Email
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

if (-not $Email) {
  $Email = Read-Host 'Email'
}
if (-not $Email) {
  Write-Error 'Email is required.'
  exit 1
}

$secure = Read-Host 'New password' -AsSecureString
$confirm = Read-Host 'Confirm new password' -AsSecureString

$bstr1 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$bstr2 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirm)
try {
  $pw1 = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr1)
  $pw2 = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr2)
}
finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr1)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr2)
}

if (-not $pw1) {
  Write-Error 'Password is required.'
  exit 1
}
if ($pw1 -ne $pw2) {
  Write-Error 'Passwords do not match.'
  exit 1
}

$env:AIRSHOW_PW = $pw1
try {
  node (Join-Path $root 'scripts\set-password.mjs') --email $Email
}
finally {
  Remove-Item Env:AIRSHOW_PW -ErrorAction SilentlyContinue
  $pw1 = $null; $pw2 = $null
}
