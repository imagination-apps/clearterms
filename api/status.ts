// POST /api/status  { token?, licenseKey? } → 無料枠の残り / 有料クレジットの残りと期限
import { FREE } from './_lib/config.js'
import { ipHash, isLicenseKeyFormat, json, readJson, supabase, verifySession } from './_lib/server.js'

type CreditStatus = { valid: boolean; email: string | null; total: number; packs: { remaining: number; expires_at: string }[] }

export async function POST(req: Request): Promise<Response> {
  const body = await readJson<{ token: string; licenseKey: string }>(req)
  const sb = supabase()
  const out: { free: { remaining: number; limit: number; email: string } | null; paid: CreditStatus | null } = { free: null, paid: null }

  const email = verifySession(body.token)
  if (email) {
    const { data, error } = await sb.rpc('clearterms_free_remaining', { p_email: email, p_ip_hash: ipHash(req), p_limit: FREE.dailyLimit })
    if (!error) out.free = { remaining: data as number, limit: FREE.dailyLimit, email }
  }
  if (isLicenseKeyFormat(body.licenseKey)) {
    const { data, error } = await sb.rpc('clearterms_credit_status', { p_key: body.licenseKey })
    if (!error) out.paid = data as CreditStatus
  }
  return json(out)
}
