# DSH Remote release signing

English | [中文](README.zh.md)

## Summary

Maintainer reference for signing the native [Mac](../README.md) and [Windows](../windows/README.md) clients. Adding this pipeline does not obtain a certificate or enroll an identity. Without configuration, Mac releases use ad-hoc signatures and Windows releases remain unsigned; the release notes state that status. An explicitly selected signing mode must finish verification before publication; missing configuration or signing failures stop the release.

## Table of Contents

- [Accounts and costs](#accounts-and-costs)
- [Mac configuration](#mac-configuration)
- [Windows configuration](#windows-configuration)
- [Release verification](#release-verification)
- [Dev Note](#dev-note)

<a id="accounts-and-costs"></a>

## Accounts and costs

| Platform | Obtain before enabling signing |
|---|---|
| macOS | [Apple Developer Program](https://developer.apple.com/programs/enroll/) membership, normally USD 99 per membership year or local equivalent; a Developer ID Application certificate with its private key; Apple notarization credentials. Personal and organization accounts require Apple's identity checks. |
| Windows, Azure | A paid Azure subscription, an [Artifact Signing](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart) account, verified identity and a **Public Trust** certificate profile. Check the current regional eligibility and pricing before subscribing: individuals are currently eligible only in the US and Canada; organizations have a broader supported-country list that currently excludes mainland China. Private Trust does not replace Public Trust for public downloads. |
| Windows, certificate store | A publicly trusted code-signing certificate from a CA, a hardware token/HSM or supported remote KSP, and a dedicated Windows signing runner. Identity checks, fees and unattended signing support depend on the provider; confirm them before purchase. |
| Windows, open source option | [SignPath Foundation](https://signpath.org/apply) accepts applications for eligible open-source projects. Approval is required and is not guaranteed; its signing integration is not included here. |

Do not paste private keys or passwords into chat, source files, issues or workflow logs. Put the Mac values marked Secret below in GitHub **Settings → Secrets and variables → Actions**. Configure the non-secret values as repository Variables. Windows hardware/cloud private keys remain with their provider. Account enrollment, identity verification and purchases must be completed by the owner.

<a id="mac-configuration"></a>

## Mac configuration

On a trusted Mac, create a **Developer ID Application** certificate using [Apple's certificate instructions](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/). Export the certificate and its private key together as a password-protected `.p12` from Keychain Access. Create an [app-specific password](https://support.apple.com/102654) for the Apple account used for notarization; do not use the account's ordinary password. The account must belong to the certificate's team.

| GitHub name | Kind | Value |
|---|---|---|
| `REMOTE_MAC_CERTIFICATE_P12_BASE64` | Secret | Base64 of the exported `.p12`, including its private key. Base64 is encoding, not encryption. |
| `REMOTE_MAC_CERTIFICATE_PASSWORD` | Secret | Nonempty `.p12` export password. |
| `REMOTE_MAC_APPLE_ID` | Secret | Apple account email used for notarization. |
| `REMOTE_MAC_APP_SPECIFIC_PASSWORD` | Secret | App-specific password for that account. |
| `REMOTE_MAC_SIGNING_IDENTITY` | Variable | Full identity, such as `Developer ID Application: Your Legal Name (ABCDE12345)`. |
| `REMOTE_MAC_TEAM_ID` | Variable | The certificate team's ten-character ID. |
| `REMOTE_MAC_SIGNING_MODE` | Variable | Set `developer-id` after the other values are configured. Empty or `adhoc` keeps development signing. |

Encode the `.p12` locally and enter the result directly into the GitHub Secret form; do not commit an encoded copy. The certificate must be valid for Developer ID application distribution, not Apple Development, Apple Distribution or Developer ID Installer. Certificate expiry, revocation, a missing private key or a mismatched team require correcting the certificate configuration before retrying.

The [Mac workflow](../../.github/workflows/dsh-remote-mac.yml) runs credential-free PR tests and builds. Its main-branch release imports the certificate into a private temporary keychain, signs with hardened runtime and a secure timestamp, checks the identity and team, waits up to 30 minutes for Apple notarization, staples and validates the ticket, and requires Gatekeeper acceptance. The ZIP is created from the stapled app. The keychain and temporary credentials are removed, and the previous search list is restored before successful packaging. Use a dedicated macOS build session; do not overlap local signing processes that share a user keychain search list.

The [signing script](../mac/sign-release.sh) reports the failed stage without printing credential-bearing tool output. A timeout or rejection stops publication. Check Apple service availability, membership agreements, credentials and certificate access, correct the cause, then rerun the workflow. The [entitlements](../mac/entitlements.plist) preserve microphone input under hardened runtime; they do not disable runtime protections.

<a id="windows-configuration"></a>

## Windows configuration

`REMOTE_WINDOWS_SIGNING_MODE` selects `none` (also the unset default), `azure`, or `certificate-store`. The signing job runs only for `main`, after the ordinary build has succeeded. Before enabling either signed mode, create the GitHub environment **remote-windows-signing**, restrict its deployment branches to `main`, and configure reviewer approval if required by your signing policy. Store the variables below at repository scope so job routing can read them. PR builds use hosted runners and cannot enter the signing job.

The fixed signing list is `DSH Remote.exe`, `DSH Remote.dll` and `DshRemote.Core.dll`. The pipeline retains third-party files, applies SHA-256 signatures and RFC 3161 timestamps to the client files, checks trusted Authenticode signatures against the configured identity, reruns the executable dependency check, and then packages the ZIP and calculates its SHA-256. A checksum alone does not authenticate a publisher.

### Azure Artifact Signing

Create and verify the Public Trust profile first. Configure [GitHub OIDC federation](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect) for an Entra identity with the **Artifact Signing Certificate Profile Signer** role on the intended profile. Use issuer `https://token.actions.githubusercontent.com`, audience `api://AzureADTokenExchange`, and subject `repo:OWNER/REPO:environment:remote-windows-signing`, substituting the actual repository. This path uses short-lived OIDC credentials, not a client secret.

| Repository variable | Value |
|---|---|
| `REMOTE_WINDOWS_AZURE_CLIENT_ID` | Federated identity's application/client ID. |
| `REMOTE_WINDOWS_AZURE_TENANT_ID` | Entra tenant ID. |
| `REMOTE_WINDOWS_AZURE_SUBSCRIPTION_ID` | Paid subscription containing the signing account. |
| `REMOTE_WINDOWS_AZURE_ENDPOINT` | Endpoint matching the account's resource region. |
| `REMOTE_WINDOWS_AZURE_ACCOUNT_NAME` | Artifact Signing account name. |
| `REMOTE_WINDOWS_AZURE_CERTIFICATE_PROFILE_NAME` | Verified Public Trust certificate profile name. |
| `REMOTE_WINDOWS_SIGNER_SUBJECT` | Exact certificate Subject for the approved profile, as reported by Windows. |
| `REMOTE_WINDOWS_SIGNING_MODE` | `azure`. |

The [Windows workflow](../../.github/workflows/dsh-remote-windows.yml) pins the official Azure login and Artifact Signing actions. Authorization, eligibility and the endpoint are validated by Azure during signing. A private-trust, self-signed or untrusted certificate cannot pass the public release verification on the hosted runner.

### Certificate store and hardware keys

Prepare a dedicated Windows x64 self-hosted runner with labels `self-hosted`, `Windows`, `X64` and `remote-windows-signing`. Install PowerShell 7, Windows SDK SignTool and the provider's token/HSM/KSP software. Associate the public certificate with its private key in the runner account's `CurrentUser\My` store, or explicitly use `LocalMachine\My` with appropriate access. Merely importing a public certificate does not provide a signing key. See [SignTool](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool) and [DigiCert's KSP example](https://docs.digicert.com/en/software-trust-manager/code-signing/sign-with-third-party-signing-tools/windows-applications/sign-authenticode-files-with-signtool-using-ksp-library.html).

| Repository variable | Value |
|---|---|
| `REMOTE_WINDOWS_SIGNER_SUBJECT` | Exact signing certificate Subject, as reported by Windows. |
| `REMOTE_WINDOWS_CERTIFICATE_THUMBPRINT` | SHA-1 certificate thumbprint used to select the identity; file signing still uses SHA-256. |
| `REMOTE_WINDOWS_CERTIFICATE_STORE_LOCATION` | Explicitly set `CurrentUser` or `LocalMachine`. |
| `REMOTE_WINDOWS_SIGNTOOL_PATH` | Absolute path to the installed SignTool executable. |
| `REMOTE_WINDOWS_TIMESTAMP_URL` | Provider-supported RFC 3161 timestamp endpoint. |
| `REMOTE_WINDOWS_SIGNING_MODE` | `certificate-store`. |

Restrict the runner group to trusted repositories and this workflow on `refs/heads/main`. A runner label and a job's `if` condition do not enforce runner access: a PR can change workflow code. If your GitHub account cannot enforce that runner-group restriction, do not attach a key-bearing runner to a repository accepting untrusted PRs; use the Azure path or a separately isolated signing service. Configure provider authentication outside the repository, and do not install test roots in the runner's system trust store. Tokens requiring interactive PIN prompts need a provider-supported unattended setup or supervised operation. Signing is serial; failures are not automatically retried. On a PIN failure, stop and correct the provider configuration before another attempt to avoid locking the token.

<a id="release-verification"></a>

## Release verification

After configuring a platform, set its signing mode last and manually run **DSH Remote (Mac)** or **DSH Remote (Windows)** from `main` in GitHub Actions. These workflows update the existing rolling release after verification. Review the job result and release notes, download the public asset, and compare its checksum. Do not claim a signed release until the actual certificate-backed job succeeds.

On macOS, after extracting the downloaded app, the release owner verifies:

```sh
codesign --verify --deep --strict --verbose=2 "DSH Remote.app"
codesign --display --verbose=4 "DSH Remote.app"
xcrun stapler validate "DSH Remote.app"
spctl --assess --type execute --verbose=4 "DSH Remote.app"
```

Confirm the intended Developer ID identity and TeamIdentifier. On Windows, inspect **Properties → Digital Signatures** for the three client files, or run `Get-AuthenticodeSignature '.\DSH Remote\DSH Remote.exe'` and confirm `Valid`, the expected publisher and a timestamp. Signatures establish publisher identity and file integrity; [SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation) can still produce warnings, including for OV, EV and Azure-signed files. Do not disable OS-wide protection to validate a release.

<a id="dev-note"></a>

## Dev Note

Script failure cases have automated tests, and unsigned native packaging runs in platform CI. The release owner must verify the first real signed build and interactive startup on both platforms after obtaining credentials; Linux script tests cannot establish Apple notarization, Windows public trust, microphone behavior or Gatekeeper/SmartScreen behavior.
