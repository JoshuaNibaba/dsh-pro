param(
    [Parameter(Mandatory)][ValidateSet('prepare', 'certificate-store')][string]$Operation,
    [Parameter(Mandatory)][string]$PackageDirectory
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'signing.ps1')
Assert-RemoteWindows
$config = Get-RemoteSigningConfiguration
if ($config.Mode -eq 'none') { throw 'A signing operation cannot use the none mode.' }
$package = (Get-Item -LiteralPath $PackageDirectory).FullName
$snapshotPath = Join-Path (Split-Path -Parent $package) 'signing-input.json'
if ($Operation -eq 'prepare') {
    if (Test-Path -LiteralPath $snapshotPath) { throw 'Signing preparation already exists; use a fresh build directory.' }
    if ($package -match '[,\r\n]') { throw 'Signing paths cannot contain commas or newlines.' }
    $snapshot = New-RemoteSigningSnapshot $package
    # All identity and tool configuration is checked before cloud or hardware access.
    $null = Get-RemoteSignTool $config
    [ordered]@{ Mode = $config.Mode; Subject = $config.Subject; Files = $snapshot } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $snapshotPath -Encoding utf8
    if ($env:GITHUB_OUTPUT) {
        "package=$package" | Out-File -FilePath $env:GITHUB_OUTPUT -Append -Encoding utf8
        "directory=$(Split-Path -Parent $package)" | Out-File -FilePath $env:GITHUB_OUTPUT -Append -Encoding utf8
    }
} else {
    if ($config.Mode -ne 'certificate-store') { throw 'The selected mode does not permit certificate-store access.' }
    $before = Get-Content -LiteralPath $snapshotPath -Raw | ConvertFrom-Json -AsHashtable
    if ($before.Mode -cne $config.Mode -or $before.Subject -cne $config.Subject) { throw 'Signing configuration changed after preparation.' }
    Assert-RemoteUnchangedDependencies $package $before.Files
    Invoke-RemoteStoreSigning $package $config
    Assert-RemoteUnchangedDependencies $package $before.Files -AllowOwnedChanges
}
