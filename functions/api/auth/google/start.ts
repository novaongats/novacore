// GET /api/auth/google/start
// → Google の認可 URL に redirect。
//
// CSRF 対策: 推測不能な state を発行して KV に 10 分だけ保存し、
// callback で照合する。state なし or 不一致は他人の Gmail 連携を上書きできてしまうため致命的。

import type { Env } from '../../../_shared/env';
import { configError } from '../../../_shared/env';

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPE = 'https://www.googleapis.com/auth/gmail.send';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const missing: string[] = [];
  if (!env.GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID');
  if (missing.length) return configError(missing);

  const url = new URL(request.url);
  const redirectUri = `${url.origin}/api/auth/google/callback`;

  // state を発行して KV に 10 分間保存
  const state = crypto.randomUUID();
  await env.NOVA_KV.put(`oauth_state_${state}`, '1', { expirationTtl: 600 });

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',  // refresh_token を取得するため必須
    prompt: 'consent',       // 連携やり直しでも確実に refresh_token を再発行
    include_granted_scopes: 'true',
    state,
  });
  return Response.redirect(`${AUTHORIZE_URL}?${params.toString()}`, 302);
};
