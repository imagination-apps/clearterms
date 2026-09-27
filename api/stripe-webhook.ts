// POST /api/stripe-webhook  (Stripe → checkout.session.completed)
// パックを追加し、ライセンスキーをメール送信。同じ session ID は一度しか加算しない。
import type Stripe from 'stripe'
import { PAID, PRODUCT_ID } from './_lib/config.js'
import { sendPurchaseEmail } from './_lib/emails.js'
import { env, json, newLicenseKey, normalizeEmail, siteUrl, supabase } from './_lib/server.js'
import { stripe } from './_lib/stripe.js'

export async function POST(req: Request): Promise<Response> {
  const sig = req.headers.get('stripe-signature')
  const raw = await req.text()
  let event: Stripe.Event
  try {
    event = stripe().webhooks.constructEvent(raw, sig ?? '', env('STRIPE_WEBHOOK_SECRET'))
  } catch {
    return json({ error: 'bad_signature' }, 400)
  }

  if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') {
    return json({ received: true })
  }
  const session = event.data.object as Stripe.Checkout.Session
  if (session.metadata?.product !== PRODUCT_ID) return json({ received: true, skipped: 'other_product' })
  if (session.payment_status !== 'paid') return json({ received: true, pending: true })

  const email = normalizeEmail(session.customer_details?.email ?? session.customer_email)
  if (!email) {
    console.error('webhook: no email on session', session.id)
    return json({ error: 'no_email' }, 400)
  }

  const sb = supabase()
  const { data, error } = await sb.rpc('clearterms_add_pack', {
    p_email: email,
    p_session_id: session.id,
    p_credits: PAID.creditsPerPack,
    p_months: PAID.packValidityMonths,
    p_new_key: newLicenseKey(),
  })
  if (error || !data?.[0]) {
    console.error('add_pack failed', error?.message)
    return json({ error: 'db' }, 500) // Stripe が再送する
  }
  const { license_key: key, inserted } = data[0] as { license_key: string; inserted: boolean }
  if (!inserted) return json({ received: true, duplicate: true })

  try {
    const { data: st } = await sb.rpc('clearterms_credit_status', { p_key: key })
    const { data: pack } = await sb.from('clearterms_credit_packs').select('expires_at').eq('stripe_session_id', session.id).single()
    const lang = session.metadata?.lang === 'ja' ? 'ja' : 'en'
    await sendPurchaseEmail(email, key, pack?.expires_at as string, (st as { total: number }).total, siteUrl(req), lang)
  } catch (e) {
    // メール失敗でもパックは付与済み(購入完了画面・復元機能でキーを取得できる)
    console.error('purchase mail failed', (e as Error).message)
  }
  return json({ received: true })
}
