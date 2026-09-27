// 有効期限の14日前に、残り回数のあるユーザーへリマインドメールを送る(1日1回)
import { EXPIRY_REMINDER_DAYS } from '../_lib/config.js'
import { sendExpiryReminder } from '../_lib/emails.js'
import { json, siteUrl, supabase } from '../_lib/server.js'

type Row = { email: string; license_key: string; credits_remaining: number; expires_at: string }

export async function GET(req: Request): Promise<Response> {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return json({ error: 'unauthorized' }, 401)
  }
  const { data, error } = await supabase().rpc('clearterms_claim_expiring_packs', { p_days: EXPIRY_REMINDER_DAYS })
  if (error) {
    console.error('claim_expiring failed', error.message)
    return json({ ok: false }, 500)
  }
  let sent = 0
  for (const r of (data ?? []) as Row[]) {
    try {
      await sendExpiryReminder(r.email, r.license_key, r.credits_remaining, r.expires_at, siteUrl(req))
      sent++
    } catch (e) {
      console.error('reminder mail failed', (e as Error).message)
    }
  }
  return json({ ok: true, sent })
}
