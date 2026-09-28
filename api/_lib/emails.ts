// メール文面(英語・日本語)
import { PAID, VERIFY, type Lang } from './config.js'
import { resend } from './server.js'

const BRAND = 'ClearTerms'
const FOOTER = {
  en: 'ClearTerms by Imagination apps · This tool does not provide legal advice.',
  ja: 'ClearTerms / Imagination apps(運営:ロウヤ)・本ツールは法的アドバイスではありません。',
}

function layout(lang: Lang, title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#FFF6EA;font-family:'Hiragino Sans','Noto Sans JP',Arial,sans-serif;color:#3A2A1E">
<div style="max-width:520px;margin:0 auto;padding:32px 20px">
<p style="font-family:Georgia,'Hiragino Mincho ProN',serif;font-size:22px;font-weight:700;margin:0 0 20px;color:#C85F28">${BRAND}</p>
<div style="background:#fff;border:1px solid #EEDCC4;border-radius:16px;padding:24px">
<h1 style="font-size:18px;margin:0 0 16px">${title}</h1>
${bodyHtml}
</div>
<p style="font-size:12px;color:#6B584A;margin:20px 0 0">${FOOTER[lang]}</p>
</div></body></html>`
}

const code = (s: string) =>
  `<p style="font-family:Menlo,Consolas,monospace;font-size:22px;letter-spacing:2px;background:#FBE9D3;border-radius:10px;padding:14px 16px;text-align:center;margin:16px 0">${s}</p>`

function fmtDate(iso: string, lang: Lang): string {
  return new Date(iso).toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: lang === 'ja' ? 'Asia/Tokyo' : 'UTC',
  })
}

// 送信元アドレス。MAIL_FROM があればそれを使い、なければ
// Resend に登録済み(認証済み)のドメインから自動で決める(登録の手間を減らすため)
let _from: string | null = null
async function fromAddress(): Promise<string> {
  if (process.env.MAIL_FROM) return process.env.MAIL_FROM
  if (_from) return _from
  const { data, error } = await resend().domains.list()
  const domain = data?.data?.find((d) => d.status === 'verified')
  if (error || !domain) {
    throw new Error('MAIL_FROM is not set and no verified Resend domain was found')
  }
  _from = `ClearTerms <noreply@${domain.name}>`
  return _from
}

async function send(to: string, subject: string, html: string) {
  const { error } = await resend().emails.send({ from: await fromAddress(), to, subject, html })
  if (error) throw new Error(`Resend error: ${error.message}`)
}

export async function sendVerifyCode(to: string, c: string, lang: Lang) {
  const t = lang === 'ja'
    ? { s: `【ClearTerms】確認コード: ${c}`, h: 'メールアドレスの確認',
        b: `<p>以下の6桁のコードを画面に入力してください。</p>${code(c)}<p style="font-size:13px;color:#6B584A">有効期限は${VERIFY.codeTtlMinutes}分です。心当たりがない場合はこのメールを破棄してください。</p>` }
    : { s: `ClearTerms verification code: ${c}`, h: 'Verify your email',
        b: `<p>Enter this 6-digit code on the page:</p>${code(c)}<p style="font-size:13px;color:#6B584A">It expires in ${VERIFY.codeTtlMinutes} minutes. If you didn't request this, you can ignore this email.</p>` }
  await send(to, t.s, layout(lang, t.h, t.b))
}

export async function sendPurchaseEmail(to: string, key: string, expiresAt: string, totalCredits: number, siteUrl: string, lang: Lang) {
  const exp = fmtDate(expiresAt, lang)
  const t = lang === 'ja'
    ? { s: '【ClearTerms】ご購入ありがとうございます(ライセンスキー)', h: 'ご購入ありがとうございます',
        b: `<p>フル変換 ${PAID.creditsPerPack}回分パックを追加しました。ライセンスキーは次のとおりです。</p>${code(key)}
<p>・今回のパックの有効期限:<b>${exp}</b>(購入日から${PAID.packValidityMonths}か月)<br>・現在の残り回数(合計):<b>${totalCredits}回</b></p>
<p style="font-size:13px;color:#6B584A">有効期限はパックごとに設定され、延長されません。期限が近いパックから順に消費されます。追加購入すると同じキーに回数が加算されます。</p>
<p><a href="${siteUrl}/?key=${encodeURIComponent(key)}" style="color:#C85F28">ClearTermsを開く →</a></p>` }
    : { s: 'Your ClearTerms license key', h: 'Thanks for your purchase',
        b: `<p>We've added a ${PAID.creditsPerPack}-conversion pack. Your license key:</p>${code(key)}
<p>• This pack expires on <b>${exp}</b> (${PAID.packValidityMonths} months after purchase)<br>• Total conversions remaining: <b>${totalCredits}</b></p>
<p style="font-size:13px;color:#6B584A">Each pack has its own expiry date, which is never extended. Credits from the pack expiring soonest are used first. Future purchases are added to the same key.</p>
<p><a href="${siteUrl}/?key=${encodeURIComponent(key)}" style="color:#C85F28">Open ClearTerms →</a></p>` }
  await send(to, t.s, layout(lang, t.h, t.b))
}

export async function sendRestoreEmail(to: string, key: string, siteUrl: string, lang: Lang) {
  const t = lang === 'ja'
    ? { s: '【ClearTerms】ライセンスキーの再送', h: 'ライセンスキーの再送',
        b: `<p>ご依頼のライセンスキーをお送りします。</p>${code(key)}<p><a href="${siteUrl}/?key=${encodeURIComponent(key)}" style="color:#C85F28">ClearTermsを開く →</a></p>` }
    : { s: 'Your ClearTerms license key', h: 'Here is your license key',
        b: `<p>As requested, here is your license key:</p>${code(key)}<p><a href="${siteUrl}/?key=${encodeURIComponent(key)}" style="color:#C85F28">Open ClearTerms →</a></p>` }
  await send(to, t.s, layout(lang, t.h, t.b))
}

export async function sendExpiryReminder(to: string, key: string, remaining: number, expiresAt: string, siteUrl: string) {
  // 購入時の言語を保存していないため、日英併記で送る
  const expJa = fmtDate(expiresAt, 'ja')
  const expEn = fmtDate(expiresAt, 'en')
  const body = `<p>ClearTermsのフル変換パックに <b>${remaining}回分</b> の残りがあり、<b>${expJa}</b> に有効期限を迎えます。期限後は使えなくなりますので、お早めにご利用ください。</p>
<p style="font-size:13px;color:#6B584A">You have <b>${remaining}</b> conversion(s) left in a ClearTerms pack that expires on <b>${expEn}</b>. Unused credits can't be used after that date.</p>
<p><a href="${siteUrl}/?key=${encodeURIComponent(key)}" style="color:#C85F28">ClearTermsを開く / Open ClearTerms →</a></p>`
  await send(to, '【ClearTerms】まもなく有効期限です / Your credits expire soon', layout('ja', '有効期限のお知らせ / Expiry reminder', body))
}
