// POST /api/verify/send  { email, lang } → 6桁の確認コードをメール送信
import { VERIFY } from '../_lib/config.js'
import { sendVerifyCode } from '../_lib/emails.js'
import { hashCode, ipHash, json, normalizeEmail, readJson, sixDigitCode, supabase } from '../_lib/server.js'

const IP_HOURLY_LIMIT = 5

export async function POST(req: Request): Promise<Response> {
  const body = await readJson<{ email: string; lang: string }>(req)
  const email = normalizeEmail(body.email)
  const lang = body.lang === 'ja' ? 'ja' : 'en'
  if (!email) return json({ error: 'invalid_email' }, 400)

  const c = sixDigitCode()
  const { data, error } = await supabase().rpc('clearterms_register_code_send', {
    p_email: email,
    p_ip_hash: ipHash(req),
    p_code_hash: hashCode(email, c),
    p_ttl_minutes: VERIFY.codeTtlMinutes,
    p_cooldown_seconds: VERIFY.resendCooldownSeconds,
    p_ip_hourly_limit: IP_HOURLY_LIMIT,
  })
  if (error) {
    console.error('register_code_send failed', error.message)
    return json({ error: 'server' }, 500)
  }
  if (data === 'cooldown') return json({ error: 'cooldown', retryAfter: VERIFY.resendCooldownSeconds }, 429)
  if (data === 'ip_limit') return json({ error: 'ip_limit' }, 429)

  try {
    await sendVerifyCode(email, c, lang)
  } catch (e) {
    console.error('verify mail failed', (e as Error).message)
    return json({ error: 'mail_failed' }, 502)
  }
  return json({ ok: true })
}
