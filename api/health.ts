// GET /api/health  設定確認用(秘密の値そのものは返さない)
import { json, supabase } from './_lib/server.js'

export async function GET(): Promise<Response> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const keyKind = key.startsWith('sb_secret_') ? 'secret' : key.startsWith('sb_publishable_') ? 'publishable(NG)'
    : key.startsWith('eyJ') ? (() => { try { return 'jwt:' + JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role } catch { return 'jwt:?' } })()
    : key ? 'unknown' : 'missing'
  let db = 'ok'
  try {
    const { error } = await supabase().rpc('clearterms_ping')
    if (error) db = `error: ${error.message}`
  } catch (e) {
    db = `error: ${(e as Error).message}`
  }
  const checks: Record<string, string> = {}
  const tryRpc = async (name: string, args: Record<string, unknown>) => {
    try {
      const { error } = await supabase().rpc(name, args)
      checks[name] = error ? `error: ${error.message}` : 'ok'
    } catch (e) {
      checks[name] = `error: ${(e as Error).message}`
    }
  }
  await tryRpc('clearterms_credit_status', { p_key: 'CT-TEST-TEST-TEST-TEST' })
  await tryRpc('clearterms_free_remaining', { p_email: 'health@example.com', p_ip_hash: 'health', p_limit: 3 })
  return json({
    db,
    checks,
    supabaseUrl: process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).host : 'missing',
    supabaseKey: keyKind,
    anthropicKey: process.env.ANTHROPIC_API_KEY?.startsWith('sk-ant-') ? 'set' : 'missing/invalid',
    resendKey: process.env.RESEND_API_KEY?.startsWith('re_') ? 'set' : 'missing/invalid',
    stripeKey: process.env.STRIPE_SECRET_KEY ? process.env.STRIPE_SECRET_KEY.slice(0, 8) + '…' : 'missing',
    stripePrice: process.env.STRIPE_PRICE_ID ? 'set' : 'missing',
  })
}
