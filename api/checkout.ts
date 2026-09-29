// POST /api/checkout  { lang, licenseKey?, email? } → Stripe Checkout のURLを返す
import { PAID, PRODUCT_ID } from './_lib/config.js'
import { isLicenseKeyFormat, json, normalizeEmail, readJson, siteUrl, supabase, env } from './_lib/server.js'
import { stripe } from './_lib/stripe.js'

export async function POST(req: Request): Promise<Response> {
  const body = await readJson<{ lang: string; licenseKey: string; email: string }>(req)
  const lang = body.lang === 'ja' ? 'ja' : 'en'
  const site = siteUrl(req)

  // 既存キーがあれば、そのキーのメールで購入 → 同じキーに回数が加算される
  let email = normalizeEmail(body.email)
  if (isLicenseKeyFormat(body.licenseKey)) {
    const { data } = await supabase().from('clearterms_licenses').select('email').eq('license_key', body.licenseKey).maybeSingle()
    if (data?.email) email = data.email as string
  }

  const expiryNote = lang === 'ja'
    ? `フル変換${PAID.creditsPerPack}回分。有効期限は購入日から${PAID.packValidityMonths}か月です(延長不可)。ライセンスキーはメールでお届けします。本ツールは法的アドバイスではありません。`
    : `${PAID.creditsPerPack} full conversions. Valid for ${PAID.packValidityMonths} months from purchase (not extendable). Your license key will be emailed to you. This tool does not provide legal advice.`

  try {
    const session = await stripe().checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: env('STRIPE_PRICE_ID'), quantity: 1 }],
      success_url: `${site}/?purchase=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${site}/?purchase=cancel`,
      locale: lang === 'ja' ? 'ja' : 'en',
      ...(email ? { customer_email: email } : {}),
      metadata: { product: PRODUCT_ID, lang },
      custom_text: { submit: { message: expiryNote } },
      allow_promotion_codes: true,
    })
    return json({ url: session.url })
  } catch (e) {
    console.error('checkout create failed', (e as Error).message)
    return json({ error: 'checkout_failed' }, 500)
  }
}
