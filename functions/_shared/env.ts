// Cloudflare Pages Functions の env 型定義。
//
// Secrets（Cloudflare ダッシュボードで設定）:
//   - GOOGLE_CLIENT_ID:     OAuth クライアント ID（.apps.googleusercontent.com で終わる）
//   - GOOGLE_CLIENT_SECRET: OAuth クライアントシークレット（GOCSPX- で始まる）
//   - GMAIL_SENDER:         送信元 Gmail（nova.ong.ats@gmail.com）
//
// KV Namespace:
//   - NOVA_KV: refresh_token などの永続データ用
//     キー:
//       - gmail_refresh_token:    OAuth フローで取得した refresh token
//       - gmail_refresh_token_at: 取得時刻（ISO 8601）
//       - oauth_state_<token>:    OAuth state（CSRF 対策、10 分後自動削除）

export type Env = {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GMAIL_SENDER?: string;
  NOVA_KV: KVNamespace;
};

// 共通: 設定不足時のエラーレスポンス
export function configError(missing: string[]): Response {
  return new Response(
    JSON.stringify({
      error: 'config_missing',
      message: `Cloudflare Pages の Secret に未設定の項目があります: ${missing.join(', ')}`,
    }),
    { status: 500, headers: { 'content-type': 'application/json' } },
  );
}

// 共通: JSON レスポンス生成
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
