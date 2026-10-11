# Shared validation for the Remote client; vendor runtime files are never re-signed.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$RemoteOwnedBinaries = @('DSH Remote.exe', 'DSH Remote.dll', 'DshRemote.Core.dll')

function Get-RemoteSigningConfiguration {
    param([hashtable]$Values)
    if ($null -eq $Values) {
        $Values = @{}
        foreach ($name in @('SIGNING_MODE', 'SIGNER_SUBJECT', 'CERTIFICATE_THUMBPRINT', 'CERTIFICATE_STORE_LOCATION', 'SIGNTOOL_PATH', 'TIMESTAMP_URL', 'AZURE_CLIENT_ID', 'AZURE_TENANT_ID', 'AZURE_SUBSCRIPTION_ID', 'AZURE_ENDPOINT', 'AZURE_ACCOUNT_NAME', 'AZURE_CERTIFICATE_PROFILE_NAME')) {
            $Values[$name] = [Environment]::GetEnvironmentVariable("REMOTE_WINDOWS_$name")
        }
    }
    $mode = [string]$Values['SIGNING_MODE']
    if ($mode -eq '') { $mode = 'none' }
    if ($mode -cnotin @('none', 'azure', 'certificate-store')) { throw 'REMOTE_WINDOWS_SIGNING_MODE must be none, azure, or certificate-store.' }
    $config = [ordered]@{ Mode = $mode }
    if ($mode -eq 'none') { return [pscustomobject]$config }
    $subject = Get-RemoteRequiredValue $Values 'SIGNER_SUBJECT'
    if ($subject -match '[\r\n]' -or $subject.Length -gt 1024) { throw 'Signer subject must be a single distinguished name.' }
    $null = [System.Security.Cryptography.X509Certificates.X500DistinguishedName]::new($subject)
    $config.Subject = $subject
    if ($mode -eq 'azure') {
        foreach ($name in @('AZURE_CLIENT_ID', 'AZURE_TENANT_ID', 'AZURE_SUBSCRIPTION_ID')) {
            $value = Get-RemoteRequiredValue $Values $name
            if ($value -cnotmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') { throw "REMOTE_WINDOWS_$name must be a GUID." }
            $config[$name] = $value
        }
        $endpoint = Get-RemoteRequiredValue $Values 'AZURE_ENDPOINT'
        $uri = [Uri]$endpoint
        if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne 'https' -or $uri.Host -cnotmatch '^[a-z0-9-]+\.codesigning\.azure\.net$' -or $uri.Port -ne 443 -or $uri.UserInfo -ne '' -or $uri.Query -ne '' -or $uri.Fragment -ne '' -or $uri.AbsolutePath -ne '/') {
            throw 'Azure endpoint must be an HTTPS regional codesigning.azure.net endpoint without credentials or a path.'
        }
        $config.Endpoint = $uri.AbsoluteUri.TrimEnd('/')
        foreach ($name in @('AZURE_ACCOUNT_NAME', 'AZURE_CERTIFICATE_PROFILE_NAME')) {
            $value = Get-RemoteRequiredValue $Values $name
            if ($value -cnotmatch '^[A-Za-z0-9][A-Za-z0-9-]{1,99}$') { throw "REMOTE_WINDOWS_$name must contain only letters, digits, and hyphens." }
            $config[$name] = $value
        }
    } else {
        $thumbprint = Get-RemoteRequiredValue $Values 'CERTIFICATE_THUMBPRINT'
        if ($thumbprint -cnotmatch '^[a-fA-F0-9]{40}$') { throw 'Certificate thumbprint must be exactly 40 hexadecimal characters.' }
        $config.Thumbprint = $thumbprint.ToUpperInvariant()
        $location = Get-RemoteRequiredValue $Values 'CERTIFICATE_STORE_LOCATION'
        if ($location -cnotin @('CurrentUser', 'LocalMachine')) { throw 'Certificate store location must be CurrentUser or LocalMachine.' }
        $config.StoreLocation = $location
        $config.SignToolPath = Get-RemoteRequiredValue $Values 'SIGNTOOL_PATH'
        if ($config.SignToolPath -cnotmatch '^[A-Za-z]:\\.+\\signtool\.exe$' -or $config.SignToolPath -match '[\r\n]') { throw 'SignTool must be an absolute local Windows path ending in signtool.exe.' }
        $timestamp = Get-RemoteRequiredValue $Values 'TIMESTAMP_URL'
        $uri = [Uri]$timestamp
        if (-not $uri.IsAbsoluteUri -or $uri.Scheme -notin @('http', 'https') -or $uri.UserInfo -ne '' -or $uri.Fragment -ne '' -or $uri.Query -ne '') { throw 'Timestamp URL must be an absolute HTTP(S) URL without credentials, a query, or a fragment.' }
        $config.TimestampUrl = $uri.AbsoluteUri
    }
    return [pscustomobject]$config
}

function Get-RemoteRequiredValue {
    param([hashtable]$Values, [string]$Name)
    $value = [string]$Values[$Name]
    if ([string]::IsNullOrWhiteSpace($value) -or $value -cne $value.Trim()) { throw "REMOTE_WINDOWS_$Name is required and must not have surrounding whitespace." }
    return $value
}

function Assert-RemoteWindows {
    if (-not $IsWindows) { throw 'Authenticode signing, verification, and executable self-check require Windows and PowerShell 7.' }
}

function Get-RemotePackageFiles {
    param([Parameter(Mandatory)][string]$PackageDirectory)
    $root = Get-Item -LiteralPath $PackageDirectory -Force
    if (-not $root.PSIsContainer) { throw 'Package directory must be a directory.' }
    for ($item = $root; $null -ne $item; $item = $item.Parent) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Package paths cannot contain links: $($item.FullName)" }
    }
    $items = @(Get-ChildItem -LiteralPath $root.FullName -Recurse -Force)
    foreach ($item in $items) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Package paths cannot contain links: $($item.FullName)" }
    }
    foreach ($name in $RemoteOwnedBinaries) {
        $file = Get-Item -LiteralPath (Join-Path $root.FullName $name) -Force
        if ($file.PSIsContainer -or $file.Length -eq 0) { throw "Application binary is missing or empty: $name" }
    }
    return @($items | Where-Object { -not $_.PSIsContainer })
}

function New-RemoteSigningSnapshot {
    param([string]$PackageDirectory)
    $root = (Get-Item -LiteralPath $PackageDirectory).FullName
    $hashes = [ordered]@{}
    foreach ($file in Get-RemotePackageFiles $root) {
        $relative = [IO.Path]::GetRelativePath($root, $file.FullName).Replace('\', '/')
        $hashes[$relative] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
    }
    return $hashes
}

function Assert-RemoteUnchangedDependencies {
    param([string]$PackageDirectory, [System.Collections.IDictionary]$Before, [switch]$AllowOwnedChanges)
    $after = New-RemoteSigningSnapshot $PackageDirectory
    if ($after.Count -ne $Before.Count) { throw 'Signing changed the package file list.' }
    foreach ($name in $Before.Keys) {
        if (-not $after.Contains($name)) { throw "Signing removed package file: $name" }
        if ($Before[$name] -cne $after[$name] -and -not ($AllowOwnedChanges -and $name -cin $RemoteOwnedBinaries)) { throw "An unexpected package file changed: $name" }
    }
}

function Assert-RemoteSignatureIdentity {
    param($Signature, $Configuration, [string]$Name)
    if ([string]$Signature.Status -cne 'Valid' -or [string]$Signature.SignatureType -cne 'Authenticode') { throw "Authenticode verification failed: $Name ($($Signature.Status))" }
    if ($null -eq $Signature.SignerCertificate -or $null -eq $Signature.TimeStamperCertificate) { throw "A signer and a trusted timestamp are required: $Name" }
    if ($Signature.SignerCertificate.Subject -cne $Configuration.Subject) { throw "Unexpected publisher identity: $Name" }
    if ($Configuration.Mode -eq 'certificate-store' -and $Signature.SignerCertificate.Thumbprint -cne $Configuration.Thumbprint) { throw "Unexpected certificate thumbprint: $Name" }
}

function Assert-RemoteCertificateChain {
    param([System.Security.Cryptography.X509Certificates.X509Certificate2]$Certificate, [string]$Purpose)
    $chain = [System.Security.Cryptography.X509Certificates.X509Chain]::new()
    try {
        $chain.ChainPolicy.RevocationMode = [System.Security.Cryptography.X509Certificates.X509RevocationMode]::Online
        $chain.ChainPolicy.RevocationFlag = [System.Security.Cryptography.X509Certificates.X509RevocationFlag]::ExcludeRoot
        $chain.ChainPolicy.VerificationFlags = [System.Security.Cryptography.X509Certificates.X509VerificationFlags]::NoFlag
        $chain.ChainPolicy.UrlRetrievalTimeout = [TimeSpan]::FromSeconds(30)
        $null = $chain.ChainPolicy.ApplicationPolicy.Add([System.Security.Cryptography.Oid]::new($Purpose))
        if (-not $chain.Build($Certificate)) { throw "Certificate trust or revocation verification failed: $($Certificate.Subject)" }
    } finally { $chain.Dispose() }
}

function Get-RemoteSignTool {
    param($Configuration)
    Assert-RemoteWindows
    if ($Configuration.Mode -eq 'certificate-store') {
        $path = $Configuration.SignToolPath
    } else {
        $sdk = Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Windows Kits/10/bin'
        $versions = @(Get-ChildItem -LiteralPath $sdk -Directory | Where-Object { $_.Name -match '^10\.\d+\.\d+\.\d+$' } | Sort-Object { [version]$_.Name } -Descending)
        $path = $null
        foreach ($version in $versions) {
            $candidate = Join-Path $version.FullName 'x64/signtool.exe'
            if (Test-Path -LiteralPath $candidate -PathType Leaf) { $path = $candidate; break }
        }
        if ($null -eq $path) { throw 'Windows SDK x64 SignTool is required for signature verification.' }
    }
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'Configured SignTool does not exist.' }
    $signature = Get-AuthenticodeSignature -LiteralPath $path
    if ([string]$signature.Status -cne 'Valid') { throw 'SignTool must have a valid trusted Authenticode signature.' }
    return $path
}

function Test-RemoteSignatureFile {
    param([string]$Path, $Configuration, [string]$SignTool)
    $name = Split-Path -Leaf $Path
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    Assert-RemoteSignatureIdentity $signature $Configuration $name
    Assert-RemoteCertificateChain $signature.SignerCertificate '1.3.6.1.5.5.7.3.3'
    Assert-RemoteCertificateChain $signature.TimeStamperCertificate '1.3.6.1.5.5.7.3.8'
    & $SignTool verify /pa /all /tw /v $Path | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "SignTool verification failed: $name ($LASTEXITCODE)" }
    return [ordered]@{ Name = $name; SHA256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant(); Subject = $signature.SignerCertificate.Subject; Thumbprint = $signature.SignerCertificate.Thumbprint; TimestampThumbprint = $signature.TimeStamperCertificate.Thumbprint }
}

function Test-RemotePackageSignatures {
    param([string]$PackageDirectory, $Configuration)
    Assert-RemoteWindows
    if ($Configuration.Mode -eq 'none') { throw 'Signature verification requires a signed mode.' }
    $null = Get-RemotePackageFiles $PackageDirectory
    $tool = Get-RemoteSignTool $Configuration
    foreach ($name in $RemoteOwnedBinaries) {
        Test-RemoteSignatureFile (Join-Path $PackageDirectory $name) $Configuration $tool
    }
}

function Invoke-RemoteStoreSigning {
    param([string]$PackageDirectory, $Configuration)
    Assert-RemoteWindows
    if ($Configuration.Mode -ne 'certificate-store') { throw 'Certificate-store signing requires the certificate-store mode.' }
    $null = Get-RemotePackageFiles $PackageDirectory
    $tool = Get-RemoteSignTool $Configuration
    $certificatePath = "Cert:\$($Configuration.StoreLocation)\My\$($Configuration.Thumbprint)"
    $certificate = Get-Item -LiteralPath $certificatePath
    if (-not $certificate.HasPrivateKey -or $certificate.Subject -cne $Configuration.Subject -or $certificate.Thumbprint -cne $Configuration.Thumbprint -or $certificate.NotBefore -gt [DateTime]::Now -or $certificate.NotAfter -le [DateTime]::Now) { throw 'The selected store certificate must match the publisher and thumbprint, be valid now, and have a private key.' }
    Assert-RemoteCertificateChain $certificate '1.3.6.1.5.5.7.3.3'
    foreach ($name in $RemoteOwnedBinaries) {
        $arguments = @('sign', '/sha1', $Configuration.Thumbprint, '/s', 'My', '/fd', 'SHA256', '/tr', $Configuration.TimestampUrl, '/td', 'SHA256')
        if ($Configuration.StoreLocation -eq 'LocalMachine') { $arguments += '/sm' }
        $arguments += Join-Path $PackageDirectory $name
        & $tool @arguments | Out-Host
        if ($LASTEXITCODE -ne 0) { throw "Certificate-store signing failed; no retry or unsigned fallback: $name ($LASTEXITCODE)" }
        $null = Test-RemoteSignatureFile (Join-Path $PackageDirectory $name) $Configuration $tool
    }
}
