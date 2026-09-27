// POST /api/translate
// 無料: { mode: 'free', token, text, outputLang }       → 冒頭のみ・低コストモデル・1日3回
// 有料: { mode: 'paid', licenseKey, text, outputLang, confirmCredits? } → 全文・高精度モデル・クレジット消費
//
// 回数は「先に原子的に確保 → API失敗時は返却」方式。連打・並列でもすり抜けられず、
// 失敗時は消費されない。契約書本文はどこにも保存・ログ出力しない。
import Anthropic from '@anthropic-ai/sdk'
import { FREE, MAX_PAID_CHARS, PAID, creditsNeeded, type Lang } from './_lib/config.js'
import { systemPrompt, teaserSlice, userMessage } from './_lib/prompt.js'
import { env, ipHash, isLicenseKeyFormat, json, readJson, supabase, verifySession } from './_lib/server.js'

type Body = {
  mode: 'free' | 'paid'
  text: string
  outputLang: Lang
  token: string
  licenseKey: string
  confirmCredits: number
}

// ストリーム末尾に付ける制御マーカー(フロントで解釈)
const MARK_ERROR = '\n[[CT_ERROR:busy]]'
const MARK_CUT = '\n[[CT_NOTE:output_limit]]'

export async function POST(req: Request): Promise<Response> {
  const body = await readJson<Body>(req)
  const raw = typeof body.text === 'string' ? body.text.replace(/\r\n/g, '\n').trim() : ''
  const outputLang: Lang = body.outputLang === 'ja' ? 'ja' : 'en'
  if (raw.length < 20) return json({ error: 'too_short' }, 400)

  const sb = supabase()
  let model: string
  let maxTokens: number
  let text: string
  let truncated = false
  let refund: () => Promise<void>
  const headers: Record<string, string> = {}

  if (body.mode === 'paid') {
    // ---------- 有料 ----------
    if (!isLicenseKeyFormat(body.licenseKey)) return json({ error: 'invalid_key' }, 401)
    if (raw.length > MAX_PAID_CHARS) return json({ error: 'too_long', max: MAX_PAID_CHARS }, 413)
    const need = creditsNeeded(raw.length)
    if (need > 1 && body.confirmCredits !== need) {
      // 2回分以上を消費する場合は、事前にユーザーの確認を取る
      return json({ error: 'confirm_credits', credits: need }, 409)
    }
    const { data: alloc, error } = await sb.rpc('clearterms_consume_credits', { p_key: body.licenseKey, p_n: need })
    if (error) {
      console.error('consume_credits failed', error.message)
      return json({ error: 'server' }, 500)
    }
    if (!alloc) return json({ error: 'no_credits' }, 402)
    refund = async () => {
      const { error: e } = await sb.rpc('clearterms_refund_credits', { p_alloc: alloc })
      if (e) console.error('refund_credits failed', e.message)
    }
    model = PAID.model
    maxTokens = PAID.maxOutputTokens
    text = raw
    headers['x-ct-credits-used'] = String(need)
  } else {
    // ---------- 無料(ティザー) ----------
    const email = verifySession(body.token)
    if (!email) return json({ error: 'verify_required' }, 401)
    const { data: usageId, error } = await sb.rpc('clearterms_consume_free', {
      p_email: email,
      p_ip_hash: ipHash(req),
      p_limit: FREE.dailyLimit,
    })
    if (error) {
      console.error('consume_free failed', error.message)
      return json({ error: 'server' }, 500)
    }
    if (!usageId) return json({ error: 'free_limit', limit: FREE.dailyLimit }, 429)
    refund = async () => {
      const { error: e } = await sb.rpc('clearterms_refund_free', { p_id: usageId })
      if (e) console.error('refund_free failed', e.message)
    }
    // 冒頭部分だけをAPIに送る(全文を変換して隠す方式は原価がかかるため禁止)
    const slice = teaserSlice(raw, FREE.teaserChars)
    text = slice.text
    truncated = slice.truncated
    model = FREE.model
    maxTokens = FREE.maxOutputTokens
    headers['x-ct-truncated'] = truncated ? '1' : '0'
    headers['x-ct-sent-chars'] = String(text.length)
    headers['x-ct-total-chars'] = String(raw.length)
  }

  const anthropic = new Anthropic({ apiKey: env('ANTHROPIC_API_KEY') })
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const s = anthropic.messages.stream({
          model,
          max_tokens: maxTokens,
          system: systemPrompt(outputLang, truncated),
          messages: [{ role: 'user', content: userMessage(text) }],
        })
        for await (const ev of s) {
          if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
            controller.enqueue(encoder.encode(ev.delta.text))
          }
        }
        const final = await s.finalMessage()
        if (final.stop_reason === 'max_tokens') controller.enqueue(encoder.encode(MARK_CUT))
      } catch (e) {
        // 残高不足・レート制限・過負荷など。本文はログに出さない
        const err = e as { status?: number; name?: string }
        console.error('anthropic error', err.status ?? '', err.name ?? '')
        await refund()
        controller.enqueue(encoder.encode(MARK_ERROR))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
      ...headers,
    },
  })
}
