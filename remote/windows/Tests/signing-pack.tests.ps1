param([Parameter(Mandatory)][string]$PackageDirectory)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows) { throw 'This unsigned-binary rejection test requires native Windows.' }
. (Join-Path $PSScriptRoot '../signing.ps1')
$values = @{
    REMOTE_WINDOWS_SIGNING_MODE = 'azure'
    REMOTE_WINDOWS_SIGNER_SUBJECT = 'CN=Unsigned Rejection Test'
    REMOTE_WINDOWS_AZURE_CLIENT_ID = '11111111-1111-1111-1111-111111111111'
    REMOTE_WINDOWS_AZURE_TENANT_ID = '22222222-2222-2222-2222-222222222222'
    REMOTE_WINDOWS_AZURE_SUBSCRIPTION_ID = '33333333-3333-3333-3333-333333333333'
    REMOTE_WINDOWS_AZURE_ENDPOINT = 'https://eus.codesigning.azure.net'
    REMOTE_WINDOWS_AZURE_ACCOUNT_NAME = 'test-only'
    REMOTE_WINDOWS_AZURE_CERTIFICATE_PROFILE_NAME = 'test-only'
    GITHUB_OUTPUT = $null
}
$previous = @{}
foreach ($name in $values.Keys) { $previous[$name] = [Environment]::GetEnvironmentVariable($name) }
$parent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
$temp = Join-Path $parent ('dsh-remote-pack-test-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $temp
try {
    foreach ($name in $values.Keys) { [Environment]::SetEnvironmentVariable($name, $values[$name]) }
    $package = Join-Path $temp 'DSH Remote'
    $null = New-Item -ItemType Directory -Path $package
    foreach ($name in $RemoteOwnedBinaries) { Copy-Item -LiteralPath (Join-Path $PackageDirectory $name) -Destination $package }
    & (Join-Path $PSScriptRoot '../sign-release.ps1') -Operation prepare -PackageDirectory $package
    $failure = $null
    try { & (Join-Path $PSScriptRoot '../pack.ps1') -OutputDirectory $temp -BuildNumber 1 -SigningMode azure } catch { $failure = $_ }
    if ($null -eq $failure -or $failure.Exception.Message -notmatch 'Authenticode verification failed|Unexpected publisher identity') { throw "Unsigned files were not rejected at signature verification: $failure" }
    if (Test-Path -LiteralPath (Join-Path $temp 'DSH-Remote-Windows-x64.zip')) { throw 'Signature rejection produced a release ZIP.' }
    $failure = $null
    try { & (Join-Path $PSScriptRoot '../pack.ps1') -OutputDirectory $temp -BuildNumber 1 -SigningMode none } catch { $failure = $_ }
    if ($null -eq $failure -or $failure.Exception.Message -notmatch 'unsigned fallback is forbidden') { throw "Unsigned downgrade was not rejected: $failure" }
    Write-Host 'Native Windows rejected unsigned application binaries and unsigned fallback before self-check or packaging; no signing service was called.'
} finally {
    foreach ($name in $previous.Keys) { [Environment]::SetEnvironmentVariable($name, $previous[$name]) }
    $resolved = (Get-Item -LiteralPath $temp).FullName
    if ($resolved -cne $temp -or (Split-Path -Parent $resolved) -cne $parent -or (Split-Path -Leaf $resolved) -notmatch '^dsh-remote-pack-test-[a-f0-9]{32}$') { throw 'Refusing to remove an unexpected fixture directory.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
