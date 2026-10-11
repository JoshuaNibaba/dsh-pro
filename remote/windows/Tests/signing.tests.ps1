$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot '../signing.ps1')
$script:checks = 0
function Assert-Equal($Actual, $Expected, [string]$Message) {
    if ($Actual -cne $Expected) { throw "$Message (actual: $Actual; expected: $Expected)" }
    $script:checks++
}
function Assert-Rejected([scriptblock]$Action, [string]$Pattern) {
    $failure = $null
    try { & $Action | Out-Null } catch { $failure = $_ }
    if ($null -eq $failure -or $failure.Exception.Message -notmatch $Pattern) { throw "Expected rejection matching '$Pattern'; observed '$failure'." }
    $script:checks++
}
$azure = @{
    SIGNING_MODE = 'azure'; SIGNER_SUBJECT = 'CN=Remote Test, O=Example, C=US'
    AZURE_CLIENT_ID = '11111111-1111-1111-1111-111111111111'
    AZURE_TENANT_ID = '22222222-2222-2222-2222-222222222222'
    AZURE_SUBSCRIPTION_ID = '33333333-3333-3333-3333-333333333333'
    AZURE_ENDPOINT = 'https://eus.codesigning.azure.net'
    AZURE_ACCOUNT_NAME = 'remote-test'; AZURE_CERTIFICATE_PROFILE_NAME = 'public-trust'
}
$store = @{
    SIGNING_MODE = 'certificate-store'; SIGNER_SUBJECT = 'CN=Remote Test, O=Example, C=US'
    CERTIFICATE_THUMBPRINT = ('A' * 40); CERTIFICATE_STORE_LOCATION = 'CurrentUser'
    SIGNTOOL_PATH = 'C:\Windows Kits\10\bin\x64\signtool.exe'
    TIMESTAMP_URL = 'http://timestamp.digicert.com'
}
Assert-Equal (Get-RemoteSigningConfiguration @{}).Mode 'none' 'An unset mode is unsigned'
foreach ($mode in @('Azure', 'azure ', 'store', 'unsigned', ' ')) {
    Assert-Rejected { Get-RemoteSigningConfiguration @{ SIGNING_MODE = $mode } } 'must be none'
}
Assert-Equal (Get-RemoteSigningConfiguration $azure).Mode 'azure' 'Azure configuration is accepted'
Assert-Equal (Get-RemoteSigningConfiguration $store).Thumbprint ('A' * 40) 'Store configuration is accepted'
foreach ($configuration in @($azure, $store)) {
    foreach ($key in @($configuration.Keys | Where-Object { $_ -ne 'SIGNING_MODE' })) {
        $missing = $configuration.Clone(); $missing.Remove($key)
        Assert-Rejected { Get-RemoteSigningConfiguration $missing } 'required'
        $empty = $configuration.Clone(); $empty[$key] = ' '
        Assert-Rejected { Get-RemoteSigningConfiguration $empty } 'required'
    }
}
foreach ($endpoint in @('http://eus.codesigning.azure.net', 'https://eus.codesigning.azure.net.attacker.test', 'https://user@eus.codesigning.azure.net', 'https://eus.codesigning.azure.net/path', 'https://eus.codesigning.azure.net/?query=1', 'https://eus.codesigning.azure.net:444')) {
    $bad = $azure.Clone(); $bad.AZURE_ENDPOINT = $endpoint
    Assert-Rejected { Get-RemoteSigningConfiguration $bad } 'endpoint'
}
foreach ($pair in @(@('AZURE_CLIENT_ID', 'not-a-guid'), @('AZURE_ACCOUNT_NAME', '../other'), @('SIGNER_SUBJECT', "CN=Remote`nOther"))) {
    $bad = $azure.Clone(); $bad[$pair[0]] = $pair[1]
    Assert-Rejected { Get-RemoteSigningConfiguration $bad } 'GUID|letters|distinguished name'
}
foreach ($pair in @(@('CERTIFICATE_THUMBPRINT', ('Z' * 40)), @('CERTIFICATE_STORE_LOCATION', 'Root'), @('SIGNTOOL_PATH', 'signtool.exe'), @('SIGNTOOL_PATH', '\\server\share\signtool.exe'), @('TIMESTAMP_URL', 'file:///C:/timestamp'))) {
    $bad = $store.Clone(); $bad[$pair[0]] = $pair[1]
    Assert-Rejected { Get-RemoteSigningConfiguration $bad } 'thumbprint|store location|absolute'
}
$config = Get-RemoteSigningConfiguration $store
$signature = [pscustomobject]@{
    Status = 'Valid'; SignatureType = 'Authenticode'
    SignerCertificate = [pscustomobject]@{ Subject = $config.Subject; Thumbprint = $config.Thumbprint }
    TimeStamperCertificate = [pscustomobject]@{ Subject = 'CN=Timestamp'; Thumbprint = ('B' * 40) }
}
Assert-RemoteSignatureIdentity $signature $config 'app.exe'
$script:checks++
foreach ($status in @('NotSigned', 'HashMismatch', 'NotTrusted', 'UnknownError')) {
    $bad = $signature.PSObject.Copy(); $bad.Status = $status
    Assert-Rejected { Assert-RemoteSignatureIdentity $bad $config 'app.exe' } 'verification failed'
}
$bad = $signature.PSObject.Copy(); $bad.SignatureType = 'Catalog'
Assert-Rejected { Assert-RemoteSignatureIdentity $bad $config 'app.exe' } 'verification failed'
$bad = $signature.PSObject.Copy(); $bad.TimeStamperCertificate = $null
Assert-Rejected { Assert-RemoteSignatureIdentity $bad $config 'app.exe' } 'timestamp'
$bad = $signature.PSObject.Copy(); $bad.SignerCertificate = [pscustomobject]@{ Subject = 'CN=Other'; Thumbprint = $config.Thumbprint }
Assert-Rejected { Assert-RemoteSignatureIdentity $bad $config 'app.exe' } 'publisher identity'
$bad = $signature.PSObject.Copy(); $bad.SignerCertificate = [pscustomobject]@{ Subject = $config.Subject; Thumbprint = ('B' * 40) }
Assert-Rejected { Assert-RemoteSignatureIdentity $bad $config 'app.exe' } 'thumbprint'
# Azure leaf certificates rotate; the protected publisher subject is stable.
Assert-RemoteSignatureIdentity $bad (Get-RemoteSigningConfiguration $azure) 'app.exe'
$script:checks++
$rsa = [System.Security.Cryptography.RSA]::Create(2048)
$certificate = $null
try {
    $request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=Untrusted Test', $rsa, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $certificate = $request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-1), [DateTimeOffset]::UtcNow.AddMinutes(5))
    Assert-Rejected { Assert-RemoteCertificateChain $certificate '1.3.6.1.5.5.7.3.3' } 'trust or revocation'
} finally {
    if ($null -ne $certificate) { $certificate.Dispose() }
    $rsa.Dispose()
}
$tempParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
$temp = Join-Path $tempParent ('dsh-remote-signing-test-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $temp
try {
    foreach ($name in @($RemoteOwnedBinaries) + @('WebView2Loader.dll', 'System.Private.CoreLib.dll')) {
        Set-Content -LiteralPath (Join-Path $temp $name) -Value 'fixture'
    }
    $before = New-RemoteSigningSnapshot $temp
    Assert-Equal $before.Count 5 'Snapshot includes application and vendor files'
    Assert-RemoteUnchangedDependencies $temp $before
    $own = Join-Path $temp $RemoteOwnedBinaries[0]
    Set-Content -LiteralPath $own -Value 'signed fixture'
    Assert-RemoteUnchangedDependencies $temp $before -AllowOwnedChanges
    Assert-Rejected { Assert-RemoteUnchangedDependencies $temp $before } 'unexpected package file'
    $vendor = Join-Path $temp 'WebView2Loader.dll'
    Set-Content -LiteralPath $vendor -Value 'tampered vendor'
    Assert-Rejected { Assert-RemoteUnchangedDependencies $temp $before -AllowOwnedChanges } 'WebView2Loader.dll'
    Set-Content -LiteralPath $vendor -Value 'fixture'
    $extra = Join-Path $temp 'unexpected.dll'
    Set-Content -LiteralPath $extra -Value 'extra'
    Assert-Rejected { Assert-RemoteUnchangedDependencies $temp $before -AllowOwnedChanges } 'file list'
    if ((Get-Item -LiteralPath $extra).Directory.FullName -cne $temp) { throw 'Unexpected fixture removal path.' }
    Remove-Item -LiteralPath $extra
    # A missing allowlisted binary must fail even when dependencies still exist.
    Set-Content -LiteralPath (Join-Path $temp 'DSH Remote.dll') -Value '' -NoNewline
    Assert-Rejected { Get-RemotePackageFiles $temp } 'missing or empty'
    Set-Content -LiteralPath (Join-Path $temp 'DSH Remote.dll') -Value 'fixture'
    # Process and certificate adapters are scoped to this block; no real key is accessed.
    & {
        $state = @{ Calls = [Collections.Generic.List[object]]::new(); ExitCode = 0; Verified = 0; VerificationError = $false }
        $fakeCertificate = [pscustomobject]@{ HasPrivateKey = $true; Subject = $config.Subject; Thumbprint = $config.Thumbprint; NotBefore = [DateTime]::Now.AddDays(-1); NotAfter = [DateTime]::Now.AddDays(1) }
        function Assert-RemoteWindows {}
        function Get-RemotePackageFiles { return @() }
        function Get-RemoteSignTool { return 'Invoke-TestSigningTool' }
        function Assert-RemoteCertificateChain {}
        function Get-Item {
            param([string]$LiteralPath)
            Assert-Equal $LiteralPath "Cert:\CurrentUser\My\$($config.Thumbprint)" 'The exact configured certificate is selected'
            return $fakeCertificate
        }
        function Invoke-TestSigningTool {
            $state.Calls.Add(@($args))
            Set-Variable -Scope 1 -Name LASTEXITCODE -Value $state.ExitCode
        }
        function Test-RemoteSignatureFile {
            if ($state.VerificationError) { throw 'Injected signature verification failure.' }
            $state.Verified++
        }
        Invoke-RemoteStoreSigning $temp $config
        Assert-Equal $state.Calls.Count 3 'Exactly three files are signed'
        Assert-Equal $state.Verified 3 'Each signed file is verified before continuing'
        for ($index = 0; $index -lt 3; $index++) {
            $expected = @('sign', '/sha1', $config.Thumbprint, '/s', 'My', '/fd', 'SHA256', '/tr', $config.TimestampUrl, '/td', 'SHA256', (Join-Path $temp $RemoteOwnedBinaries[$index]))
            Assert-Equal ($state.Calls[$index] -join '|') ($expected -join '|') 'SignTool receives an exact identity, SHA256 digests, timestamp, and allowlisted file'
        }
        $state.Calls.Clear(); $state.Verified = 0; $state.ExitCode = 1
        Assert-Rejected { Invoke-RemoteStoreSigning $temp $config } 'no retry or unsigned fallback'
        Assert-Equal $state.Calls.Count 1 'A failed signing request is never retried'
        Assert-Equal $state.Verified 0 'A failed signing request cannot continue to verification'
        $state.Calls.Clear(); $state.ExitCode = 0; $state.VerificationError = $true
        Assert-Rejected { Invoke-RemoteStoreSigning $temp $config } 'Injected signature verification failure'
        Assert-Equal $state.Calls.Count 1 'Signature verification failure stops subsequent hardware requests'
        $state.Calls.Clear(); $fakeCertificate.HasPrivateKey = $false
        Assert-Rejected { Invoke-RemoteStoreSigning $temp $config } 'have a private key'
        Assert-Equal $state.Calls.Count 0 'Missing private key is rejected before signing'
    }
    if (-not $IsWindows) {
        $link = Join-Path $temp 'linked-runtime'
        $null = New-Item -ItemType SymbolicLink -Path $link -Target $tempParent
        Assert-Rejected { Get-RemotePackageFiles $temp } 'cannot contain links'
        if ((Get-Item -LiteralPath $link).FullName -cne (Join-Path $temp 'linked-runtime')) { throw 'Unexpected fixture link removal path.' }
        Remove-Item -LiteralPath $link
        Assert-Rejected { Invoke-RemoteStoreSigning $temp $config } 'require Windows'
        Assert-Rejected { Test-RemotePackageSignatures $temp $config } 'require Windows'
    }
} finally {
    $resolved = (Get-Item -LiteralPath $temp).FullName
    if ($resolved -cne $temp -or (Split-Path -Parent $resolved) -cne $tempParent -or (Split-Path -Leaf $resolved) -notmatch '^dsh-remote-signing-test-[a-f0-9]{32}$') { throw 'Refusing to remove an unexpected fixture directory.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
Write-Host "Windows signing checks passed: $script:checks (configuration, identity, trust rejection, and package integrity; no real signing performed)."
