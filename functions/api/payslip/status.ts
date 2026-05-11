// GET /api/payslip/status
// → Gmail 連携の状態を返す（フロントで「連携済み/未連携」を表示するため）。

import type { Env } from '../../_shared/env';
import { jsonResponse } from '../../_shared/env';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env } = context;

  const hasClientId = !!env.GOOGLE_CLIENT_ID;
  const hasClientSecret = !!env.GOOGLE_CLIENT_SECRET;
  const hasSender = !!env.GMAIL_SENDER;
  const refreshToken = await env.NOVA_KV.get('gmail_refresh_token');
  const refreshTokenAt = await env.NOVA_KV.get('gmail_refresh_token_at');

  return jsonResponse({
    ok: hasClientId && hasClientSecret && hasSender && !!refreshToken,
    config: {
      has_client_id: hasClientId,
      has_client_secret: hasClientSecret,
      has_sender: hasSender,
      sender: env.GMAIL_SENDER || null,
    },
    connection: {
      connected: !!refreshToken,
      connected_at: refreshTokenAt,
    },
  });
};
