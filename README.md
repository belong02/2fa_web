# TOTP

一个纯前端、本地优先的 TOTP 验证码管理器。项目不依赖后端服务和构建工具，直接通过浏览器运行，支持添加、查看、复制、导入、导出和离线使用一次性验证码。

## 功能特性

- 生成 TOTP 动态验证码，支持 6 位和 8 位验证码。
- 支持手动输入 Base32 密钥，也支持粘贴 `otpauth://` 链接自动解析。
- 支持 `SHA-1`、`SHA-256`、`SHA-512` 算法，周期支持 10 到 300 秒。
- 密钥数据本地保存，并使用 Web Crypto `AES-GCM` 加密后写入 `localStorage`。
- 加密用的本机密钥以不可导出的 `CryptoKey` 形式保存到 IndexedDB。
- 敏感操作需要权限密码，包括查看密钥、编辑、删除、清空和导出。
- 权限密码使用 PBKDF2-SHA-256 哈希校验，默认迭代次数为 150000。
- 支持 WebAuthn / Passkey 本机验证，用于忘记权限密码后的重置流程。
- 支持批量导入、批量导出、批量删除。
- 支持自动匹配平台图标、选择预置图标或导入自定义图标。
- 内置 PWA manifest 和 Service Worker，可安装到桌面/移动端并缓存静态资源。
- 启动后会检测设备时间与网络时间的偏差，提醒 TOTP 可能失效的时间同步问题。
- 设置了较严格的 Content Security Policy，默认仅允许加载本项目自身资源。

## 项目结构

```text
.
├── index.html             # 页面结构、CSP、PWA 入口
├── styles.css             # 响应式界面样式
├── script.js              # TOTP、存储、权限校验、导入导出、PWA 注册等核心逻辑
├── sw.js                  # Service Worker 静态资源缓存
├── manifest.webmanifest   # PWA 应用声明
├── pwa-icon.svg           # SVG 图标
├── pwa-icon-192.png       # PWA 192px 图标
└── pwa-icon-512.png       # PWA 512px 图标
```

## 快速开始

这是一个静态站点，没有 `npm install` 或构建步骤。推荐通过本地静态服务器访问，而不是直接双击打开 `index.html`，因为 Service Worker、Clipboard、WebAuthn 等能力需要安全上下文。

使用 Python:

```bash
python -m http.server 8080
```

或在 Windows 上:

```bash
py -m http.server 8080
```

然后访问:

```text
http://localhost:8080/
```

部署到线上时，将整个目录作为静态站点发布即可。为了完整启用 PWA 和 WebAuthn，请使用 HTTPS。

## 使用说明

1. 打开页面后点击右上角管理按钮。
2. 点击添加按钮，填写平台、账号和密钥。
3. 密钥可以是 Base32 setup key，也可以直接粘贴 `otpauth://totp/...` 链接。
4. 保存后首页会显示验证码卡片，点击卡片可展开，点击复制按钮可复制当前验证码。
5. 在密钥管理中可以编辑、显示/隐藏密钥、删除、批量导出或导入备份。

首次进行查看密钥、编辑、删除、清空、导出等敏感操作时，需要设置权限密码。之后执行这些操作时需要再次验证权限密码。

## 导入与导出

导出文件是 JSON，文件名默认为:

- `totp-backup-all.json`
- `totp-backup-selected.json`

导出的内容是明文密钥备份，请将备份文件保存在安全位置，不要上传到不可信网盘、聊天窗口或公共仓库。

支持导入数组格式。每一项可以是账户对象:

```json
[
  {
    "issuer": "GitHub",
    "account": "name@example.com",
    "secret": "JBSWY3DPEHPK3PXP",
    "digits": 6,
    "period": 30,
    "algorithm": "SHA-1",
    "icon": { "type": "auto" }
  }
]
```

也可以是字符串形式的 Base32 密钥，或对象中的 `secret` 字段直接放 `otpauth://` 链接。

## 本地数据与安全边界

浏览器本地会使用这些存储:

- `localStorage.local_totp_accounts_v2`: 加密后的账户数据。
- `IndexedDB.local_totp_crypto_keys_v1`: 本机 AES-GCM 加密密钥。
- `localStorage.local_totp_permission_password_v1`: 权限密码的盐、哈希和迭代次数。
- `localStorage.local_totp_secret_view_passkey_v1`: 本机验证凭据元数据。

需要注意:

- 页面不会把密钥上传到服务器；验证码在浏览器本地生成。
- 网络请求只用于设备时间偏差检测，目标为 `worldtimeapi.org` 和 `timeapi.io`。
- 权限密码用于保护敏感操作入口，不是用户自选的数据加密口令。
- 如果清除了站点数据，IndexedDB 中的本机加密密钥也会丢失，原本加密在 `localStorage` 的账户数据将无法解密。请提前导出备份。
- 导出的备份是明文 JSON，不受本地加密保护。

## PWA 与缓存

`sw.js` 会缓存以下静态资源:

- `index.html`
- `styles.css`
- `script.js`
- `manifest.webmanifest`
- PWA 图标文件

当前缓存版本为 `totp-static-v2`。如果修改了静态资源并希望强制刷新旧缓存，可以更新 `sw.js` 中的 `CACHE_NAME`。

## 浏览器兼容性

推荐使用新版 Chrome、Edge、Safari 或 Firefox。完整体验需要浏览器支持:

- Web Crypto API
- IndexedDB
- Clipboard API
- Service Worker
- WebAuthn / Passkey，用于本机验证和权限密码重置

WebAuthn、Service Worker 等能力通常要求 HTTPS，`localhost` / `127.0.0.1` 在现代浏览器中通常也会被视为安全上下文。

## 当前限制

- 只支持 TOTP，不支持 HOTP。
- 验证码位数只支持 6 位或 8 位。
- 密钥导入不包含扫码功能，需要复制 Base32 密钥或 `otpauth://` 链接。
- 自定义图标限制为 1MB 以内，支持 PNG、JPG、WebP、GIF、SVG 和 ICO。

