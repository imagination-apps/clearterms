// サーバー側の共通処理(Vercel Functions 専用。フロントからは import しない)
import { createHmac, createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { VERIFY } from './config.js'

export function env(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env: ${name}`)
  return v
}

let _sb: SupabaseClient | null = null
export function supabase(): SupabaseClient {
  if (!_sb) {
    _sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return _sb
}

let _resend: Resend | null = null
export function resend(): Resend {
  if (!_resend) _resend = new Resend(env('RESEND_API_KEY'))
  return _resend
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  })
}

export async function readJson<T>(req: Request): Promise<Partial<T>> {
  try {
    return (await req.json()) as Partial<T>
  } catch {
    return {}
  }
}

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const e = raw.trim().toLowerCase()
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null
  return e
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for') ?? ''
  return fwd.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
}

/** IPはそのまま保存せず、ソルト付きハッシュのみ扱う */
export function ipHash(req: Request): string {
  return createHash('sha256').update(`${env('IP_HASH_SALT')}:${clientIp(req)}`).digest('hex')
}

export function hashCode(email: string, code: string): string {
  return createHmac('sha256', env('SESSION_SECRET')).update(`code:${email}:${code}`).digest('hex')
}

export function sixDigitCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export function newLicenseKey(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(16)
  let s = ''
  for (let i = 0; i < 16; i++) s += alphabet[bytes[i] % alphabet.length]
  return `CT-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`
}

export function isLicenseKeyFormat(k: unknown): k is string {
  return typeof k === 'string' && /^CT-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(k)
}

// ---- メール確認済みトークン(署名付き。DBを引かずに検証できる) ----
const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url')

export function signSession(email: string): string {
  const payload = b64u(JSON.stringify({ e: email, x: Date.now() + VERIFY.sessionDays * 86400_000 }))
  const sig = createHmac('sha256', env('SESSION_SECRET')).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifySession(token: unknown): string | null {
  if (typeof token !== 'string' || !token.includes('.')) return null
  const [payload, sig] = token.split('.')
  const expected = createHmac('sha256', env('SESSION_SECRET')).update(payload).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const { e, x } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { e: string; x: number }
    if (typeof e !== 'string' || typeof x !== 'number' || x < Date.now()) return null
    return e
  } catch {
    return null
  }
}

export function siteUrl(req: Request): string {
  return process.env.SITE_URL || new URL(req.url).origin
}
