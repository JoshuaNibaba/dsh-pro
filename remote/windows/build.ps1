param(
    [ValidateRange(1, 65534)][int]$BuildNumber = 1,
    [ValidatePattern('^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')][string]$Repository = 'JoshuaNibaba/dsh-pro',
    [switch]$StageOnly
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $IsWindows) { throw 'Build this release on Windows with PowerShell 7 and the .NET 8 SDK.' }
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$buildRoot = Join-Path $root 'remote/build'
New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null
# Each invocation owns a new output tree, including failed builds kept for diagnosis.
$output = Join-Path $buildRoot ('windows-' + [Guid]::NewGuid().ToString('N'))
$package = Join-Path $output 'DSH Remote'
New-Item -ItemType Directory -Path $package | Out-Null
& dotnet publish (Join-Path $PSScriptRoot 'DshRemote.csproj') -c Release -r win-x64 --self-contained true `
    -p:PublishSingleFile=false -p:PublishTrimmed=false -p:DebugType=None -p:DebugSymbols=false `
    "-p:Version=1.0.$BuildNumber" "-p:UpdateRepository=$Repository" -o $package
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed: $LASTEXITCODE" }
foreach ($file in @('README.md', 'README.zh.md')) { Copy-Item (Join-Path $PSScriptRoot $file) $package }
Copy-Item (Join-Path $root 'LICENSE') $package
# Include the licenses from the exact restored WebView2 and .NET runtime packages.
$assets = Get-Content (Join-Path $PSScriptRoot 'obj/project.assets.json') -Raw | ConvertFrom-Json -AsHashtable
$packageIds = @($assets.libraries.Keys | Where-Object { $_ -like 'Microsoft.Web.WebView2/*' })
foreach ($framework in $assets.project.frameworks.Values) {
    foreach ($dependency in $framework.downloadDependencies) {
        if ($dependency.name -match '^Microsoft\.(NETCore|WindowsDesktop)\.App\.Runtime\.win-x64$') {
            $version = ($dependency.version.Trim('[', ']') -split ',')[0].Trim()
            $packageIds += $dependency.name + '/' + $version
        }
    }
}
foreach ($id in $packageIds | Select-Object -Unique) {
    $source = Join-Path $assets.project.restore.packagesPath $id.ToLowerInvariant()
    $destination = Join-Path $package ('licenses/' + $id.Replace('/', '-'))
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    $notices = @(Get-ChildItem -LiteralPath $source -File | Where-Object { $_.Name -match '^(LICENSE|THIRD-PARTY-NOTICES)' })
    if ($notices.Count -eq 0) { throw "License files missing for $id" }
    $notices | Copy-Item -Destination $destination
}
if ($StageOnly) {
    if ($env:GITHUB_OUTPUT) { "directory=$output" | Out-File -FilePath $env:GITHUB_OUTPUT -Append -Encoding utf8 }
    Write-Host "Staged 1.0.${BuildNumber}: $package"
} else {
    & (Join-Path $PSScriptRoot 'pack.ps1') -OutputDirectory $output -BuildNumber $BuildNumber -SigningMode none
}
