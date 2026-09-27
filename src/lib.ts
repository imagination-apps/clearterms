// フロント側の共通処理:ストレージ、API呼び出し、PDF抽出、結果のパース

// ---------- localStorage(使えない環境でも落ちないように) ----------
export const store = {
  get(k: string): string | null {
    try { return localStorage.getItem(k) } catch { return null }
  },
  set(k: string, v: string | null) {
    try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch { /* ignore */ }
  },
}

// ---------- API ----------
export type Status = {
  free: { remaining: number; limit: number; email: string } | null
  paid: { valid: boolean; email: string | null; total: number; packs: { remaining: number; expires_at: string }[] } | null
}

export async function postJson<T = Record<string, unknown>>(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const data = (await res.json().catch(() => ({}))) as T
    return { ok: res.ok, status: res.status, data }
  } catch {
    return { ok: false, status: 0, data: { error: 'generic' } as T }
  }
}

// ---------- PDF → テキスト(ブラウザ内のみ) ----------
export async function extractPdfText(file: File): Promise<{ text: string; pages: number }> {
  // pdf.js は重いので、PDFを使うときだけ読み込む
  const [pdfjs, { default: workerUrl }] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const buf = await file.arrayBuffer()
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
  })
  const doc = await task.promise
  const pages: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    let line = ''
    const lines: string[] = []
    for (const item of content.items) {
      if (!('str' in item)) continue
      line += item.str
      if (item.hasEOL) {
        lines.push(line)
        line = ''
      }
    }
    if (line) lines.push(line)
    pages.push(lines.join('\n'))
  }
  const numPages = doc.numPages
  await task.destroy()
  const text = pages.join('\n\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return { text, pages: numPages }
}

// ---------- 結果のパース ----------
export type Section = { heading: string; body: string[]; questions: string[] }
export type Parsed = { intro: string[]; sections: Section[]; error: boolean; outputLimit: boolean }

export function parseOutput(raw: string): Parsed {
  const error = raw.includes('[[CT_ERROR:busy]]')
  const outputLimit = raw.includes('[[CT_NOTE:output_limit]]')
  const clean = raw.replace(/\n?\[\[CT_(ERROR|NOTE):[a-z_]+\]\]/g, '')
  const intro: string[] = []
  const sections: Section[] = []
  for (const rawLine of clean.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith('## ')) {
      sections.push({ heading: line.slice(3).trim(), body: [], questions: [] })
      continue
    }
    const cur = sections[sections.length - 1]
    if (/^[?？]\s*/.test(line)) {
      const q = line.replace(/^[?？]\s*/, '')
      if (cur) cur.questions.push(q)
      else intro.push(q)
      continue
    }
    if (cur) cur.body.push(line)
    else intro.push(line)
  }
  return { intro, sections, error, outputLimit }
}

export function toPlainText(p: Parsed, qLabel: string): string {
  const parts = p.intro.slice()
  for (const s of p.sections) {
    parts.push(`■ ${s.heading}`, ...s.body)
    if (s.questions.length) parts.push(`${qLabel}:`, ...s.questions.map((q) => `・${q}`))
    parts.push('')
  }
  return parts.join('\n').trim()
}
