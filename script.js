const STORAGE_KEY = "local_totp_accounts_v2";
const OLD_STORAGE_KEY = "local_totp_accounts_v1";
const OLD_SECRET_VIEW_AUTH_KEY = "local_totp_secret_view_auth_v1";
const SECRET_VIEW_PASSKEY_KEY = "local_totp_secret_view_passkey_v1";
const PERMISSION_PASSWORD_KEY = "local_totp_permission_password_v1";
const PERMISSION_PASSWORD_ITERATIONS = 150000;
const ACCOUNTS_ENCRYPTION_VERSION = 2;
const ACCOUNTS_KEY_DB_NAME = "local_totp_crypto_keys_v1";
const ACCOUNTS_KEY_STORE_NAME = "keys";
const ACCOUNTS_KEY_ID = "accounts-aes-gcm-key";
const SECRET_VIEW_UNLOCK_MS = 5 * 60 * 1000;
const $ = (id) => document.getElementById(id);
let activeIndex = null;
let editingIndex = null;
let renderedAccountsKey = "";
let lastCodeCounter = "";
let currentOtpSettings = { period: 30, algorithm: "SHA-1" };
let currentIconChoice = { type: "auto" };
let iconChoiceManual = false;
let secretViewUnlockedUntil = 0;
let secretViewHideTimer = 0;
let accountsCache = [];
let accountsStorageReady = false;
let accountsStorageIssue = "";
let permissionSessionPassword = "";
let accountsCryptoKey = null;
let expandedManagerIndex = null;
const visibleSecrets = new Set();
const SUPPORTED_ALGORITHMS = new Set(["SHA-1", "SHA-256", "SHA-512"]);
const TIME_OFFSET_WARN_MS = 10000;
const TIME_ENDPOINTS = [
  {
    url: "https://worldtimeapi.org/api/timezone/Etc/UTC",
    parse: async (response) => {
      const data = await response.json();
      return Date.parse(data.utc_datetime);
    }
  },
  {
    url: "https://timeapi.io/api/time/current/zone?timeZone=UTC",
    parse: async (response) => {
      const data = await response.json();
      return Date.parse(`${data.dateTime}Z`);
    }
  }
];

const ICON_FILE_MAX_BYTES = 1024 * 1024;
const ICON_FILE_TYPES = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["webp", "image/webp"],
  ["gif", "image/gif"],
  ["svg", "image/svg+xml"],
  ["ico", "image/x-icon"]
]);
const ICON_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/ico"
]);
const ICON_PRESETS = [
  { id: "auto", label: "自动" },
  { id: "github", label: "GitHub" },
  { id: "google", label: "Google" },
  { id: "microsoft", label: "Microsoft" },
  { id: "aws", label: "AWS" },
  { id: "key", label: "密钥" },
  { id: "shield", label: "盾牌" },
  { id: "cloud", label: "云" },
  { id: "mail", label: "邮箱" },
  { id: "school", label: "学校" },
  { id: "star", label: "其他" }
];
const ICON_PRESET_IDS = new Set(ICON_PRESETS.map((item) => item.id).filter((id) => id !== "auto"));

function presetIconForIssuer(issuer) {
  const key = String(issuer || "").toLowerCase();
  if (key.includes("github")) return "github";
  if (key.includes("google") || key.includes("gmail")) return "google";
  if (key.includes("microsoft") || key.includes("outlook")) return "microsoft";
  if (key.includes("aws") || key.includes("amazon")) return "aws";
  if (key.includes("icloud") || key.includes("cloud")) return "cloud";
  if (key.includes("mail") || key.includes("email")) return "mail";
  if (key.includes("school") || key.includes("edu") || key.includes("university")) return "school";
  return "star";
}

function normalizeIconChoice(icon) {
  if (!icon || typeof icon !== "object") return { type: "auto" };
  if (icon.type === "image" && /^data:image\/(png|jpe?g|webp|gif|svg\+xml|x-icon|vnd\.microsoft\.icon|ico);base64,/i.test(icon.dataUrl || "")) {
    return {
      type: "image",
      dataUrl: String(icon.dataUrl),
      name: String(icon.name || "自定义图标")
    };
  }
  if (icon.type === "preset" && ICON_PRESET_IDS.has(icon.id)) {
    return { type: "preset", id: icon.id };
  }
  return { type: "auto" };
}

function effectiveIconChoice(issuer, icon) {
  const choice = normalizeIconChoice(icon);
  if (choice.type === "image") return choice;
  if (choice.type === "preset") return choice;
  return { type: "preset", id: presetIconForIssuer(issuer) };
}

function presetIconMarkup(id) {
  if (id === "github") return githubLogo;
  if (id === "google") return `<span class="google-g">G</span>`;
  if (id === "microsoft") return `<span class="ms-grid"><i></i><i></i><i></i><i></i></span>`;
  if (id === "aws") return `<span class="aws-word">aws</span>`;
  if (id === "key") return keyPresetIcon;
  if (id === "shield") return shieldPresetIcon;
  if (id === "cloud") return cloudPresetIcon;
  if (id === "mail") return mailPresetIcon;
  if (id === "school") return schoolPresetIcon;
  return starIcon;
}

function iconLogoHTML(source, className = "service-logo") {
  const item = typeof source === "object" && source !== null ? source : { issuer: source };
  const choice = effectiveIconChoice(item.issuer, item.icon);
  if (choice.type === "image") {
    return `<div class="${className} user-image"><img src="${escapeHTML(choice.dataUrl)}" alt="" /></div>`;
  }
  return `<div class="${className} ${choice.id}">${presetIconMarkup(choice.id)}</div>`;
}

function serviceLogo(item) {
  return iconLogoHTML(item, "service-logo");
}

function compactServiceLogo(item) {
  return iconLogoHTML(item, "service-icon");
}

const iconSvg = (body, className = "ui-icon") => `<svg class="${className}" viewBox="0 0 24 24">${body}</svg>`;
const plusIcon = iconSvg(`<path d="M12 5.2v13.6"></path><path d="M5.2 12h13.6"></path>`);
const closeIcon = iconSvg(`<path d="m6.2 6.2 11.6 11.6"></path><path d="M17.8 6.2 6.2 17.8"></path>`);
const settingsIcon = iconSvg(`<path d="M12 4.2 18.7 8v8L12 19.8 5.3 16V8L12 4.2Z"></path><circle cx="12" cy="12" r="2.55"></circle>`);
const eyeIcon = iconSvg(`<path d="M3.1 12s3.25-5.8 8.9-5.8 8.9 5.8 8.9 5.8-3.25 5.8-8.9 5.8S3.1 12 3.1 12Z"></path><circle cx="12" cy="12" r="2.8"></circle>`);
const trashIcon = iconSvg(`<path d="M5.2 7.2h13.6"></path><path d="M9.4 7.2V5.5c0-.55.45-1 1-1h3.2c.55 0 1 .45 1 1v1.7"></path><path d="M17.6 7.2 17 18.4a1.65 1.65 0 0 1-1.65 1.56h-6.7A1.65 1.65 0 0 1 7 18.4L6.4 7.2"></path><path d="M10.2 11v5.1"></path><path d="M13.8 11v5.1"></path>`);
const copyIcon = iconSvg(`<rect x="8.4" y="8.4" width="11.2" height="11.2" rx="2.2"></rect><path d="M5.6 15.6H5a1.8 1.8 0 0 1-1.8-1.8V5a1.8 1.8 0 0 1 1.8-1.8h8.8A1.8 1.8 0 0 1 15.6 5v.6"></path>`);
const uploadIcon = iconSvg(`<path d="M12 15.4V4.8"></path><path d="m7.7 9.1 4.3-4.3 4.3 4.3"></path><path d="M5.2 19.2h13.6"></path>`);
const downloadIcon = iconSvg(`<path d="M12 4.8v10.6"></path><path d="m7.7 11.1 4.3 4.3 4.3-4.3"></path><path d="M5.2 19.2h13.6"></path>`);
const checkIcon = iconSvg(`<path d="m5.3 12.6 4.1 4.1 9.3-9.4"></path>`);
const editIcon = iconSvg(`<path d="M12.5 19.2h6.8"></path><path d="M15.7 5.1a1.95 1.95 0 0 1 2.75 2.75L8 18.3l-3.35 1.05L5.7 16 15.7 5.1Z"></path>`);
const starIcon = iconSvg(`<path d="m12 3.4 2.45 5 5.5.8-4 3.88.95 5.48L12 15.98l-4.9 2.58.95-5.48-4-3.88 5.5-.8L12 3.4Z"></path>`);
const keyPresetIcon = iconSvg(`<path d="M15.45 4.25a4.45 4.45 0 0 0-4.32 5.52l-6.55 6.55a1.2 1.2 0 0 0-.35.85v1.98c0 .38.31.69.69.69H7a.9.9 0 0 0 .64-.26l.86-.86v-1.76h1.76l1.25-1.25v-1.72h1.72l1.01-1.01a4.45 4.45 0 1 0 1.21-8.73Zm1.2 4.72a1.28 1.28 0 1 1 0-2.56 1.28 1.28 0 0 1 0 2.56Z"></path>`);
const shieldPresetIcon = iconSvg(`<path d="M12 3.3 18.3 6v5.35c0 4.1-2.52 7.5-6.3 9.1-3.78-1.6-6.3-5-6.3-9.1V6L12 3.3Z"></path><path d="m9.2 12.15 1.75 1.7 3.85-4.05"></path>`, "line-icon");
const cloudPresetIcon = iconSvg(`<path d="M7.5 18.2h9.3a4 4 0 0 0 .45-7.98 5.7 5.7 0 0 0-10.62-1.5A4.8 4.8 0 0 0 7.5 18.2Z"></path>`, "line-icon");
const mailPresetIcon = iconSvg(`<rect x="4.2" y="6.4" width="15.6" height="11.2" rx="2.2"></rect><path d="m5.2 8 6.8 5.1L18.8 8"></path>`, "line-icon");
const schoolPresetIcon = iconSvg(`<path d="m3.7 9 8.3-4.2L20.3 9 12 13.2 3.7 9Z"></path><path d="M6.7 11v4.2c1.85 2 8.75 2 10.6 0V11"></path><path d="M20.3 9v5.2"></path>`, "line-icon");
const githubLogo = `<svg viewBox="0 0 98 96"><path fill="currentColor" d="M49 0C22 0 0 22 0 49c0 22 14 40 34 46 2 .4 3-1 3-2v-8c-14 3-17-6-17-6-2-6-6-8-6-8-5-3 0-3 0-3 5 0 8 6 8 6 5 8 13 6 16 4 1-4 2-6 4-8-11-1-23-6-23-24 0-5 2-10 5-13-1-1-2-6 1-13 0 0 4-1 13 5 4-1 8-2 12-2s8 1 12 2c9-6 13-5 13-5 3 7 1 12 1 13 3 3 5 8 5 13 0 18-12 23-23 24 2 2 4 5 4 10v16c0 1 1 3 4 2 20-6 34-24 34-46C98 22 76 0 49 0Z"></path></svg>`;

function migrate() {
  if (!localStorage.getItem(STORAGE_KEY) && localStorage.getItem(OLD_STORAGE_KEY)) {
    localStorage.setItem(STORAGE_KEY, localStorage.getItem(OLD_STORAGE_KEY));
  }
}

function isEncryptedAccountsRecord(value) {
  return Boolean(value && typeof value === "object" && value.encrypted === true && value.version === ACCOUNTS_ENCRYPTION_VERSION);
}

function normalizeAccountsList(value) {
  return Array.isArray(value) ? value : [];
}

function cloneAccountsList(accounts) {
  try { return JSON.parse(JSON.stringify(normalizeAccountsList(accounts))); }
  catch { return []; }
}

function loadAccounts() {
  return cloneAccountsList(accountsCache);
}

async function saveAccounts(accounts) {
  const nextAccounts = cloneAccountsList(accounts);
  const previousAccounts = accountsCache;
  accountsCache = nextAccounts;
  try {
    await persistEncryptedAccounts();
    return true;
  } catch (error) {
    accountsCache = previousAccounts;
    alert(error.message || "密钥加密保存失败");
    return false;
  }
}

function openAccountsKeyDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("当前浏览器不支持 IndexedDB，无法安全保存本机加密密钥。"));
      return;
    }

    const request = indexedDB.open(ACCOUNTS_KEY_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(ACCOUNTS_KEY_STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("打开本机密钥库失败"));
  });
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("本机密钥库操作失败"));
  });
}

async function loadStoredAccountsCryptoKey() {
  const db = await openAccountsKeyDb();
  try {
    const tx = db.transaction(ACCOUNTS_KEY_STORE_NAME, "readonly");
    const store = tx.objectStore(ACCOUNTS_KEY_STORE_NAME);
    return await idbRequest(store.get(ACCOUNTS_KEY_ID));
  } finally {
    db.close();
  }
}

async function saveStoredAccountsCryptoKey(key) {
  const db = await openAccountsKeyDb();
  try {
    const tx = db.transaction(ACCOUNTS_KEY_STORE_NAME, "readwrite");
    const store = tx.objectStore(ACCOUNTS_KEY_STORE_NAME);
    await idbRequest(store.put(key, ACCOUNTS_KEY_ID));
  } finally {
    db.close();
  }
}

async function getAccountsCryptoKey() {
  if (accountsCryptoKey) return accountsCryptoKey;
  if (!globalThis.crypto?.subtle) throw new Error("当前浏览器不支持本地加密存储。");

  const storedKey = await loadStoredAccountsCryptoKey();
  if (storedKey) {
    accountsCryptoKey = storedKey;
    return accountsCryptoKey;
  }

  accountsCryptoKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  await saveStoredAccountsCryptoKey(accountsCryptoKey);
  return accountsCryptoKey;
}

async function encryptAccounts(accounts) {
  const iv = randomBytes(12);
  const key = await getAccountsCryptoKey();
  const plaintext = new TextEncoder().encode(JSON.stringify(normalizeAccountsList(accounts)));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return {
    encrypted: true,
    version: ACCOUNTS_ENCRYPTION_VERSION,
    algorithm: "AES-GCM",
    keyStorage: "indexeddb",
    iv: bytesToBase64Url(iv),
    data: bytesToBase64Url(encrypted),
    updatedAt: Date.now()
  };
}

async function decryptAccounts(record) {
  const key = await getAccountsCryptoKey();
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(record.iv) },
    key,
    base64UrlToBytes(record.data)
  );
  return normalizeAccountsList(JSON.parse(new TextDecoder().decode(decrypted)));
}

async function persistEncryptedAccounts() {
  const encrypted = await encryptAccounts(accountsCache);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(encrypted));
  accountsStorageIssue = "";
  accountsStorageReady = true;
}

function readStoredAccounts() {
  migrate();
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}

async function unlockEncryptedAccounts(record) {
  try {
    accountsCache = await decryptAccounts(record);
    accountsStorageReady = true;
    return true;
  } catch {
    alert("密钥解密失败。请确认没有清除过本站点数据，或从备份重新导入。");
    return false;
  }
}

async function initializeAccountsStorage() {
  const stored = readStoredAccounts();
  if (isEncryptedAccountsRecord(stored)) return unlockEncryptedAccounts(stored);
  if (stored && typeof stored === "object" && stored.encrypted === true) {
    accountsCache = [];
    accountsStorageReady = false;
    accountsStorageIssue = "本地密钥数据版本不兼容。请使用对应版本导出备份，或清理本站点数据后重新导入备份。";
    return true;
  }

  accountsCache = normalizeAccountsList(stored);
  accountsStorageReady = true;
  if (!accountsCache.length) return true;

  await persistEncryptedAccounts();
  return true;
}

function normalizeSecret(secret) {
  return String(secret || "").replace(/\s+/g, "").replace(/-/g, "").toUpperCase();
}

function normalizeAlgorithm(algorithm) {
  const value = String(algorithm || "SHA-1").toUpperCase().replace(/_/g, "-");
  if (value === "SHA1") return "SHA-1";
  if (value === "SHA256") return "SHA-256";
  if (value === "SHA512") return "SHA-512";
  return value;
}

function normalizePeriod(period) {
  const value = Number(period || 30);
  if (!Number.isFinite(value) || value < 10 || value > 300) throw new Error("周期必须在 10 到 300 秒之间");
  return Math.floor(value);
}

function normalizeDigits(digits) {
  const value = Number(digits || 6);
  if (![6, 8].includes(value)) throw new Error("验证码位数只支持 6 位或 8 位");
  return value;
}

function accountDigits(item) {
  try { return normalizeDigits(item?.digits || 6); }
  catch { return 6; }
}

function accountPeriod(item) {
  try { return normalizePeriod(item?.period || 30); }
  catch { return 30; }
}

function accountAlgorithm(item) {
  const algorithm = normalizeAlgorithm(item?.algorithm || "SHA-1");
  return SUPPORTED_ALGORITHMS.has(algorithm) ? algorithm : "SHA-1";
}

function validateBase32Secret(secret, options = {}) {
  const enforceMinLength = options.enforceMinLength !== false;
  const raw = String(secret || "").trim();
  if (!raw) return { ok: false, message: "请输入 Base32 密钥，或直接粘贴 otpauth:// 链接" };
  if (/^otpauth:\/\//i.test(raw)) return { ok: false, message: "检测到 otpauth:// 链接，请先解析后保存" };

  const normalized = normalizeSecret(raw);
  if (normalized.includes("=") && !/=+$/.test(normalized)) {
    return { ok: false, message: "Base32 的 = 只能出现在末尾，密钥中间不能有 =" };
  }

  const clean = normalized.replace(/=+$/g, "");
  if (/[0189]/.test(clean)) {
    return { ok: false, message: "Base32 不包含 0、1、8、9。请确认复制的是 setup key，不是恢复码或验证码" };
  }

  const invalid = clean.match(/[^A-Z2-7]/);
  if (invalid) {
    return { ok: false, message: `密钥包含非法字符“${invalid[0]}”。Base32 只允许 A-Z 和 2-7` };
  }

  if (enforceMinLength && clean.length < 16) {
    return { ok: false, message: "密钥太短。GitHub 等服务的 setup key 通常至少 16 位 Base32" };
  }

  const bytes = base32ToBytes(clean);
  if (enforceMinLength && bytes.length < 10) {
    return { ok: false, message: "密钥强度过短，请确认不是恢复码、短信验证码或账号密码" };
  }

  return { ok: true, secret: clean, message: "密钥格式正常" };
}

function isOtpAuthUri(value) {
  return /^otpauth:\/\//i.test(String(value || "").trim());
}

function parseOtpAuthUri(value) {
  const raw = String(value || "").trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("otpauth:// 链接格式不完整，请重新复制二维码内容");
  }

  if (url.protocol !== "otpauth:") throw new Error("只支持 otpauth:// 链接");
  if (url.hostname.toLowerCase() !== "totp") throw new Error("当前只支持 TOTP 类型，不支持 HOTP");

  const secret = url.searchParams.get("secret");
  const validation = validateBase32Secret(secret);
  if (!validation.ok) throw new Error(validation.message);

  const label = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  const splitAt = label.indexOf(":");
  const labelIssuer = splitAt >= 0 ? label.slice(0, splitAt) : "";
  const labelAccount = splitAt >= 0 ? label.slice(splitAt + 1) : label;
  const issuer = url.searchParams.get("issuer") || labelIssuer || "Unknown";
  const account = labelAccount || "";
  const digits = normalizeDigits(url.searchParams.get("digits") || 6);
  const period = normalizePeriod(url.searchParams.get("period") || 30);
  const algorithm = normalizeAlgorithm(url.searchParams.get("algorithm") || "SHA-1");

  if (!SUPPORTED_ALGORITHMS.has(algorithm)) {
    throw new Error(`暂不支持 ${algorithm} 算法，只支持 SHA-1、SHA-256、SHA-512`);
  }

  return {
    issuer: issuer.trim(),
    account: account.trim(),
    secret: validation.secret,
    digits,
    period,
    algorithm
  };
}

function setSecretHint(type, message) {
  const hint = $("secretHint");
  if (!hint) return;
  hint.className = `field-hint ${type || ""}`.trim();
  hint.textContent = message;
}

function applyOtpAuthInput(value) {
  if (!isOtpAuthUri(value)) return false;
  const parsed = parseOtpAuthUri(value);
  $("issuer").value = parsed.issuer;
  $("account").value = parsed.account;
  $("secret").value = parsed.secret;
  $("digits").value = String(parsed.digits);
  currentOtpSettings = { period: parsed.period, algorithm: parsed.algorithm };
  if (!iconChoiceManual) currentIconChoice = { type: "auto" };
  renderIconPickerPreview();
  setSecretHint("ok", `已解析 otpauth 链接：${parsed.algorithm} / ${parsed.period} 秒 / ${parsed.digits} 位`);
  return true;
}

function maskSecret(secret) {
  const s = normalizeSecret(secret);
  if (!s) return "";
  const end = s.slice(-4);
  return `•••• •••• •••• ${end}`;
}

function base32ToBytes(base32) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = normalizeSecret(base32).replace(/=+$/g, "");
  let bits = "";
  const bytes = [];
  for (const char of clean) {
    const value = alphabet.indexOf(char);
    if (value === -1) throw new Error(`密钥包含非法字符“${char}”`);
    bits += value.toString(2).padStart(5, "0");
  }
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return new Uint8Array(bytes);
}

function intToBytes(counter) {
  const bytes = new Uint8Array(8);
  let value = BigInt(counter);
  for (let i = 7; i >= 0; i--) {
    bytes[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return bytes;
}

async function generateTOTP(secret, digits = 6, period = 30, algorithm = "SHA-1") {
  const safeDigits = normalizeDigits(digits);
  const safePeriod = normalizePeriod(period);
  const safeAlgorithm = normalizeAlgorithm(algorithm);
  if (!SUPPORTED_ALGORITHMS.has(safeAlgorithm)) throw new Error(`暂不支持 ${safeAlgorithm} 算法`);

  const keyBytes = base32ToBytes(secret);
  const counter = Math.floor(Date.now() / 1000 / safePeriod);
  const counterBytes = intToBytes(counter);
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: safeAlgorithm }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, counterBytes);
  const hmac = new Uint8Array(signature);
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(binary % 10 ** safeDigits).padStart(safeDigits, "0");
}

function secondsLeft(period = 30) {
  const safePeriod = normalizePeriod(period);
  return safePeriod - (Math.floor(Date.now() / 1000) % safePeriod);
}

function currentCounter(period = 30) {
  return Math.floor(Date.now() / 1000 / normalizePeriod(period));
}

function escapeHTML(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;");
}

function formatCode(code) {
  if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`;
  if (code.length === 8) return `${code.slice(0, 4)} ${code.slice(4)}`;
  return code;
}

async function copyCode(code) {
  try { await navigator.clipboard.writeText(code); }
  catch {
    const input = document.createElement("input");
    input.value = code;
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    document.body.removeChild(input);
  }
}

function bytesToBase64Url(bytes) {
  const binary = Array.from(new Uint8Array(bytes), (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function randomBytes(length = 32) {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function loadPermissionPassword() {
  try { return JSON.parse(localStorage.getItem(PERMISSION_PASSWORD_KEY) || "null"); }
  catch { return null; }
}

function savePermissionPassword(auth) {
  localStorage.setItem(PERMISSION_PASSWORD_KEY, JSON.stringify(auth));
  localStorage.removeItem(OLD_SECRET_VIEW_AUTH_KEY);
}

async function derivePermissionPasswordHash(password, saltBase64Url, iterations = PERMISSION_PASSWORD_ITERATIONS) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: base64UrlToBytes(saltBase64Url),
      iterations,
      hash: "SHA-256"
    },
    keyMaterial,
    256
  );
  return bytesToBase64Url(bits);
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function loadSecretViewPasskey() {
  try { return JSON.parse(localStorage.getItem(SECRET_VIEW_PASSKEY_KEY) || "null"); }
  catch { return null; }
}

function saveSecretViewPasskey(passkey) {
  localStorage.setItem(SECRET_VIEW_PASSKEY_KEY, JSON.stringify(passkey));
  localStorage.removeItem(OLD_SECRET_VIEW_AUTH_KEY);
}

function isLoopbackHost() {
  const hostname = location.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "::1" ||
    hostname === "127.0.0.1" ||
    hostname.startsWith("127.");
}

function localhostUrl() {
  const port = location.port ? `:${location.port}` : "";
  return `http://localhost${port}${location.pathname}${location.search}${location.hash}`;
}

function webAuthnSupportIssue() {
  if (!window.isSecureContext) {
    if (isLoopbackHost()) {
      return `当前地址 ${location.origin} 是本地地址，但浏览器没有把它识别为安全上下文。请试试 ${localhostUrl()}，或换新版 Edge/Chrome。`;
    }
    return "本机验证需要 HTTPS，或使用 localhost / 127.0.0.1 这类本地地址打开。";
  }

  if (!globalThis.crypto?.getRandomValues) return "当前浏览器缺少安全随机数能力，无法使用本机验证。";
  if (!window.PublicKeyCredential) return "当前浏览器没有开放 WebAuthn/Passkey API。请使用新版 Edge/Chrome，并优先用 localhost 地址打开。";
  if (!navigator.credentials?.create || !navigator.credentials?.get) return "当前浏览器的 Credential Management API 不完整，无法使用本机验证。";
  return "";
}

function canUseWebAuthn() {
  return !webAuthnSupportIssue();
}

async function canUsePlatformAuthenticator() {
  if (!canUseWebAuthn()) return false;
  if (!PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) return true;
  try { return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); }
  catch { return false; }
}

function hasUserVerification(assertion) {
  const data = new Uint8Array(assertion?.response?.authenticatorData || []);
  return data.length > 32 && Boolean(data[32] & 0x04);
}

function webAuthnErrorMessage(error) {
  if (error?.name === "NotAllowedError") return "本机验证已取消或超时。";
  if (error?.name === "SecurityError") {
    if (isLoopbackHost()) return `浏览器拒绝了当前本地地址的本机验证请求。请试试 ${localhostUrl()}，或换新版 Edge/Chrome。`;
    return "浏览器拒绝了本机验证请求。请使用 HTTPS，或用 localhost / 127.0.0.1 本地地址打开。";
  }
  if (error?.name === "InvalidStateError") return "这台设备已经注册过本网站凭据，请直接重新点击显示密钥进行验证。";
  return error?.message || "本机验证失败，请确认当前浏览器支持 Windows Hello、Touch ID 或系统解锁验证。";
}

function scheduleSecretAutoHide() {
  window.clearTimeout(secretViewHideTimer);
  const delay = Math.max(0, secretViewUnlockedUntil - Date.now());
  secretViewHideTimer = window.setTimeout(() => {
    visibleSecrets.clear();
    renderManager();
  }, delay + 250);
}

function showAuthDialog({ title, message, okText = "继续", cancelText = "取消" }) {
  return new Promise((resolve) => {
    const mask = document.createElement("div");
    mask.className = "auth-mask";
    mask.innerHTML = `
      <section class="auth-dialog" role="dialog" aria-modal="true" aria-label="${escapeHTML(title)}">
        <div class="auth-title">${escapeHTML(title)}</div>
        <div class="auth-message">${escapeHTML(message)}</div>
        <div class="auth-actions">
          <button type="button" class="auth-cancel">${escapeHTML(cancelText)}</button>
          <button type="button" class="primary auth-ok">${escapeHTML(okText)}</button>
        </div>
      </section>`;

    const close = (value) => {
      document.removeEventListener("keydown", onKeydown);
      mask.remove();
      resolve(value);
    };
    const onKeydown = (event) => {
      if (event.key === "Escape") close(null);
      if (event.key === "Enter") close(true);
    };

    mask.querySelector(".auth-cancel").onclick = () => close(null);
    mask.querySelector(".auth-ok").onclick = () => close(true);
    mask.addEventListener("click", (event) => { if (event.target === mask) close(null); });
    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(mask);
    mask.querySelector(".auth-ok").focus();
  });
}

function showConfirmDialog({ title = "确认操作", message, okText = "确定", cancelText = "取消", danger = false }) {
  return new Promise((resolve) => {
    const mask = document.createElement("div");
    mask.className = "confirm-mask";
    mask.innerHTML = `
      <section class="confirm-dialog" role="dialog" aria-modal="true" aria-label="${escapeHTML(title)}">
        <div class="confirm-title">${escapeHTML(title)}</div>
        <div class="confirm-message">${escapeHTML(message)}</div>
        <div class="confirm-actions">
          <button type="button" class="confirm-ok ${danger ? "danger" : "primary"}">${escapeHTML(okText)}</button>
          <button type="button" class="confirm-cancel">${escapeHTML(cancelText)}</button>
        </div>
      </section>`;

    const close = (value) => {
      document.removeEventListener("keydown", onKeydown);
      mask.remove();
      resolve(value);
    };
    const onKeydown = (event) => {
      if (event.key === "Escape") close(false);
      if (event.key === "Enter") close(true);
    };

    mask.querySelector(".confirm-cancel").onclick = () => close(false);
    mask.querySelector(".confirm-ok").onclick = () => close(true);
    mask.addEventListener("click", (event) => { if (event.target === mask) close(false); });
    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(mask);
    mask.querySelector(".confirm-ok").focus();
  });
}

function showPermissionPasswordDialog({ title, message, mode = "verify", allowForgot = false }) {
  return new Promise((resolve) => {
    const setting = mode === "set";
    const mask = document.createElement("div");
    mask.className = "permission-mask";
    mask.innerHTML = `
      <section class="permission-dialog" role="dialog" aria-modal="true" aria-label="${escapeHTML(title)}">
        <div class="permission-title">${escapeHTML(title)}</div>
        <div class="permission-message">${escapeHTML(message)}</div>
        <input class="permission-input" type="password" autocomplete="${setting ? "new-password" : "current-password"}" placeholder="${setting ? "设置权限密码" : "输入权限密码"}" />
        ${setting ? `<input class="permission-input permission-confirm" type="password" autocomplete="new-password" placeholder="再次输入权限密码" />` : ""}
        <div class="permission-extra">
          ${allowForgot ? `<button type="button" class="permission-forgot">忘记密码</button>` : ""}
        </div>
        <div class="permission-actions">
          <button type="button" class="primary permission-ok">确定</button>
          <button type="button" class="permission-cancel">取消</button>
        </div>
      </section>`;

    const close = (value) => {
      document.removeEventListener("keydown", onKeydown);
      mask.remove();
      resolve(value);
    };
    const submit = () => {
      const password = mask.querySelector(".permission-input").value;
      const confirmation = mask.querySelector(".permission-confirm")?.value;
      if (!password) return;
      if (setting && password.length < 6) {
        alert("权限密码至少需要 6 位");
        return;
      }
      if (setting && password !== confirmation) {
        alert("两次输入不一致");
        return;
      }
      close({ type: "submit", password });
    };
    const onKeydown = (event) => {
      if (event.key === "Escape") close({ type: "cancel" });
      if (event.key === "Enter") submit();
    };

    mask.querySelector(".permission-ok").onclick = submit;
    mask.querySelector(".permission-cancel").onclick = () => close({ type: "cancel" });
    mask.querySelector(".permission-forgot")?.addEventListener("click", () => close({ type: "forgot" }));
    mask.addEventListener("click", (event) => { if (event.target === mask) close({ type: "cancel" }); });
    document.addEventListener("keydown", onKeydown);
    document.body.appendChild(mask);
    mask.querySelector(".permission-input").focus();
  });
}

async function setupPermissionPassword(title = "设置权限密码") {
  const result = await showPermissionPasswordDialog({
    title,
    message: "首次进行敏感操作需要设置权限密码，请输入两次。忘记密码时会拉起本机验证重置。",
    mode: "set"
  });
  if (result?.type !== "submit") return false;

  if (!globalThis.crypto?.subtle) {
    alert("当前浏览器不支持本地密码加密校验，无法设置权限密码。");
    return false;
  }

  const salt = randomBytes(16);
  const saltBase64Url = bytesToBase64Url(salt);
  const auth = {
    salt: saltBase64Url,
    hash: await derivePermissionPasswordHash(result.password, saltBase64Url),
    iterations: PERMISSION_PASSWORD_ITERATIONS,
    createdAt: Date.now()
  };
  savePermissionPassword(auth);
  permissionSessionPassword = result.password;
  if (accountsStorageReady) {
    try { await persistEncryptedAccounts(); }
    catch (error) { alert(error.message || "密钥加密保存失败"); return false; }
  }
  return true;
}

async function resetPermissionPasswordWithLocalVerification() {
  let passkey = loadSecretViewPasskey();
  const hasSavedPasskey = Boolean(passkey?.credentialId);
  if (!passkey?.credentialId) {
    try {
      passkey = await registerSecretViewPasskey();
      if (!passkey?.credentialId) return false;
    } catch (error) {
      alert(webAuthnErrorMessage(error));
      return false;
    }
  }

  if (hasSavedPasskey) {
    try {
      await verifySecretViewPasskey(passkey);
    } catch (error) {
      alert(webAuthnErrorMessage(error));
      return false;
    }
  }
  return setupPermissionPassword("重置权限密码");
}

async function ensurePermission(actionName = "敏感操作") {
  let auth = loadPermissionPassword();
  if (!auth?.salt || !auth?.hash) return setupPermissionPassword("设置权限密码");

  const result = await showPermissionPasswordDialog({
    title: "权限验证",
    message: `${actionName}需要输入权限密码。`,
    mode: "verify",
    allowForgot: true
  });

  if (result?.type === "forgot") {
    return resetPermissionPasswordWithLocalVerification();
  }
  if (result?.type !== "submit") return false;

  try {
    const hash = await derivePermissionPasswordHash(result.password, auth.salt, auth.iterations || PERMISSION_PASSWORD_ITERATIONS);
    if (!constantTimeEqual(hash, auth.hash)) {
      alert("权限密码错误");
      return false;
    }
    permissionSessionPassword = result.password;
    return true;
  } catch {
    alert("权限密码校验失败");
    return false;
  }
}

async function registerSecretViewPasskey() {
  const supportIssue = webAuthnSupportIssue();
  if (supportIssue) {
    alert(supportIssue);
    return null;
  }

  const available = await canUsePlatformAuthenticator();
  if (!available) {
    alert("当前浏览器支持 WebAuthn，但没有检测到可用的本机验证器。请确认系统已启用 Windows Hello、PIN、指纹或人脸识别。");
    return null;
  }

  const confirmed = await showAuthDialog({
    title: "启用本机验证",
    message: "需要创建一个只用于本网站的本机凭据。忘记权限密码时，可通过 Windows Hello、Touch ID 或系统 PIN 重置。",
    okText: "开始验证"
  });
  if (!confirmed) return null;

  const userId = randomBytes(16);
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(),
      rp: { name: "2FA 密钥管理" },
      user: {
        id: userId,
        name: "local-user",
        displayName: "本机用户"
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 }
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required"
      },
      timeout: 60000,
      attestation: "none"
    }
  });

  if (!credential?.rawId) throw new Error("没有创建有效的本机验证凭据");

  const passkey = {
    credentialId: bytesToBase64Url(credential.rawId),
    userId: bytesToBase64Url(userId),
    transports: credential.response?.getTransports?.() || ["internal"],
    origin: location.origin,
    createdAt: Date.now()
  };
  saveSecretViewPasskey(passkey);
  return passkey;
}

async function verifySecretViewPasskey(passkey) {
  const descriptor = {
    type: "public-key",
    id: base64UrlToBytes(passkey.credentialId)
  };
  if (Array.isArray(passkey.transports) && passkey.transports.length) {
    descriptor.transports = passkey.transports;
  }

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(),
      allowCredentials: [descriptor],
      userVerification: "required",
      timeout: 60000
    }
  });

  if (!hasUserVerification(assertion)) {
    throw new Error("本机验证没有返回用户验证结果。");
  }
  return true;
}

async function ensureSecretViewUnlocked() {
  const allowed = await ensurePermission("显示密钥");
  if (allowed) {
    secretViewUnlockedUntil = Date.now() + SECRET_VIEW_UNLOCK_MS;
    scheduleSecretAutoHide();
  }
  return allowed;
}

function accountsRenderKey(accounts) {
  return JSON.stringify(accounts.map(({ issuer, account, secret, digits, period, algorithm, icon }) => ({
    issuer,
    account,
    secret,
    digits,
    period,
    algorithm,
    icon
  })));
}

async function updateCodeValues(accounts = loadAccounts()) {
  await Promise.all(accounts.map(async (item, index) => {
    const codeEl = document.querySelector(`[data-code-index="${index}"]`);
    const copyBtn = document.querySelector(`[data-copy-index="${index}"]`);
    if (!codeEl || !copyBtn) return;

    let code = "------", error = "";
    try { code = await generateTOTP(item.secret, accountDigits(item), accountPeriod(item), accountAlgorithm(item)); }
    catch (e) { error = e.message || "生成失败"; }

    codeEl.textContent = error ? "ERROR" : formatCode(code);
    copyBtn.disabled = Boolean(error);
    copyBtn.dataset.code = code;
  }));
}

function updateCountdownUI() {
  document.querySelectorAll(".account").forEach((account) => {
    const period = Number(account.dataset.period || 30);
    const remain = secondsLeft(period);
    const percent = ((period - remain) / period) * 100;
    const mini = account.querySelector(".mini-count");
    const countdown = account.querySelector(".countdown");
    const bar = account.querySelector(".bar-inner");
    if (mini) mini.textContent = remain;
    if (countdown) countdown.textContent = `${remain} 秒`;
    if (bar) bar.style.width = `${percent}%`;
  });
}

function accountsCounterKey(accounts) {
  return accounts.map((item) => currentCounter(accountPeriod(item))).join("|");
}

async function refreshCodes() {
  const accounts = loadAccounts();
  const key = accountsRenderKey(accounts);
  const counter = accountsCounterKey(accounts);

  if (key !== renderedAccountsKey) {
    await renderCodes(true);
    return;
  }

  updateCountdownUI();
  if (counter !== lastCodeCounter) {
    lastCodeCounter = counter;
    await updateCodeValues(accounts);
  }
}

async function renderCodes(force = false) {
  const container = $("accounts");
  if (accountsStorageIssue) {
    container.innerHTML = `<div class="empty">${escapeHTML(accountsStorageIssue)}</div>`;
    renderedAccountsKey = "";
    lastCodeCounter = "";
    return;
  }

  const accounts = loadAccounts();
  const key = accountsRenderKey(accounts);

  if (!force && key === renderedAccountsKey) {
    updateCountdownUI();
    return;
  }

  if (accounts.length === 0) {
    container.innerHTML = `<div class="empty">暂无密钥</div>`;
    renderedAccountsKey = key;
    lastCodeCounter = accountsCounterKey(accounts);
    return;
  }

  const items = await Promise.all(accounts.map(async (item, index) => {
    const period = accountPeriod(item);
    const remain = secondsLeft(period);
    const percent = ((period - remain) / period) * 100;
    let code = "------", error = "";
    try { code = await generateTOTP(item.secret, accountDigits(item), period, accountAlgorithm(item)); }
    catch (e) { error = e.message || "生成失败"; }
    const active = activeIndex === index ? " active" : "";
    return `
      <article class="account${active}" data-index="${index}" data-period="${period}">
        <div class="account-top">
          ${compactServiceLogo(item)}
          <div>
            <div class="account-title">${escapeHTML(item.issuer || "Unknown")}</div>
            <div class="account-subtitle">${escapeHTML(item.account || "未填写")}</div>
          </div>
          <div class="mini-count">${remain}</div>
        </div>
        <div class="code-panel">
          <div class="code-row">
            <div class="code" data-code-index="${index}">${error ? "ERROR" : formatCode(code)}</div>
            <button class="copy" data-action="copy-code" data-copy-index="${index}" data-code="${code}" ${error ? "disabled" : ""}>${copyIcon}</button>
          </div>
          <div class="bar"><div class="bar-inner" style="width: ${percent}%;"></div></div>
          <div class="countdown">${remain} 秒</div>
        </div>
      </article>`;
  }));
  container.innerHTML = items.join("");
  renderedAccountsKey = key;
  lastCodeCounter = accountsCounterKey(accounts);
}

function setActive(index) {
  activeIndex = activeIndex === index ? null : index;
  document.querySelectorAll(".account").forEach((el, i) => {
    el.classList.toggle("active", activeIndex === i);
  });
}

function isCompactManagerLayout() {
  return window.innerWidth < 600;
}

function renderManager() {
  if (accountsStorageIssue) {
    $("keyList").innerHTML = `<div class="empty">${escapeHTML(accountsStorageIssue)}</div>`;
    updateSelectionState();
    return;
  }

  const accounts = loadAccounts();
  if (expandedManagerIndex !== null && expandedManagerIndex >= accounts.length) expandedManagerIndex = null;
  const list = accounts.map((item, index) => {
    if (editingIndex === index) return editRowHTML(item, index);
    const visible = visibleSecrets.has(index);
    const secretValue = visible ? normalizeSecret(item.secret || "") : maskSecret(item.secret || "");
    const expanded = expandedManagerIndex === index ? " expanded" : "";
    return `
      <div class="key-item${expanded}" data-index="${index}">
        <input type="checkbox" class="row-check" data-index="${index}" />
        ${serviceLogo(item)}
        <div class="key-id">
          <div class="key-name">${escapeHTML(item.issuer || "Unknown")}</div>
          <div class="key-account">${escapeHTML(item.account || "未填写")}</div>
        </div>
        <div class="key-secret">
          <span>${escapeHTML(secretValue)}</span>
          <button class="ghost-icon" data-action="toggle-secret" data-index="${index}" title="显示/隐藏">${eyeIcon}</button>
        </div>
        <div class="key-digits">${accountDigits(item)}</div>
        <div class="key-actions">
          <button data-action="edit-one" data-index="${index}" title="编辑">${editIcon}</button>
          <button class="danger" data-action="delete-one" data-index="${index}" title="删除">${trashIcon}</button>
        </div>
      </div>`;
  }).join("");

  $("keyList").innerHTML = list || `<div class="empty">暂无</div>`;
  updateSelectionState();
}

function editRowHTML(item, index) {
  const validation = validateBase32Secret(item.secret);
  return `
    <div class="key-item key-edit-item" data-edit-index="${index}">
      <div class="key-edit-form">
        <div>
          <label>平台</label>
          <input class="inline-issuer" value="${escapeHTML(item.issuer || "")}" autocomplete="off" />
        </div>
        <div>
          <label>账号</label>
          <input class="inline-account" value="${escapeHTML(item.account || "")}" autocomplete="off" />
        </div>
        <div>
          <label>密钥</label>
          <input class="inline-secret" value="${escapeHTML(item.secret || "")}" autocomplete="off" spellcheck="false" />
          <div class="field-hint inline-secret-hint ${validation.ok ? "ok" : "error"}">${escapeHTML(validation.message)}</div>
        </div>
        <div>
          <label>位数</label>
          <select class="inline-digits">
            <option value="6" ${accountDigits(item) === 6 ? "selected" : ""}>6</option>
            <option value="8" ${accountDigits(item) === 8 ? "selected" : ""}>8</option>
          </select>
        </div>
        <div class="key-edit-bottom">
          <div class="icon-picker">
            <label>图标</label>
            <button class="icon-picker-trigger inline-icon-picker-trigger" type="button" data-action="open-inline-icon-picker" title="选择图标"></button>
          </div>
          <div class="key-edit-actions">
            <button class="primary" data-action="save-inline-edit" data-index="${index}">保存修改</button>
            <button data-action="cancel-inline-edit">取消</button>
          </div>
        </div>
      </div>
    </div>`;
}

function updateSelectionState() {
  const checks = [...document.querySelectorAll(".row-check")];
  const selected = checks.filter(x => x.checked);
  $("selectedCount").textContent = `已选择 ${selected.length} 项`;
  $("selectAll").checked = checks.length > 0 && selected.length === checks.length;
  $("selectAll").indeterminate = selected.length > 0 && selected.length < checks.length;
}

function currentIssuerValue() {
  const inlineIssuer = editingIndex !== null ? document.querySelector(`[data-edit-index="${editingIndex}"] .inline-issuer`) : null;
  if (inlineIssuer) return inlineIssuer.value.trim();
  return $("issuer")?.value.trim() || "";
}

function savedIconChoice() {
  const choice = normalizeIconChoice(currentIconChoice);
  return iconChoiceManual ? choice : { type: "auto" };
}

function iconPickerLabel() {
  const choice = effectiveIconChoice(currentIssuerValue(), currentIconChoice);
  if (currentIconChoice.type === "image") return currentIconChoice.name || "自定义";
  if (!iconChoiceManual) return "自动";
  return ICON_PRESETS.find((item) => item.id === choice.id)?.label || "其他";
}

function renderIconPickerPreview() {
  const preview = iconLogoHTML({ issuer: currentIssuerValue(), icon: currentIconChoice }, "icon-preview-logo");
  const content = `${preview}<span>${escapeHTML(iconPickerLabel())}</span>`;
  const button = editingIndex !== null
    ? document.querySelector(`[data-edit-index="${editingIndex}"] .inline-icon-picker-trigger`)
    : $("iconPickerBtn");
  if (button) button.innerHTML = content;
  if (editingIndex === null && $("iconPickerBtn")) $("iconPickerBtn").innerHTML = content;
}

function renderIconPickerOptions() {
  const container = $("iconPickerOptions");
  if (!container) return;
  const activeChoice = effectiveIconChoice(currentIssuerValue(), currentIconChoice);
  container.innerHTML = ICON_PRESETS.map((option) => {
    const icon = option.id === "auto" ? { type: "auto" } : { type: "preset", id: option.id };
    const effective = effectiveIconChoice(currentIssuerValue(), icon);
    const selected = (option.id === "auto" && !iconChoiceManual) ||
      (currentIconChoice.type === "preset" && currentIconChoice.id === option.id) ||
      (option.id !== "auto" && activeChoice.type === "preset" && activeChoice.id === option.id && iconChoiceManual);
    return `
      <button type="button" class="icon-option${selected ? " selected" : ""}" data-icon-id="${option.id}">
        ${iconLogoHTML({ issuer: currentIssuerValue(), icon }, "icon-option-logo")}
        <span>${escapeHTML(option.label)}</span>
      </button>`;
  }).join("");
}

function setIconPickerOpen(open) {
  const dialog = $("iconPickerDialog");
  if (!dialog) return;
  if (open) renderIconPickerOptions();
  dialog.classList.toggle("hidden", !open);
}

function readIconFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) { resolve(null); return; }
    const extension = String(file.name || "").split(".").pop()?.toLowerCase() || "";
    const mime = ICON_MIME_TYPES.has(file.type) ? file.type : ICON_FILE_TYPES.get(extension);
    if (!mime) {
      reject(new Error("只支持 PNG、JPG、WebP、GIF、SVG 或 ICO 图标"));
      return;
    }
    if (file.size > ICON_FILE_MAX_BYTES) {
      reject(new Error("图标文件太大，请控制在 1MB 以内"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(`data:${mime};base64,${arrayBufferToBase64(reader.result)}`);
    reader.onerror = () => reject(new Error("图标读取失败"));
    reader.readAsArrayBuffer(file);
  });
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function resetEditor() {
  editingIndex = null;
  currentOtpSettings = { period: 30, algorithm: "SHA-1" };
  currentIconChoice = { type: "auto" };
  iconChoiceManual = false;
  $("issuer").value = "";
  $("account").value = "";
  $("secret").value = "";
  $("digits").value = "6";
  $("addBtn").textContent = "保存";
  setSecretHint("", "支持 Base32 密钥，也可以直接粘贴 otpauth:// 链接");
  renderIconPickerPreview();
  setIconPickerOpen(false);
}

function openEditor(index = null) {
  if (Number.isInteger(index)) {
    editOne(index);
    return;
  }
  const wasEditingInline = editingIndex !== null;
  editingIndex = null;
  currentOtpSettings = { period: 30, algorithm: "SHA-1" };
  currentIconChoice = { type: "auto" };
  iconChoiceManual = false;
  $("issuer").value = "";
  $("account").value = "";
  $("secret").value = "";
  $("digits").value = "6";
  $("addBtn").textContent = "添加密钥";
  setSecretHint("", "支持 Base32 密钥，也可以直接粘贴 otpauth:// 链接");
  renderIconPickerPreview();
  $("editorPanel").classList.remove("hidden");
  if (wasEditingInline) renderManager();
  $("issuer").focus();
}

function closeEditor() {
  $("editorPanel").classList.add("hidden");
  resetEditor();
}

async function editOne(index) {
  const allowed = await ensurePermission("修改密钥");
  if (!allowed) return;
  const accounts = loadAccounts();
  const item = accounts[index];
  if (!item) return;
  expandedManagerIndex = null;
  $("editorPanel").classList.add("hidden");
  editingIndex = index;
  currentOtpSettings = {
    period: accountPeriod(item),
    algorithm: accountAlgorithm(item)
  };
  currentIconChoice = normalizeIconChoice(item.icon);
  iconChoiceManual = currentIconChoice.type !== "auto";
  visibleSecrets.delete(index);
  setIconPickerOpen(false);
  renderManager();
  renderIconPickerPreview();
  document.querySelector(`[data-edit-index="${index}"] .inline-issuer`)?.focus();
}

function handleInlineIssuerInput() {
  if (!iconChoiceManual) currentIconChoice = { type: "auto" };
  renderIconPickerPreview();
  if (!$("iconPickerDialog").classList.contains("hidden")) renderIconPickerOptions();
}

function handleInlineSecretInput(input) {
  const hint = input.closest(".key-edit-form")?.querySelector(".inline-secret-hint");
  if (!hint) return;
  const value = input.value.trim();
  if (!value) {
    hint.className = "field-hint inline-secret-hint";
    hint.textContent = "支持 Base32 密钥，也可以直接粘贴 otpauth:// 链接";
    return;
  }
  if (isOtpAuthUri(value)) {
    hint.className = "field-hint inline-secret-hint ok";
    hint.textContent = "保存时会自动解析 otpauth:// 链接";
    return;
  }
  const validation = validateBase32Secret(value);
  hint.className = `field-hint inline-secret-hint ${validation.ok ? "ok" : "error"}`;
  hint.textContent = validation.message;
}

function openInlineIconPicker(event) {
  event.stopPropagation();
  renderIconPickerPreview();
  setIconPickerOpen(true);
}

function cancelInlineEdit() {
  editingIndex = null;
  currentOtpSettings = { period: 30, algorithm: "SHA-1" };
  currentIconChoice = { type: "auto" };
  iconChoiceManual = false;
  setIconPickerOpen(false);
  renderManager();
}

async function saveInlineEdit(index) {
  const accounts = loadAccounts();
  const original = accounts[index];
  const row = document.querySelector(`[data-edit-index="${index}"]`);
  if (!original || !row) return;

  let issuer = row.querySelector(".inline-issuer").value.trim();
  let account = row.querySelector(".inline-account").value.trim();
  let secretInput = row.querySelector(".inline-secret").value.trim();
  let digits = Number(row.querySelector(".inline-digits").value || 6);
  let period = accountPeriod(original);
  let algorithm = accountAlgorithm(original);

  if (isOtpAuthUri(secretInput)) {
    try {
      const parsed = parseOtpAuthUri(secretInput);
      issuer = parsed.issuer;
      account = parsed.account;
      secretInput = parsed.secret;
      digits = parsed.digits;
      period = parsed.period;
      algorithm = parsed.algorithm;
      if (!iconChoiceManual) currentIconChoice = { type: "auto" };
    } catch (e) {
      const hint = row.querySelector(".inline-secret-hint");
      if (hint) {
        hint.className = "field-hint inline-secret-hint error";
        hint.textContent = e.message || "otpauth:// 链接解析失败";
      }
      row.querySelector(".inline-secret").focus();
      return;
    }
  }

  const validation = validateBase32Secret(secretInput);
  if (!validation.ok) {
    const hint = row.querySelector(".inline-secret-hint");
    if (hint) {
      hint.className = "field-hint inline-secret-hint error";
      hint.textContent = validation.message;
    }
    row.querySelector(".inline-secret").focus();
    return;
  }
  if (!issuer) { alert("请填写平台，或粘贴包含 issuer 的 otpauth:// 链接"); return; }

  try {
    digits = normalizeDigits(digits);
    period = normalizePeriod(period);
    algorithm = normalizeAlgorithm(algorithm);
    await generateTOTP(validation.secret, digits, period, algorithm);
  } catch (e) {
    const hint = row.querySelector(".inline-secret-hint");
    if (hint) {
      hint.className = "field-hint inline-secret-hint error";
      hint.textContent = e.message || "密钥格式错误";
    }
    row.querySelector(".inline-secret").focus();
    return;
  }

  accounts[index] = {
    ...original,
    issuer,
    account,
    secret: validation.secret,
    digits,
    period,
    algorithm,
    icon: savedIconChoice()
  };
  if (!(await saveAccounts(accounts))) return;
  editingIndex = null;
  currentOtpSettings = { period: 30, algorithm: "SHA-1" };
  currentIconChoice = { type: "auto" };
  iconChoiceManual = false;
  setIconPickerOpen(false);
  renderManager();
  renderCodes();
}

async function toggleSecret(index) {
  if (visibleSecrets.has(index)) {
    visibleSecrets.delete(index);
  } else {
    const unlocked = await ensureSecretViewUnlocked();
    if (!unlocked) return;
    visibleSecrets.add(index);
  }
  renderManager();
}

async function updateField(index, field, value) {
  const accounts = loadAccounts();
  if (!accounts[index]) return;
  if (field === "secret") {
    const validation = validateBase32Secret(value);
    if (!validation.ok) { alert(validation.message); renderManager(); return; }
    try { await generateTOTP(validation.secret, accountDigits(accounts[index]), accountPeriod(accounts[index]), accountAlgorithm(accounts[index])); }
    catch (e) { alert(e.message || "密钥格式错误"); renderManager(); return; }
    accounts[index].secret = validation.secret;
  } else if (field === "digits") {
    accounts[index].digits = normalizeDigits(value);
  } else {
    accounts[index][field] = value.trim();
  }
  if (!(await saveAccounts(accounts))) return;
  renderManager();
  renderCodes();
}

async function deleteOne(index) {
  const allowed = await ensurePermission("删除密钥");
  if (!allowed) return;
  const confirmed = await showConfirmDialog({
    title: "删除密钥",
    message: "将要清空该条密钥数据，你是否要删除该密钥？",
    okText: "确定",
    cancelText: "取消",
    danger: true
  });
  if (!confirmed) return;
  const accounts = loadAccounts();
  accounts.splice(index, 1);
  if (!(await saveAccounts(accounts))) return;
  visibleSecrets.clear();
  if (editingIndex === index) closeEditor();
  else if (editingIndex !== null && editingIndex > index) editingIndex -= 1;
  if (activeIndex === index) activeIndex = null;
  if (expandedManagerIndex === index) expandedManagerIndex = null;
  else if (expandedManagerIndex !== null && expandedManagerIndex > index) expandedManagerIndex -= 1;
  renderManager(); renderCodes();
}

function selectedIndexes() {
  return [...document.querySelectorAll(".row-check:checked")].map(x => Number(x.dataset.index));
}

function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function normalizeImportedAccount(item) {
  const source = typeof item === "string" ? { secret: item } : item || {};
  if (!source.secret) return null;
  const sourceIcon = normalizeIconChoice(source.icon);

  let account = {
    issuer: String(source.issuer || "Unknown"),
    account: String(source.account || ""),
    secret: String(source.secret || ""),
    digits: Number(source.digits || 6),
    period: Number(source.period || 30),
    algorithm: normalizeAlgorithm(source.algorithm || "SHA-1"),
    icon: sourceIcon
  };

  if (isOtpAuthUri(account.secret)) {
    account = parseOtpAuthUri(account.secret);
    account.icon = sourceIcon;
  } else {
    const validation = validateBase32Secret(account.secret);
    if (!validation.ok) throw new Error(`${account.issuer || "Unknown"}：${validation.message}`);
    account.secret = validation.secret;
    account.digits = normalizeDigits(account.digits);
    account.period = normalizePeriod(account.period);
    if (!SUPPORTED_ALGORITHMS.has(account.algorithm)) throw new Error(`${account.issuer || "Unknown"}：暂不支持 ${account.algorithm} 算法`);
  }

  await generateTOTP(account.secret, account.digits, account.period, account.algorithm);
  return {
    issuer: account.issuer || "Unknown",
    account: account.account || "",
    secret: account.secret,
    digits: account.digits,
    period: account.period,
    algorithm: account.algorithm,
    icon: normalizeIconChoice(account.icon)
  };
}

function setTimeStatus(type, message) {
  const alert = $("timeAlert");
  const text = $("timeStatusText");
  if (!alert || !text) return;
  alert.className = `time-alert ${type || ""}`.trim();
  text.textContent = message;
}

function formatOffset(ms) {
  const seconds = Math.round(Math.abs(ms) / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

async function fetchNetworkTime(endpoint) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  const startedAt = Date.now();
  try {
    const separator = endpoint.url.includes("?") ? "&" : "?";
    const response = await fetch(`${endpoint.url}${separator}_=${startedAt}`, {
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) throw new Error("time request failed");
    const serverMs = await endpoint.parse(response);
    if (!Number.isFinite(serverMs)) throw new Error("invalid time response");
    const receivedAt = Date.now();
    const rtt = receivedAt - startedAt;
    return serverMs + rtt / 2;
  } finally {
    clearTimeout(timeout);
  }
}

async function detectTimeOffset() {
  if (!("fetch" in window)) {
    setTimeStatus("error", "当前浏览器无法检测网络时间。若 GitHub 验证失败，请先同步系统时间。");
    return;
  }

  setTimeStatus("", "正在检测设备时间偏移...");
  for (const endpoint of TIME_ENDPOINTS) {
    try {
      const networkNow = await fetchNetworkTime(endpoint);
      const offset = networkNow - Date.now();
      if (Math.abs(offset) >= TIME_OFFSET_WARN_MS) {
        const direction = offset > 0 ? "慢了" : "快了";
        setTimeStatus("warn", `设备时间可能${direction} ${formatOffset(offset)}，GitHub 验证码可能失败。请同步系统时间后再试。`);
      } else {
        setTimeStatus("ok", `设备时间正常，和网络时间偏差约 ${formatOffset(offset)}。`);
      }
      return;
    } catch {
      // Try the next time endpoint.
    }
  }

  setTimeStatus("error", "无法连接网络时间服务。若验证码失败，请优先同步系统时间。");
}

function setupResponsiveUI() {
  const root = document.documentElement;
  const coarseQuery = window.matchMedia?.("(pointer: coarse)");
  const standaloneQuery = window.matchMedia?.("(display-mode: standalone)");
  let frame = 0;

  const apply = () => {
    frame = 0;
    const viewport = window.visualViewport;
    const width = Math.round(viewport?.width || window.innerWidth || root.clientWidth || 0);
    const height = Math.round(viewport?.height || window.innerHeight || root.clientHeight || 0);
    const screenWidth = Math.round(window.screen?.width || width);
    const screenHeight = Math.round(window.screen?.height || height);
    const dpr = Number(window.devicePixelRatio || 1).toFixed(2);
    const touch = Boolean(coarseQuery?.matches || navigator.maxTouchPoints > 0);
    const size = width <= 480 ? "phone" : width <= 860 ? "mobile" : width <= 1180 ? "tablet" : "desktop";
    const heightSize = height <= 620 ? "short" : height >= 900 ? "tall" : "regular";
    const orientation = width > height ? "landscape" : "portrait";

    root.dataset.uiSize = size;
    root.dataset.uiHeight = heightSize;
    root.dataset.orientation = orientation;
    root.dataset.pointer = touch ? "touch" : "fine";
    root.dataset.dpr = dpr;
    root.dataset.standalone = standaloneQuery?.matches ? "true" : "false";
    root.dataset.managerCompact = window.innerWidth < 600 ? "true" : "false";
    root.style.setProperty("--viewport-width", `${width}px`);
    root.style.setProperty("--viewport-height", `${height}px`);
    root.style.setProperty("--screen-width", `${screenWidth}px`);
    root.style.setProperty("--screen-height", `${screenHeight}px`);
    root.style.setProperty("--device-pixel-ratio", dpr);
  };

  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(apply);
  };

  apply();
  window.addEventListener("resize", schedule, { passive: true });
  window.addEventListener("orientationchange", schedule, { passive: true });
  window.visualViewport?.addEventListener("resize", schedule, { passive: true });
  window.visualViewport?.addEventListener("scroll", schedule, { passive: true });
  coarseQuery?.addEventListener?.("change", schedule);
  standaloneQuery?.addEventListener?.("change", schedule);
}

function setupModalScrollbar() {
  const scroll = document.querySelector(".key-scroll");
  const bar = $("modalScrollbar");
  const thumb = $("modalScrollbarThumb");
  if (!scroll || !bar || !thumb) return;

  let frame = 0;
  let hideTimer = 0;

  const update = () => {
    frame = 0;
    const maxScroll = scroll.scrollHeight - scroll.clientHeight;
    if (maxScroll <= 1) {
      bar.classList.remove("show");
      thumb.style.height = "0px";
      thumb.style.transform = "translateY(0)";
      return;
    }

    const trackHeight = bar.clientHeight;
    const thumbHeight = Math.max(48, Math.round((scroll.clientHeight / scroll.scrollHeight) * trackHeight));
    const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
    const thumbTop = Math.round((scroll.scrollTop / maxScroll) * maxThumbTop);
    thumb.style.height = `${thumbHeight}px`;
    thumb.style.transform = `translateY(${thumbTop}px)`;
  };

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };

  const reveal = () => {
    bar.classList.add("show");
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => bar.classList.remove("show"), 1200);
    schedule();
  };

  scroll.addEventListener("scroll", reveal, { passive: true });
  window.addEventListener("resize", schedule, { passive: true });
  window.visualViewport?.addEventListener("resize", schedule, { passive: true });

  if ("ResizeObserver" in window) {
    const observer = new ResizeObserver(schedule);
    observer.observe(scroll);
  }

  if ("MutationObserver" in window) {
    const observer = new MutationObserver(schedule);
    observer.observe(scroll, { childList: true, subtree: true });
  }
  schedule();
}

function setupActionIcons() {
  $("manageBtn").innerHTML = settingsIcon;
  $("closeBtn").innerHTML = closeIcon;
  $("toggleEditorBtn").innerHTML = plusIcon;
  $("exportAllBtn").innerHTML = uploadIcon;
  $("importBtn").innerHTML = downloadIcon;
  $("clearBtn").innerHTML = trashIcon;
  $("doneBtn").innerHTML = checkIcon;
  $("closeIconPickerBtn").innerHTML = closeIcon;
  $("deleteSelectedBtn").innerHTML = `${trashIcon}<span>批量删除</span>`;
  $("exportSelectedBtn").innerHTML = `${uploadIcon}<span>导出所选</span>`;
  $("uploadIconBtn").innerHTML = `${downloadIcon}<span>导入图标</span>`;
}

function closeManager() {
  $("modalMask").classList.remove("show");
  document.body.classList.remove("modal-open");
  window.clearTimeout(secretViewHideTimer);
  visibleSecrets.clear();
  closeEditor();
  renderCodes();
}

setupActionIcons();
renderIconPickerPreview();

$("manageBtn").onclick = () => { document.body.classList.add("modal-open"); $("modalMask").classList.add("show"); renderManager(); };
$("closeBtn").onclick = closeManager;
$("doneBtn").onclick = closeManager;
$("modalMask").addEventListener("click", (e) => { if (e.target.id === "modalMask") closeManager(); });
$("accounts").addEventListener("click", (event) => {
  const copyButton = event.target.closest("[data-action='copy-code']");
  if (copyButton) {
    event.stopPropagation();
    if (!copyButton.disabled) copyCode(copyButton.dataset.code || "");
    return;
  }

  const account = event.target.closest(".account");
  if (!account || !$("accounts").contains(account)) return;
  setActive(Number(account.dataset.index));
});
$("keyList").addEventListener("change", (event) => {
  if (event.target.classList.contains("row-check")) updateSelectionState();
});
$("keyList").addEventListener("input", (event) => {
  if (event.target.classList.contains("inline-issuer")) {
    handleInlineIssuerInput();
    return;
  }
  if (event.target.classList.contains("inline-secret")) {
    handleInlineSecretInput(event.target);
  }
});
$("keyList").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (button && $("keyList").contains(button)) {
    const action = button.dataset.action;
    const index = Number(button.dataset.index ?? button.closest("[data-edit-index]")?.dataset.editIndex);

    if (action === "toggle-secret") await toggleSecret(index);
    else if (action === "edit-one") await editOne(index);
    else if (action === "delete-one") await deleteOne(index);
    else if (action === "open-inline-icon-picker") openInlineIconPicker(event);
    else if (action === "save-inline-edit") await saveInlineEdit(index);
    else if (action === "cancel-inline-edit") cancelInlineEdit();
    return;
  }

  const row = event.target.closest(".key-item[data-index]");
  if (!row || !$("keyList").contains(row) || !isCompactManagerLayout()) return;
  if (event.target.closest("input, select, textarea, label")) return;
  const index = Number(row.dataset.index);
  expandedManagerIndex = expandedManagerIndex === index ? null : index;
  renderManager();
});
$("toggleEditorBtn").onclick = () => {
  if ($("editorPanel").classList.contains("hidden") || editingIndex !== null) openEditor();
  else closeEditor();
};
$("cancelEditBtn").onclick = closeEditor;

$("issuer").addEventListener("input", () => {
  if (!iconChoiceManual) currentIconChoice = { type: "auto" };
  renderIconPickerPreview();
  if (!$("iconPickerDialog").classList.contains("hidden")) renderIconPickerOptions();
});

$("iconPickerBtn").onclick = (event) => {
  event.stopPropagation();
  setIconPickerOpen($("iconPickerDialog").classList.contains("hidden"));
};

$("closeIconPickerBtn").onclick = () => setIconPickerOpen(false);
$("iconPickerDialog").addEventListener("click", (event) => {
  if (event.target.id === "iconPickerDialog") setIconPickerOpen(false);
});

$("iconPickerOptions").addEventListener("click", (event) => {
  const option = event.target.closest(".icon-option");
  if (!option) return;
  const iconId = option.dataset.iconId;
  if (iconId === "auto") {
    currentIconChoice = { type: "auto" };
    iconChoiceManual = false;
  } else {
    currentIconChoice = { type: "preset", id: iconId };
    iconChoiceManual = true;
  }
  renderIconPickerPreview();
  renderIconPickerOptions();
  setIconPickerOpen(false);
});

$("uploadIconBtn").onclick = (event) => {
  event.stopPropagation();
  $("iconFileInput").click();
};

$("iconFileInput").onchange = async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    const dataUrl = await readIconFile(file);
    if (!dataUrl) return;
    currentIconChoice = { type: "image", dataUrl, name: file.name };
    iconChoiceManual = true;
    renderIconPickerPreview();
    setIconPickerOpen(false);
  } catch (e) {
    alert(e.message || "图标导入失败");
  }
};

document.addEventListener("click", (event) => {
  if (
    !$("iconPickerDialog").classList.contains("hidden") &&
    !event.target.closest(".icon-dialog") &&
    !event.target.closest(".icon-picker")
  ) {
    setIconPickerOpen(false);
  }
});

$("secret").addEventListener("input", (event) => {
  const value = event.target.value.trim();
  if (!value) {
    setSecretHint("", "支持 Base32 密钥，也可以直接粘贴 otpauth:// 链接");
    return;
  }

  if (isOtpAuthUri(value)) {
    try {
      applyOtpAuthInput(value);
    } catch (e) {
      setSecretHint("error", e.message || "otpauth:// 链接解析失败");
    }
    return;
  }

  const validation = validateBase32Secret(value);
  setSecretHint(validation.ok ? "ok" : "error", validation.message);
});

$("addBtn").onclick = async () => {
  let issuer = $("issuer").value.trim();
  let account = $("account").value.trim();
  let secretInput = $("secret").value.trim();
  let digits = Number($("digits").value || 6);
  let period = currentOtpSettings.period;
  let algorithm = currentOtpSettings.algorithm;

  if (isOtpAuthUri(secretInput)) {
    try {
      const parsed = parseOtpAuthUri(secretInput);
      issuer = parsed.issuer;
      account = parsed.account;
      secretInput = parsed.secret;
      digits = parsed.digits;
      period = parsed.period;
      algorithm = parsed.algorithm;
      $("issuer").value = issuer;
      $("account").value = account;
      $("secret").value = secretInput;
      $("digits").value = String(digits);
      if (!iconChoiceManual) currentIconChoice = { type: "auto" };
      renderIconPickerPreview();
    } catch (e) {
      setSecretHint("error", e.message || "otpauth:// 链接解析失败");
      $("secret").focus();
      return;
    }
  }

  const validation = validateBase32Secret(secretInput);
  if (!validation.ok) {
    setSecretHint("error", validation.message);
    $("secret").focus();
    return;
  }

  const secret = validation.secret;
  if (!issuer) { alert("请填写平台，或粘贴包含 issuer 的 otpauth:// 链接"); return; }
  try {
    digits = normalizeDigits(digits);
    period = normalizePeriod(period);
    algorithm = normalizeAlgorithm(algorithm);
    await generateTOTP(secret, digits, period, algorithm);
  }
  catch (e) {
    setSecretHint("error", e.message || "密钥格式错误");
    $("secret").focus();
    return;
  }

  const accounts = loadAccounts();
  const next = { issuer, account, secret, digits, period, algorithm, icon: savedIconChoice() };
  if (editingIndex === null) accounts.push(next);
  else accounts[editingIndex] = next;
  if (!(await saveAccounts(accounts))) return;
  closeEditor();
  renderManager(); renderCodes();
};

$("selectAll").onchange = (e) => {
  document.querySelectorAll(".row-check").forEach(x => x.checked = e.target.checked);
  updateSelectionState();
};

$("deleteSelectedBtn").onclick = async () => {
  const indexes = selectedIndexes();
  if (!indexes.length) { alert("请选择密钥"); return; }
  const allowed = await ensurePermission("删除密钥");
  if (!allowed) return;
  const confirmed = await showConfirmDialog({
    title: "批量删除",
    message: `将要清空${indexes.length}条密钥数据，你是否要继续？`,
    okText: "确定",
    cancelText: "取消",
    danger: true
  });
  if (!confirmed) return;
  const removeSet = new Set(indexes);
  const accounts = loadAccounts().filter((_, i) => !removeSet.has(i));
  if (!(await saveAccounts(accounts))) return;
  visibleSecrets.clear();
  activeIndex = null;
  expandedManagerIndex = null;
  closeEditor();
  renderManager(); renderCodes();
};

$("clearBtn").onclick = async () => {
  const allowed = await ensurePermission("删除密钥");
  if (!allowed) return;
  const confirmed = await showConfirmDialog({
    title: "清空密钥",
    message: "将要清空全部密钥数据，你是否要继续？",
    okText: "确定",
    cancelText: "取消",
    danger: true
  });
  if (!confirmed) return;
  if (!(await saveAccounts([]))) return;
  visibleSecrets.clear();
  activeIndex = null;
  expandedManagerIndex = null;
  closeEditor();
  renderManager(); renderCodes();
};

$("exportAllBtn").onclick = async () => {
  const accounts = loadAccounts();
  if (!accounts.length) { alert("暂无可导出的密钥"); return; }
  const allowed = await ensurePermission("导出密钥");
  if (!allowed) return;
  downloadJSON(accounts, "totp-backup-all.json");
};

$("exportSelectedBtn").onclick = async () => {
  const indexes = selectedIndexes();
  if (!indexes.length) { alert("请选择密钥"); return; }
  const accounts = loadAccounts();
  const selected = indexes.map(i => accounts[i]).filter(Boolean);
  if (!selected.length) { alert("请选择有效密钥"); return; }
  const allowed = await ensurePermission("导出密钥");
  if (!allowed) return;
  downloadJSON(selected, "totp-backup-selected.json");
};

$("importBtn").onclick = () => $("fileInput").click();
$("timeCheckBtn").onclick = detectTimeOffset;

$("fileInput").onchange = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data)) throw new Error("备份格式错误");
    const valid = [];
    for (const item of data) {
      const account = await normalizeImportedAccount(item);
      if (account) valid.push(account);
    }
    if (!valid.length) throw new Error("没有可导入密钥");
    if (!(await saveAccounts([...loadAccounts(), ...valid]))) return;
    closeEditor();
    renderManager(); renderCodes();
  } catch (e) {
    alert(e.message || "导入失败");
  } finally {
    event.target.value = "";
  }
};

function setupPWA() {
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

async function initializeApp() {
  setupResponsiveUI();
  setupModalScrollbar();
  setupPWA();

  const ready = await initializeAccountsStorage();
  if (!ready) {
    $("accounts").innerHTML = `<div class="empty">${escapeHTML(accountsStorageIssue || "密钥数据未解锁")}</div>`;
    return;
  }

  renderCodes();
  detectTimeOffset();
  setInterval(refreshCodes, 1000);
}

initializeApp();
