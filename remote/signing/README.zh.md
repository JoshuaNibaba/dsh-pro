# DSH Remote 发布签名

[English](README.md) | 中文

## 概述

供维护者为原生 [Mac](../README.zh.md) 和 [Windows](../windows/README.zh.md) 客户端配置签名的参考。加入流水线并不等于取得证书或完成身份注册。未配置时，Mac 发布使用 ad-hoc 签名，Windows 发布保持未签名；发布说明会注明该状态。明确选择正式签名模式后，必须通过验证才能发布；配置缺失或签名失败会停止发布。

## 目录

- [账号与费用](#accounts-and-costs)
- [Mac 配置](#mac-configuration)
- [Windows 配置](#windows-configuration)
- [发布验证](#release-verification)
- [开发说明](#dev-note)

<a id="accounts-and-costs"></a>

## 账号与费用

| 平台 | 启用签名前需要取得的资源 |
|---|---|
| macOS | [Apple Developer Program](https://developer.apple.com/programs/enroll/) 会员，通常为每会员年 99 美元或当地等值费用；带私钥的 Developer ID Application 证书；Apple 公证凭据。个人和组织账号均需通过 Apple 身份审核。 |
| Windows，Azure | 付费 Azure 订阅、[Artifact Signing](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart) 账号、已验证身份和 **Public Trust** 证书配置文件。订阅前确认最新地区资格与价格：目前个人仅限美国和加拿大；组织支持的国家更多，但目前不包括中国大陆。面向公众下载时，Private Trust 不能替代 Public Trust。 |
| Windows，证书存储 | CA 签发的公开受信任代码签名证书、硬件令牌或 HSM 或受支持的远程 KSP，以及专用 Windows 签名运行器。身份审核、费用和无人值守签名支持因提供商而异，购买前需确认。 |
| Windows，开源选项 | [SignPath Foundation](https://signpath.org/apply) 接受符合条件的开源项目申请。必须获批，不能保证通过；本实现未集成其签名服务。 |

不要把私钥或密码粘贴到聊天、源码、Issue 或工作流日志中。下面标为 Secret 的 Mac 配置应保存在 GitHub **Settings → Secrets and variables → Actions** 中。非敏感配置设为仓库 Variables。Windows 硬件或云端私钥留在提供商处。账号注册、身份验证和购买由所有者本人完成。

<a id="mac-configuration"></a>

## Mac 配置

在可信 Mac 上按 [Apple 证书说明](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)创建 **Developer ID Application** 证书。在钥匙串访问中，将证书及其私钥一起导出为受密码保护的 `.p12`。为用于公证的 Apple 账号生成[应用专用密码](https://support.apple.com/102654)，不要使用账号的普通密码。该账号必须属于证书所在团队。

| GitHub 名称 | 类型 | 内容 |
|---|---|---|
| `REMOTE_MAC_CERTIFICATE_P12_BASE64` | Secret | 导出 `.p12` 的 Base64，必须包含私钥。Base64 是编码，不是加密。 |
| `REMOTE_MAC_CERTIFICATE_PASSWORD` | Secret | 非空的 `.p12` 导出密码。 |
| `REMOTE_MAC_APPLE_ID` | Secret | 用于公证的 Apple 账号邮箱。 |
| `REMOTE_MAC_APP_SPECIFIC_PASSWORD` | Secret | 该账号的应用专用密码。 |
| `REMOTE_MAC_SIGNING_IDENTITY` | Variable | 完整身份名称，例如 `Developer ID Application: Your Legal Name (ABCDE12345)`。 |
| `REMOTE_MAC_TEAM_ID` | Variable | 证书团队的十字符 ID。 |
| `REMOTE_MAC_SIGNING_MODE` | Variable | 配好其他值后设为 `developer-id`。留空或设为 `adhoc` 保持开发签名。 |

在本机对 `.p12` 编码，将结果直接填入 GitHub Secret 表单，不要提交编码后的副本。证书必须用于 Developer ID 应用分发，不能使用 Apple Development、Apple Distribution 或 Developer ID Installer。证书过期、吊销、缺失私钥或团队不匹配时，应先修正证书配置再重试。

[Mac 工作流](../../.github/workflows/dsh-remote-mac.yml)在 PR 上执行不使用凭据的测试与构建。主线发布会把证书导入私有临时钥匙串，启用强化运行时（hardened runtime）和安全时间戳签名，核对身份与团队，最多等待 30 分钟完成 Apple 公证，附加并验证公证票据，最后要求 Gatekeeper 验收通过。ZIP 包含已附加票据的应用。成功打包前会删除钥匙串和临时凭据，并恢复原搜索列表。请使用专用 macOS 构建会话，不要让共用用户钥匙串搜索列表的本地签名进程并发运行。

[签名脚本](../mac/sign-release.sh)报告失败阶段，不输出可能包含凭据的工具日志。超时或拒绝会停止发布。请检查 Apple 服务状态、会员协议、凭据和证书访问权限，修正原因后重新运行工作流。[权限声明](../mac/entitlements.plist)保留强化运行时下的麦克风输入能力，不关闭运行时保护。

<a id="windows-configuration"></a>

## Windows 配置

`REMOTE_WINDOWS_SIGNING_MODE` 可选 `none`（也是未设置时的默认值）、`azure` 或 `certificate-store`。签名任务只在 `main` 上运行，并等待普通构建成功。启用任一正式签名模式前，创建 GitHub 环境 **remote-windows-signing**，将可部署分支限制为 `main`，并按签名策略配置人工审批。下面的变量放在仓库作用域，使任务调度能读取。PR 构建使用托管运行器，不能进入签名任务。

固定签名列表为 `DSH Remote.exe`、`DSH Remote.dll` 和 `DshRemote.Core.dll`。流水线保留第三方文件，为客户端文件添加 SHA-256 签名和 RFC 3161 时间戳，按配置的身份验证受信任 Authenticode 签名，再次执行程序依赖检查，然后生成 ZIP 并计算 SHA-256。单独的校验和不能证明发布者身份。

### Azure Artifact Signing

先创建并验证 Public Trust 配置文件。为 Entra 身份配置 [GitHub OIDC 联合身份](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect)，并授予目标配置文件上的 **Artifact Signing Certificate Profile Signer** 角色。发行方为 `https://token.actions.githubusercontent.com`，受众为 `api://AzureADTokenExchange`，主题为 `repo:OWNER/REPO:environment:remote-windows-signing`，其中仓库名替换为实际值。此路径使用短期 OIDC 凭据，不使用客户端密钥。

| 仓库变量 | 内容 |
|---|---|
| `REMOTE_WINDOWS_AZURE_CLIENT_ID` | 联合身份的应用或客户端 ID。 |
| `REMOTE_WINDOWS_AZURE_TENANT_ID` | Entra 租户 ID。 |
| `REMOTE_WINDOWS_AZURE_SUBSCRIPTION_ID` | 签名账号所属的付费订阅。 |
| `REMOTE_WINDOWS_AZURE_ENDPOINT` | 与账号资源所在区域匹配的服务端点。 |
| `REMOTE_WINDOWS_AZURE_ACCOUNT_NAME` | Artifact Signing 账号名称。 |
| `REMOTE_WINDOWS_AZURE_CERTIFICATE_PROFILE_NAME` | 已验证的 Public Trust 证书配置文件名称。 |
| `REMOTE_WINDOWS_SIGNER_SUBJECT` | 获批配置文件签发证书的完整 Subject，以 Windows 显示值为准。 |
| `REMOTE_WINDOWS_SIGNING_MODE` | `azure`。 |

[Windows 工作流](../../.github/workflows/dsh-remote-windows.yml)固定了官方 Azure 登录和 Artifact Signing 动作的提交版本。Azure 会在签名时验证授权、资格和端点。私有信任、自签名或不受信任证书不能通过托管运行器上的公开发布验证。

### 证书存储与硬件密钥

准备专用的 Windows x64 自托管运行器，标签为 `self-hosted`、`Windows`、`X64` 和 `remote-windows-signing`。安装 PowerShell 7、Windows SDK SignTool 以及提供商的令牌、HSM 或 KSP 软件。将公钥证书与私钥关联到运行器账号的 `CurrentUser\My` 存储，或明确使用 `LocalMachine\My` 并配置适当访问权限。只导入公钥证书并不能获得签名密钥。参见 [SignTool](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool) 和 [DigiCert KSP 示例](https://docs.digicert.com/en/software-trust-manager/code-signing/sign-with-third-party-signing-tools/windows-applications/sign-authenticode-files-with-signtool-using-ksp-library.html)。

| 仓库变量 | 内容 |
|---|---|
| `REMOTE_WINDOWS_SIGNER_SUBJECT` | 签名证书的完整 Subject，以 Windows 显示值为准。 |
| `REMOTE_WINDOWS_CERTIFICATE_THUMBPRINT` | 用于选择签名身份的 SHA-1 证书指纹；文件签名仍使用 SHA-256。 |
| `REMOTE_WINDOWS_CERTIFICATE_STORE_LOCATION` | 明确设为 `CurrentUser` 或 `LocalMachine`。 |
| `REMOTE_WINDOWS_SIGNTOOL_PATH` | 已安装 SignTool 程序的绝对路径。 |
| `REMOTE_WINDOWS_TIMESTAMP_URL` | 提供商支持的 RFC 3161 时间戳端点。 |
| `REMOTE_WINDOWS_SIGNING_MODE` | `certificate-store`。 |

将 runner group 限制为受信任仓库和 `refs/heads/main` 上的此工作流。运行器标签和任务的 `if` 条件无法强制控制运行器访问：PR 可以修改工作流代码。若你的 GitHub 账号无法强制执行该 runner group 限制，不要将持有签名密钥的运行器接入接受不受信任 PR 的仓库；请使用 Azure 路径或单独隔离的签名服务。在仓库之外配置提供商认证，不要向运行器的系统信任存储安装测试根证书。需要交互式 PIN 的令牌必须使用提供商支持的无人值守配置，或在人工监督下操作。签名串行执行，不自动重试失败。PIN 错误后应停止并修正提供商配置，再次尝试前避免令牌被锁定。

<a id="release-verification"></a>

## 发布验证

完成某平台的配置后，最后设置该平台的签名模式，在 GitHub Actions 中从 `main` 手动运行 **DSH Remote (Mac)** 或 **DSH Remote (Windows)**。工作流验证成功后会更新现有滚动发布。检查任务结果和发布说明，下载公开资产并核对校验和。真实证书签名任务成功之前，不得宣称已经发布正式签名版本。

macOS 解压下载的应用后，由发布负责人验证：

```sh
codesign --verify --deep --strict --verbose=2 "DSH Remote.app"
codesign --display --verbose=4 "DSH Remote.app"
xcrun stapler validate "DSH Remote.app"
spctl --assess --type execute --verbose=4 "DSH Remote.app"
```

确认 Developer ID 身份与 TeamIdentifier 符合预期。Windows 上检查三个客户端文件的**属性 → 数字签名**，或运行 `Get-AuthenticodeSignature '.\DSH Remote\DSH Remote.exe'`，确认状态为 `Valid`、发布者符合预期且存在时间戳。签名证明发布者身份与文件完整性；[SmartScreen 信誉](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)仍可能触发提示，包括 OV、EV 和 Azure 签名的文件。不要为验证发布而关闭系统级保护。

<a id="dev-note"></a>

## 开发说明

脚本的失败分支有自动化测试，原生平台 CI 会执行未签名打包。获得凭据后，发布负责人必须验证首个真实签名构建，并在两个平台上检查交互式启动；Linux 脚本测试不能证明 Apple 公证、Windows 公开信任、麦克风行为或 Gatekeeper 与 SmartScreen 行为。
