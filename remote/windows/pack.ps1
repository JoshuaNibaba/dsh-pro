param(
    [Parameter(Mandatory)][string]$OutputDirectory,
    [ValidateRange(1, 65534)][int]$BuildNumber = 1,
    [Parameter(Mandatory)][ValidateSet('none', 'azure', 'certificate-store')][string]$SigningMode
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'signing.ps1')
Assert-RemoteWindows
$output = (Get-Item -LiteralPath $OutputDirectory).FullName
$package = Join-Path $output 'DSH Remote'
$config = Get-RemoteSigningConfiguration
if ($config.Mode -cne $SigningMode) { throw 'Packaging mode does not match REMOTE_WINDOWS_SIGNING_MODE; unsigned fallback is forbidden.' }
$null = Get-RemotePackageFiles $package
$zip = Join-Path $output 'DSH-Remote-Windows-x64.zip'
foreach ($name in @('DSH-Remote-Windows-x64.zip', 'DSH-Remote-Windows-x64.zip.sha256', 'DSH-Remote-Windows.version', 'signing-status.json')) {
    if (Test-Path -LiteralPath (Join-Path $output $name)) { throw "Release output already exists: $name" }
}
$records = @()
if ($SigningMode -ne 'none') {
    $before = Get-Content -LiteralPath (Join-Path $output 'signing-input.json') -Raw | ConvertFrom-Json -AsHashtable
    if ($before.Mode -cne $SigningMode -or $before.Subject -cne $config.Subject) { throw 'Signing preparation does not match the selected publisher and mode.' }
    Assert-RemoteUnchangedDependencies $package $before.Files -AllowOwnedChanges
    $records = @(Test-RemotePackageSignatures $package $config)
}
$sealed = New-RemoteSigningSnapshot $package
$exe = Join-Path $package 'DSH Remote.exe'
$version = [Diagnostics.FileVersionInfo]::GetVersionInfo($exe).FileVersion
if ($version -cne "1.0.$BuildNumber.0") { throw "Unexpected executable version: $version" }
# Exercise the exact verified executable without starting WebView2 or a browser.
$check = Start-Process -FilePath $exe -ArgumentList '--self-check' -PassThru
try {
    if (-not $check.WaitForExit(30000)) {
        $check.Kill($true)
        $check.WaitForExit()
        throw 'Published executable dependency check timed out.'
    }
    if ($check.ExitCode -ne 0) { throw "Published executable dependency check failed: $($check.ExitCode)" }
} finally { $check.Dispose() }
Assert-RemoteUnchangedDependencies $package $sealed
Compress-Archive -LiteralPath $package -DestinationPath $zip -CompressionLevel Optimal
Assert-RemoteUnchangedDependencies $package $sealed
$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath (Join-Path $output 'DSH-Remote-Windows-x64.zip.sha256') -Value "$hash  DSH-Remote-Windows-x64.zip`n" -Encoding ascii -NoNewline
Set-Content -LiteralPath (Join-Path $output 'DSH-Remote-Windows.version') -Value $BuildNumber -Encoding ascii
[ordered]@{ Schema = 1; Mode = $SigningMode; Signed = ($SigningMode -ne 'none'); BuildNumber = $BuildNumber; ZipSHA256 = $hash; Files = $records } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $output 'signing-status.json') -Encoding utf8
if ($env:GITHUB_OUTPUT) { "directory=$output" | Out-File -FilePath $env:GITHUB_OUTPUT -Append -Encoding utf8 }
Write-Host "Release 1.0.${BuildNumber} ($SigningMode): $zip"
Write-Host "SHA-256: $hash"
