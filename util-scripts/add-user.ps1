# Add or update an AirShow login user (email + password).
# The password is read with a hidden prompt and passed to the Node helper via an
# environment variable, so it never appears in the command line / process list.
# Only a salted scrypt hash is written to server/creds/users.json.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\add-user.ps1
#   powershell -ExecutionPolicy Bypass -File .\add-user.ps1 -Email you@example.com -Role admin
[CmdletBinding()]
param(
  [string]$Email,
  [ValidateSet('user', 'admin')]
  [string]$Role = 'user'
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

$secure = Read-Host 'Password' -AsSecureString
$confirm = Read-Host 'Confirm password' -AsSecureString

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
  node (Join-Path $root 'scripts\add-user.mjs') --email $Email --role $Role
}
finally {
  Remove-Item Env:AIRSHOW_PW -ErrorAction SilentlyContinue
  $pw1 = $null; $pw2 = $null
}
