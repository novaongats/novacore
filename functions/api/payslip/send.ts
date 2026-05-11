// POST /api/payslip/send
// 給与明細メール送信エンドポイント。
//
// リクエストボディ:
//   {
//     items: [
//       { staff_id: "...", name: "佐藤太郎", email: "taro@example.com",
//         pdf_base64: "...", filename: "2026-05-佐藤太郎-給与明細.pdf" },
//       ...
//     ],
//     year: 2026,
//     month: 5,
//     test_to?: "owner@gmail.com"  // 指定時は全員ぶんをこのアドレスに送る
//   }
//
// レスポンス:
//   {
//     results: [{ staff_id, status: 'sent'|'failed'|'skipped', error?, message_id? }],
//     summary: { sent, skipped, failed }
//   }

import type { Env } from '../../_shared/env';
import { configError, jsonResponse } from '../../_shared/env';
import { getAccessToken, sendMail, GmailError, getRefreshTokenFromKV } from '../../_shared/gmail';

type SendItem = {
  staff_id: string | number;
  name: string;
  email: string | null;
  pdf_base64: string;
  filename: string;
};

type SendRequest = {
  items: SendItem[];
  year: number;
  month: number;
  test_to?: string;
};

type Result = {
  staff_id: string | number;
  staff_name: string;
  status: 'sent' | 'skipped' | 'failed';
  error?: string;
  message_id?: string;
};

function buildSubject(year: number, month: number): string {
  return `【有限会社NOVA】${year}年${String(month).padStart(2, '0')}月分 給与明細`;
}

function buildBody(name: string, year: number, month: number): string {
  return `${name} 様

お疲れさまです。有限会社NOVA です。
${year}年${String(month).padStart(2, '0')}月分の給与明細を添付にてお送りします。
ご確認のうえ、不明点があればお気軽にお問い合わせください。

────────────────
有限会社NOVA
────────────────
`;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  // 設定チェック
  const missing: string[] = [];
  if (!env.GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID');
  if (!env.GOOGLE_CLIENT_SECRET) missing.push('GOOGLE_CLIENT_SECRET');
  if (!env.GMAIL_SENDER) missing.push('GMAIL_SENDER');
  if (missing.length) return configError(missing);

  const refreshToken = await getRefreshTokenFromKV(env.NOVA_KV);
  if (!refreshToken) {
    return jsonResponse({
      error: 'not_connected',
      message: 'Gmail 連携が完了していません。設定画面で「Google と連携する」を実行してください。',
    }, 400);
  }

  // リクエストパース
  let body: SendRequest;
  try {
    body = await request.json() as SendRequest;
  } catch {
    return jsonResponse({ error: 'invalid_json', message: 'リクエストが JSON ではありません' }, 400);
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return jsonResponse({ error: 'no_items', message: '送信対象が指定されていません' }, 400);
  }
  if (body.items.length > 100) {
    return jsonResponse({ error: 'too_many', message: '一度に送れるのは 100 件までです' }, 400);
  }
  if (!body.year || !body.month) {
    return jsonResponse({ error: 'no_period', message: '対象年月が指定されていません' }, 400);
  }

  // access_token を 1 度だけ取得（複数送信で共有）
  let accessToken: string;
  try {
    accessToken = await getAccessToken({
      refreshToken,
      clientId: env.GOOGLE_CLIENT_ID!,
      clientSecret: env.GOOGLE_CLIENT_SECRET!,
    });
  } catch (e) {
    if (e instanceof GmailError) {
      return jsonResponse({ error: e.code, message: e.message }, e.status);
    }
    return jsonResponse({ error: 'token_error', message: String(e) }, 502);
  }

  const results: Result[] = [];

  // 1 通ずつ逐次送信（Gmail のレート制限を考慮）
  for (const item of body.items) {
    // メアド未登録は自動スキップ
    if (!body.test_to && !item.email) {
      results.push({
        staff_id: item.staff_id,
        staff_name: item.name,
        status: 'skipped',
        error: 'メールアドレス未登録',
      });
      continue;
    }
    const to = body.test_to ?? item.email!;
    try {
      const r = await sendMail({
        accessToken,
        fromName: '有限会社NOVA',
        fromEmail: env.GMAIL_SENDER!,
        to,
        subject: buildSubject(body.year, body.month),
        body: buildBody(item.name, body.year, body.month),
        attachments: [{
          filename: item.filename,
          mimeType: 'application/pdf',
          base64: item.pdf_base64,
        }],
      });
      results.push({
        staff_id: item.staff_id,
        staff_name: item.name,
        status: 'sent',
        message_id: r.id,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({
        staff_id: item.staff_id,
        staff_name: item.name,
        status: 'failed',
        error: msg,
      });
    }
  }

  return jsonResponse({
    results,
    summary: {
      sent: results.filter(r => r.status === 'sent').length,
      skipped: results.filter(r => r.status === 'skipped').length,
      failed: results.filter(r => r.status === 'failed').length,
    },
  });
};
