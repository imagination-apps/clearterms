// POST /api/license/restore { email, lang } → 登録メール宛にキーを再送(画面には返さない)
import { sendRestoreEmail } from '../_lib/emails.js'
import { json, normalizeEmail, readJson, siteUrl, supabase } from '../_lib/server.js'

export async function POST(req: Request): Promise<Response> {
  const body = await readJson<{ email: string; lang: string }>(req)
  const email = normalizeEmail(body.email)
  const lang = body.lang === 'ja' ? 'ja' : 'en'
  if (!email) return json({ error: 'invalid_email' }, 400)

  const { data } = await supabase().from('clearterms_licenses').select('license_key').eq('email', email).maybeSingle()
  if (data?.license_key) {
    try {
      await sendRestoreEmail(email, data.license_key as string, siteUrl(req), lang)
    } catch (e) {
      console.error('restore mail failed', (e as Error).message)
    }
  }
  // 登録の有無は返さない(第三者によるメールアドレスの存在確認を防ぐ)
  return json({ ok: true })
}
