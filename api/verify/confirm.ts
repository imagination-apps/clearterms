// POST /api/verify/confirm  { email, code } → 確認済みトークンを返す
import { VERIFY } from '../_lib/config.js'
import { hashCode, json, normalizeEmail, readJson, signSession, supabase } from '../_lib/server.js'

export async function POST(req: Request): Promise<Response> {
  const body = await readJson<{ email: string; code: string }>(req)
  const email = normalizeEmail(body.email)
  const code = typeof body.code === 'string' ? body.code.replace(/\D/g, '') : ''
  if (!email || code.length !== 6) return json({ error: 'invalid' }, 400)

  const { data, error } = await supabase().rpc('clearterms_check_code', {
    p_email: email,
    p_code_hash: hashCode(email, code),
    p_max_attempts: VERIFY.maxAttempts,
  })
  if (error) {
    console.error('check_code failed', error.message)
    return json({ error: 'server' }, 500)
  }
  if (data !== 'ok') return json({ error: data }, 400)
  return json({ ok: true, token: signSession(email), email })
}
