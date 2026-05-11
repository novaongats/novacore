// GET /api/auth/google/callback?code=XXX&state=YYY
// → Google からのリダイレクト先。code を refresh_token に交換して KV に保存。
// → ユーザーを novacore のホームに戻し、連携完了を通知。

import type { Env } from '../../../_shared/env';
import { saveRefreshTokenToKV } from '../../../_shared/gmail';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const url = new URL(request.url);

  // state 検証は code 検証より先に行う（CSRF が確定している場合は code を見る前にエラー）
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    return Response.redirect(`${url.origin}/#gmail_error=${encodeURIComponent(error)}`, 302);
  }

  if (!state) {
    return Response.redirect(`${url.origin}/#gmail_error=missing_state`, 302);
  }

  const stateKey = `oauth_state_${state}`;
  const saved = await env.NOVA_KV.get(stateKey);
  // 検証成功・失敗どちらでも state はワンタイム消費。再利用させない。
  await env.NOVA_KV.delete(stateKey);
  if (!saved) {
    return Response.redirect(`${url.origin}/#gmail_error=state_mismatch`, 302);
  }

  if (!code) {
    return Response.redirect(`${url.origin}/#gmail_error=missing_code`, 302);
  }

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return Response.redirect(`${url.origin}/#gmail_error=not_configured`, 302);
  }

  const redirectUri = `${url.origin}/api/auth/google/callback`;

  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const txt = await res.text();
    console.error('Google token exchange (callback) failed:', res.status, txt.slice(0, 300));
    return Response.redirect(
      `${url.origin}/#gmail_error=${encodeURIComponent('token_exchange_failed')}`,
      302,
    );
  }

  const json = await res.json() as { refresh_token?: string };
  if (!json.refresh_token) {
    // prompt=consent 指定済みなので通常 refresh_token は来るが、念のため
    return Response.redirect(`${url.origin}/#gmail_error=no_refresh_token`, 302);
  }

  // KV に保存
  await saveRefreshTokenToKV(env.NOVA_KV, json.refresh_token);

  // novacore のホームに戻し、連携完了フラグをハッシュで渡す
  return Response.redirect(`${url.origin}/#gmail_connected=1`, 302);
};
