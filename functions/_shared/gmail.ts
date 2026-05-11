// Gmail API ラッパ。nova.ong.ats@gmail.com から給与明細メールを送信する。
//
// 流れ:
//   1. refresh_token + client_id/secret → access_token に交換
//      （アクセストークンは 1 時間しか有効でないので毎回交換）
//   2. MIME multipart/mixed で本文 + PDF 添付を組み立て
//   3. base64url エンコードして Gmail API messages.send に POST
//
// 注意: client_secret / refresh_token はログに絶対残さない。

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

export type GmailAttachment = {
  filename: string;        // 例: "2026-05-佐藤太郎-給与明細.pdf"
  mimeType: string;        // 例: "application/pdf"
  base64: string;          // ファイル本体 (標準 base64、改行なし)
};

export type SendMailParams = {
  accessToken: string;
  fromName: string;        // 表示名（例: "有限会社NOVA"）
  fromEmail: string;       // 送信元メアド（nova.ong.ats@gmail.com）
  to: string;              // 受信者メアド
  subject: string;
  body: string;            // text/plain 本文
  attachments?: GmailAttachment[];
};

export class GmailError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// refresh_token → access_token 交換。短命 (1h) なので毎回呼ぶ前提。
// 失敗パターン:
//   - 400 invalid_grant: refresh_token が失効・取り消し（テストモード 7 日経過）
//   - 401: client_id/client_secret が間違っている
export async function getAccessToken(opts: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<string> {
  const body = new URLSearchParams({
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    refresh_token: opts.refreshToken,
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const txt = await res.text();
    if (res.status === 400 && txt.includes('invalid_grant')) {
      throw new GmailError(401, 'gmail_token_expired',
        'Gmail 連携の有効期限が切れています。設定画面で「Gmail 連携をやり直す」を実行してください。' +
        '（OAuth テストモードでは refresh_token が 7 日で失効します）');
    }
    if (res.status === 401) {
      throw new GmailError(401, 'gmail_invalid_credentials',
        'Gmail の Client ID / Client Secret が誤っています。Cloudflare Pages の Secret を確認してください。');
    }
    console.error('Google token exchange failed:', res.status, txt.slice(0, 200));
    throw new GmailError(502, 'gmail_token_exchange_failed', `Google からトークン取得失敗 (HTTP ${res.status})`);
  }
  const json = await res.json() as { access_token?: string };
  if (!json.access_token) {
    throw new GmailError(502, 'gmail_no_access_token', 'Google レスポンスに access_token が含まれていません');
  }
  return json.access_token;
}

// RFC 2047 で UTF-8 文字列をエンコード (Subject 等に使う)
function encodeRfc2047(s: string): string {
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  const bytes = new TextEncoder().encode(s);
  const b64 = base64Encode(bytes);
  return `=?UTF-8?B?${b64}?=`;
}

// Uint8Array → 標準 base64（改行なし、padding あり）
function base64Encode(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(bin);
}

// 標準 base64 → base64url（Gmail API の raw フィールド形式）
function base64ToBase64Url(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 76 文字ごとに改行を入れる（MIME 規格）
function chunkBase64(b64: string): string {
  return b64.match(/.{1,76}/g)?.join('\r\n') ?? b64;
}

// MIME メッセージを組み立て
function buildMime(p: SendMailParams): string {
  const fromHeader = `${encodeRfc2047(p.fromName)} <${p.fromEmail}>`;
  const subject = encodeRfc2047(p.subject);
  const bodyB64 = base64Encode(new TextEncoder().encode(p.body));
  const bodyChunked = chunkBase64(bodyB64);

  if (!p.attachments || p.attachments.length === 0) {
    return [
      `From: ${fromHeader}`,
      `To: ${p.to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      bodyChunked,
    ].join('\r\n');
  }

  const boundary = `=_nova_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const lines: string[] = [
    `From: ${fromHeader}`,
    `To: ${p.to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    bodyChunked,
  ];
  for (const att of p.attachments) {
    const attChunked = chunkBase64(att.base64);
    const filenameEnc = encodeRfc2047(att.filename);
    lines.push(
      '',
      `--${boundary}`,
      `Content-Type: ${att.mimeType}; name="${filenameEnc}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${filenameEnc}"`,
      '',
      attChunked,
    );
  }
  lines.push('', `--${boundary}--`);
  return lines.join('\r\n');
}

// Gmail API messages.send で送信
export async function sendMail(p: SendMailParams): Promise<{ id: string; threadId: string }> {
  const mime = buildMime(p);
  const raw = base64ToBase64Url(base64Encode(new TextEncoder().encode(mime)));

  const res = await fetch(SEND_URL, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${p.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) {
    const txt = await res.text();
    if (res.status === 401) {
      throw new GmailError(401, 'gmail_unauthorized',
        'Gmail API 認証エラー。Client Secret や権限を確認してください。');
    }
    if (res.status === 429) {
      throw new GmailError(429, 'gmail_rate_limit',
        'Gmail API のレート制限に達しました。少し時間を空けて再実行してください。');
    }
    if (res.status === 403) {
      throw new GmailError(403, 'gmail_forbidden',
        '送信権限がありません。OAuth スコープに gmail.send が含まれているか、' +
        '送信元メアド（nova.ong.ats@gmail.com）が連携アカウントと一致しているか確認してください。');
    }
    console.error('Gmail send failed:', res.status, txt.slice(0, 300));
    throw new GmailError(502, 'gmail_send_failed', `Gmail 送信失敗 (HTTP ${res.status})`);
  }
  return await res.json() as { id: string; threadId: string };
}

// KV から refresh_token を取得（無ければ null）
export async function getRefreshTokenFromKV(kv: KVNamespace): Promise<string | null> {
  return await kv.get('gmail_refresh_token');
}

// KV に refresh_token を保存
export async function saveRefreshTokenToKV(kv: KVNamespace, token: string): Promise<void> {
  await kv.put('gmail_refresh_token', token);
  await kv.put('gmail_refresh_token_at', new Date().toISOString());
}
