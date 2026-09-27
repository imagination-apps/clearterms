// Supabase 無料プランの「7日間無操作で自動一時停止」対策。
// Vercel Cron から1日1回呼ばれ、軽いクエリを実行する(CSV Bridge と同じ仕組み)。
import { json, supabase } from '../_lib/server.js'

export async function GET(req: Request): Promise<Response> {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return json({ error: 'unauthorized' }, 401)
  }
  const { data, error } = await supabase().rpc('clearterms_ping')
  if (error) {
    console.error('keepalive failed', error.message)
    return json({ ok: false }, 500)
  }
  return json({ ok: true, ping: data, at: new Date().toISOString() })
}
