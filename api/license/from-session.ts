// GET /api/license/from-session?session_id=cs_...  購入完了画面でキーを受け取る
import { PRODUCT_ID } from '../_lib/config.js'
import { json, normalizeEmail, supabase } from '../_lib/server.js'
import { stripe } from '../_lib/stripe.js'

export async function GET(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get('session_id') ?? ''
  if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return json({ error: 'invalid' }, 400)

  let session
  try {
    session = await stripe().checkout.sessions.retrieve(id)
  } catch {
    return json({ error: 'not_found' }, 404)
  }
  if (session.metadata?.product !== PRODUCT_ID || (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required')) return json({ error: 'not_paid' }, 402)

  const { data: pack } = await supabase().from('clearterms_credit_packs').select('license_key').eq('stripe_session_id', id).maybeSingle()
  if (!pack) return json({ pending: true }) // Webhook 処理待ち
  const email = normalizeEmail(session.customer_details?.email ?? session.customer_email)
  return json({ licenseKey: pack.license_key, email })
}
