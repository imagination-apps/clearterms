import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MAX_PAID_CHARS, PAID, creditsNeeded, type Lang } from '../api/_lib/config'
import { detectLang, dict } from './i18n'
import { LegalContent } from './Legal'
import { extractPdfText, parseOutput, postJson, store, toPlainText, type Status } from './lib'

type Teaser = { sent: number; total: number } | null

export default function App() {
  const [lang, setLang] = useState<Lang>(detectLang)
  const t = dict[lang]

  // 入力
  const [tab, setTab] = useState<'paste' | 'pdf'>('paste')
  const [text, setText] = useState('')
  const [pdfMsg, setPdfMsg] = useState<{ kind: 'info' | 'error'; text: string } | null>(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [outputLang, setOutputLang] = useState<Lang>(lang)
  const [consent, setConsent] = useState(() => store.get('ct_consent') === '1')

  // 認証・残高
  const [token, setToken] = useState<string | null>(() => store.get('ct_token'))
  const [licenseKey, setLicenseKey] = useState<string | null>(() => store.get('ct_key'))
  const [status, setStatus] = useState<Status | null>(null)

  // メール確認
  const [email, setEmail] = useState('')
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [verifyBusy, setVerifyBusy] = useState(false)
  const [verifyErr, setVerifyErr] = useState<string | null>(null)

  // 実行・結果
  const [running, setRunning] = useState(false)
  const [raw, setRaw] = useState('')
  const [teaser, setTeaser] = useState<Teaser>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmNeed, setConfirmNeed] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)

  // その他
  const [notice, setNotice] = useState<{ kind: 'ok' | 'info'; text: string } | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [keyErr, setKeyErr] = useState<string | null>(null)
  const [restoreEmail, setRestoreEmail] = useState('')
  const [restoreMsg, setRestoreMsg] = useState<string | null>(null)
  const [showKeyBox, setShowKeyBox] = useState(false)
  const [modal, setModal] = useState<'terms' | 'tokushoho' | null>(null)
  const [buying, setBuying] = useState(false)
  const resultRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    store.set('ct_lang', lang)
    document.documentElement.lang = lang
  }, [lang])

  const refreshStatus = useCallback(async (tk = token, key = licenseKey) => {
    if (!tk && !key) {
      setStatus(null)
      return
    }
    const { ok, data } = await postJson<Status>('/api/status', { token: tk, licenseKey: key })
    if (!ok) return
    if (tk && !data.free) {
      // トークン期限切れ
      store.set('ct_token', null)
      setToken(null)
    }
    setStatus(data)
  }, [token, licenseKey])

  const applyKey = useCallback((k: string) => {
    store.set('ct_key', k)
    setLicenseKey(k)
    return k
  }, [])

  // 初回:URLパラメータ(?key= / 購入完了)の処理
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const key = params.get('key')
    const purchase = params.get('purchase')
    const sessionId = params.get('session_id')
    if (key || purchase) history.replaceState(null, '', location.pathname)

    let k = licenseKey
    if (key && /^CT-/.test(key)) k = applyKey(key.toUpperCase())

    if (purchase === 'cancel') setNotice({ kind: 'info', text: t.purchaseCancel })
    if (purchase === 'success' && sessionId) {
      setNotice({ kind: 'info', text: t.purchasePending })
      let tries = 0
      const poll = async () => {
        tries++
        try {
          const res = await fetch(`/api/license/from-session?session_id=${encodeURIComponent(sessionId)}`)
          const data = (await res.json()) as { licenseKey?: string; pending?: boolean }
          if (data.licenseKey) {
            applyKey(data.licenseKey)
            setNotice({ kind: 'ok', text: `${t.purchaseThanks} ${t.purchaseMailed}` })
            refreshStatus(token, data.licenseKey)
            return
          }
        } catch { /* retry */ }
        if (tries < 15) setTimeout(poll, 2000)
        else setNotice({ kind: 'info', text: t.purchaseMailed })
      }
      poll()
    }
    refreshStatus(token, k)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const credits = status?.paid?.valid ? status.paid.total : 0
  const paidMode = credits > 0
  const freeLeft = status?.free?.remaining ?? null
  const verifiedEmail = status?.free?.email ?? null
  const parsed = useMemo(() => parseOutput(raw), [raw])

  const nearestExpiry = useMemo(() => {
    const p = status?.paid?.packs?.[0]
    if (!p) return null
    const d = new Date(p.expires_at).toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    return { n: p.remaining, d }
  }, [status, lang])

  // ---------- PDF ----------
  async function onPdf(file: File | undefined) {
    if (!file) return
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setPdfMsg({ kind: 'error', text: t.pdfError })
      return
    }
    setPdfBusy(true)
    setPdfMsg({ kind: 'info', text: t.pdfReading })
    try {
      const { text: extracted, pages } = await extractPdfText(file)
      if (extracted.replace(/\s/g, '').length < 20) {
        setPdfMsg({ kind: 'error', text: t.pdfNoText })
      } else {
        setText(extracted)
        setPdfMsg({ kind: 'info', text: t.pdfLoaded(pages, extracted.length) })
        setTab('paste')
      }
    } catch {
      setPdfMsg({ kind: 'error', text: t.pdfError })
    } finally {
      setPdfBusy(false)
    }
  }

  // ---------- メール確認 ----------
  async function sendCode() {
    setVerifyErr(null)
    setVerifyBusy(true)
    const { ok, data } = await postJson<{ error?: string }>('/api/verify/send', { email, lang })
    setVerifyBusy(false)
    if (!ok) return setVerifyErr(t.errors[data.error ?? 'generic'] ?? t.errors.generic)
    setCodeSentTo(email.trim().toLowerCase())
  }

  async function confirmCode() {
    setVerifyErr(null)
    setVerifyBusy(true)
    const { ok, data } = await postJson<{ error?: string; token?: string }>('/api/verify/confirm', { email: codeSentTo, code })
    setVerifyBusy(false)
    if (!ok || !data.token) return setVerifyErr(t.errors[data.error ?? 'generic'] ?? t.errors.generic)
    store.set('ct_token', data.token)
    setToken(data.token)
    setCode('')
    setCodeSentTo(null)
    refreshStatus(data.token, licenseKey)
  }

  // ---------- 変換 ----------
  async function run(confirmCredits?: number) {
    setError(null)
    setConfirmNeed(null)
    if (!consent) return
    const mode = paidMode ? 'paid' : 'free'
    setRunning(true)
    setRaw('')
    setTeaser(null)
    setCopied(false)
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode, text, outputLang, token, licenseKey, confirmCredits }),
      })
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; credits?: number }
        if (data.error === 'confirm_credits' && data.credits) {
          setConfirmNeed(data.credits)
        } else if (data.error === 'verify_required') {
          store.set('ct_token', null)
          setToken(null)
          setError(t.errors.verify_required)
        } else {
          setError(t.errors[data.error ?? 'generic'] ?? t.errors.generic)
        }
        return
      }
      if (res.headers.get('x-ct-truncated') === '1') {
        setTeaser({ sent: Number(res.headers.get('x-ct-sent-chars')), total: Number(res.headers.get('x-ct-total-chars')) })
      }
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let acc = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        acc += decoder.decode(value, { stream: true })
        setRaw(acc)
      }
    } catch {
      setError(t.errors.generic)
    } finally {
      setRunning(false)
      refreshStatus()
    }
  }

  function onRunClick() {
    if (paidMode) {
      const need = creditsNeeded(text.length)
      if (need > 1) return setConfirmNeed(need)
    }
    run()
  }

  // ---------- 購入・キー ----------
  async function buy() {
    setBuying(true)
    const { ok, data } = await postJson<{ url?: string; error?: string }>('/api/checkout', {
      lang,
      licenseKey,
      email: status?.paid?.email ?? verifiedEmail ?? undefined,
    })
    if (ok && data.url) {
      location.href = data.url
      return
    }
    setBuying(false)
    setError(t.errors.checkout_failed)
  }

  async function useKey() {
    setKeyErr(null)
    const k = keyInput.trim().toUpperCase()
    const { ok, data } = await postJson<Status>('/api/status', { licenseKey: k })
    if (!ok || !data.paid?.valid) return setKeyErr(t.invalidKey)
    applyKey(k)
    setKeyInput('')
    setShowKeyBox(false)
    refreshStatus(token, k)
  }

  async function restore() {
    setRestoreMsg(null)
    const { ok, data } = await postJson<{ error?: string }>('/api/license/restore', { email: restoreEmail, lang })
    setRestoreMsg(ok ? t.restoreSent : (t.errors[data.error ?? 'generic'] ?? t.errors.generic))
  }

  function removeKey() {
    store.set('ct_key', null)
    setLicenseKey(null)
    refreshStatus(token, null)
  }

  async function copyResult() {
    try {
      await navigator.clipboard.writeText(toPlainText(parsed, t.questions))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  const tooLong = paidMode && text.length > MAX_PAID_CHARS
  const needVerify = !paidMode && !token
  const canRun = consent && !running && text.trim().length >= 20 && !needVerify && !tooLong && !(freeLeft === 0 && !paidMode)

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-line bg-gradient-to-b from-cream-deep to-cream">
        <div className="max-w-3xl mx-auto px-4 pt-5 pb-10">
          <div className="flex items-center justify-between gap-3">
            <a href="/" className="flex items-center gap-2 font-serif text-xl font-bold text-orange-deep">
              <Logo /> ClearTerms
            </a>
            <div className="flex items-center gap-2 text-sm">
              {credits > 0 && (
                <span className="hidden sm:inline rounded-full bg-white border border-line px-3 py-1 text-ink-soft">{t.credits(credits)}</span>
              )}
              <div className="flex rounded-full border border-line bg-white overflow-hidden" role="group" aria-label="Language">
                {(['en', 'ja'] as const).map((l) => (
                  <button
                    key={l}
                    onClick={() => { setLang(l); setOutputLang(l) }}
                    className={`px-3 py-1 ${lang === l ? 'bg-orange text-white' : 'text-ink-soft hover:bg-cream-deep'}`}
                    aria-pressed={lang === l}
                  >
                    {l === 'en' ? 'EN' : '日本語'}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <h1 className="font-serif font-bold text-3xl sm:text-4xl mt-10 leading-snug">{t.tagline}</h1>
          <p className="mt-4 text-ink-soft leading-relaxed">{t.lead}</p>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-8 space-y-6">
        {notice && (
          <div className={`rounded-xl border px-4 py-3 text-sm ${notice.kind === 'ok' ? 'bg-green-50 border-green-200 text-green-900' : 'bg-white border-line'}`}>
            {notice.text}
          </div>
        )}

        {/* 免責(必須) */}
        <Disclaimer title={t.disclaimerTitle} text={t.disclaimer} />

        {/* 入力 */}
        <section className="rounded-2xl bg-white border border-line shadow-sm">
          <div className="flex border-b border-line" role="tablist">
            {(['paste', 'pdf'] as const).map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={`flex-1 px-4 py-3 text-sm font-bold ${tab === k ? 'text-orange-deep border-b-2 border-orange' : 'text-ink-soft hover:text-ink'}`}
              >
                {k === 'paste' ? t.tabPaste : t.tabPdf}
              </button>
            ))}
          </div>
          <div className="p-4">
            {tab === 'paste' ? (
              <>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={t.pastePlaceholder}
                  className="w-full h-64 resize-y rounded-xl border border-line bg-cream/40 p-3 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-orange-soft"
                />
                <div className="mt-1 flex justify-between text-xs text-ink-soft">
                  <span>{pdfMsg?.kind === 'info' ? pdfMsg.text : ''}</span>
                  <span className={tooLong ? 'text-red-700 font-bold' : ''}>{t.chars(text.length)}</span>
                </div>
              </>
            ) : (
              <label
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); onPdf(e.dataTransfer.files[0]) }}
                className={`flex flex-col items-center justify-center h-64 rounded-xl border-2 border-dashed cursor-pointer text-center px-4 transition ${dragOver ? 'border-orange bg-cream-deep' : 'border-line bg-cream/40 hover:bg-cream-deep/60'}`}
              >
                <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => onPdf(e.target.files?.[0])} disabled={pdfBusy} />
                <PdfIcon />
                <span className="mt-3 font-bold">{pdfBusy ? t.pdfReading : t.pdfDrop}</span>
                <span className="mt-2 text-xs text-ink-soft max-w-sm">{t.pdfNote}</span>
                {pdfMsg?.kind === 'error' && <span className="mt-3 text-sm text-red-700">{pdfMsg.text}</span>}
              </label>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2">
                <span className="text-ink-soft">{t.outputLang}</span>
                <select value={outputLang} onChange={(e) => setOutputLang(e.target.value as Lang)} className="rounded-lg border border-line bg-white px-2 py-1">
                  <option value="ja">日本語</option>
                  <option value="en">English</option>
                </select>
              </label>
              <span className="text-ink-soft text-xs">{paidMode ? t.credits(credits) : t.freeInfo}</span>
            </div>

            <label className="mt-4 flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => { setConsent(e.target.checked); store.set('ct_consent', e.target.checked ? '1' : null) }}
                className="mt-1 accent-orange-deep"
              />
              <span>{t.consent}</span>
            </label>
            <p className="mt-2 text-xs text-ink-soft flex gap-1.5"><LockIcon />{t.privacy}</p>

            {/* 無料版:メール確認 */}
            {needVerify && (
              <div className="mt-4 rounded-xl bg-cream-deep/60 border border-line p-4">
                <p className="font-bold text-sm">{t.verifyTitle}</p>
                <p className="text-xs text-ink-soft mt-1">{t.verifyNote}</p>
                {!codeSentTo ? (
                  <form className="mt-3 flex flex-col sm:flex-row gap-2" onSubmit={(e) => { e.preventDefault(); sendCode() }}>
                    <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t.emailPlaceholder} className="flex-1 rounded-lg border border-line bg-white px-3 py-2 text-sm" autoComplete="email" />
                    <button disabled={verifyBusy} className="rounded-lg bg-ink text-white px-4 py-2 text-sm font-bold disabled:opacity-50">{t.sendCode}</button>
                  </form>
                ) : (
                  <form className="mt-3" onSubmit={(e) => { e.preventDefault(); confirmCode() }}>
                    <p className="text-xs text-ink-soft mb-2">{t.codeSent(codeSentTo)}</p>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder={t.codePlaceholder} className="flex-1 rounded-lg border border-line bg-white px-3 py-2 text-sm tracking-widest" />
                      <button disabled={verifyBusy || code.length !== 6} className="rounded-lg bg-ink text-white px-4 py-2 text-sm font-bold disabled:opacity-50">{t.confirmCode}</button>
                    </div>
                    <button type="button" onClick={() => { setCodeSentTo(null); setCode('') }} className="mt-2 text-xs underline text-ink-soft">{t.changeEmail}</button>
                  </form>
                )}
                {verifyErr && <p className="mt-2 text-sm text-red-700">{verifyErr}</p>}
              </div>
            )}

            {!paidMode && verifiedEmail && (
              <p className="mt-3 text-xs text-ink-soft">{t.verifiedAs(verifiedEmail)}{freeLeft !== null && ` · ${t.freeLeft(freeLeft)}`}</p>
            )}

            {/* 複数回分の消費確認 */}
            {confirmNeed && (
              <div className="mt-4 rounded-xl border border-orange-soft bg-cream-deep p-4 text-sm">
                <p>{t.confirmCredits(confirmNeed, text.length)}</p>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => run(confirmNeed)} className="rounded-lg bg-orange-deep text-white px-4 py-2 font-bold">{t.confirmYes}</button>
                  <button onClick={() => setConfirmNeed(null)} className="rounded-lg border border-line bg-white px-4 py-2">{t.cancel}</button>
                </div>
              </div>
            )}

            <button
              onClick={onRunClick}
              disabled={!canRun}
              className="mt-5 w-full rounded-xl bg-orange-deep hover:bg-orange text-white py-3.5 font-bold text-base shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              {running ? t.running : paidMode ? t.runPaid : t.runFree}
            </button>
            {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
            {tooLong && <p className="mt-3 text-sm text-red-700">{t.errors.too_long}</p>}
          </div>
        </section>

        {/* 結果 */}
        {(raw || running) && (
          <section ref={resultRef} className="rounded-2xl bg-white border border-line shadow-sm p-5 scroll-mt-4" aria-live="polite">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h2 className="font-serif text-xl font-bold">{t.resultTitle}</h2>
              {!running && parsed.sections.length > 0 && (
                <button onClick={copyResult} className="text-sm rounded-lg border border-line px-3 py-1 hover:bg-cream-deep">{copied ? t.copied : t.copy}</button>
              )}
            </div>
            <p className="text-xs text-ink-soft border-l-2 border-orange-soft pl-2 mb-4">{t.footerDisclaimer}</p>

            {parsed.intro.map((l, i) => <p key={i} className="text-sm mb-2">{l}</p>)}
            <div className="space-y-4">
              {parsed.sections.map((s, i) => (
                <article key={i} className="rounded-xl border border-line p-4">
                  <h3 className="font-bold text-orange-deep">{s.heading}</h3>
                  {s.body.map((b, j) => <p key={j} className="mt-2 text-sm leading-relaxed">{b}</p>)}
                  {s.questions.length > 0 && (
                    <div className="mt-3 rounded-lg bg-cream/70 px-3 py-2">
                      <p className="text-xs font-bold text-ink-soft">{t.questions}</p>
                      <ul className="mt-1 space-y-1 text-sm list-disc pl-5">
                        {s.questions.map((q, j) => <li key={j}>{q}</li>)}
                      </ul>
                    </div>
                  )}
                </article>
              ))}
            </div>
            {running && <p className="mt-4 text-sm text-ink-soft animate-pulse">{t.running}</p>}
            {parsed.error && <p className="mt-4 text-sm text-red-700">{t.busy}</p>}
            {parsed.outputLimit && <p className="mt-4 text-sm text-ink-soft">{t.outputLimit}</p>}

            {teaser && !running && !parsed.error && (
              <div className="mt-6 rounded-xl bg-gradient-to-br from-cream-deep to-cream border border-orange-soft p-5 text-center">
                <p className="text-sm text-ink-soft">{t.teaserEnd(teaser.sent, teaser.total)}</p>
                <p className="mt-1 font-bold">{t.teaserCta}</p>
                <BuyButton onClick={buy} busy={buying} label={t.buyPack} className="mt-4" />
                <p className="mt-2 text-xs text-ink-soft">{t.buyNote}</p>
              </div>
            )}
          </section>
        )}

        {/* 購入・ライセンス */}
        <section className="rounded-2xl bg-white border border-line p-5">
          {credits > 0 ? (
            <div>
              <p className="font-bold">{t.credits(credits)}</p>
              {nearestExpiry && <p className="text-sm text-ink-soft">{t.creditsExpiry(nearestExpiry.n, nearestExpiry.d)}</p>}
              {credits <= PAID.lowCreditsThreshold && <p className="mt-2 text-sm text-orange-deep font-bold">{t.lowCredits}</p>}
              <BuyButton onClick={buy} busy={buying} label={t.buyMore} className="mt-3" subtle={credits > PAID.lowCreditsThreshold} />
              <p className="mt-2 text-xs text-ink-soft">{t.buyNote}</p>
            </div>
          ) : (
            <div>
              {status?.paid?.valid && <p className="text-sm mb-3">{t.noCredits}</p>}
              <BuyButton onClick={buy} busy={buying} label={t.buyPack} />
              <p className="mt-2 text-xs text-ink-soft">{t.buyNote}</p>
            </div>
          )}

          <div className="mt-5 border-t border-line pt-4 text-sm">
            {licenseKey ? (
              <p className="text-ink-soft text-xs break-all">
                {licenseKey} · <button onClick={removeKey} className="underline">{t.signOutKey}</button>
              </p>
            ) : (
              <>
                <button onClick={() => setShowKeyBox((v) => !v)} className="underline text-ink-soft">{t.haveKey}</button>
                {showKeyBox && (
                  <div className="mt-3 space-y-3">
                    <form className="flex flex-col sm:flex-row gap-2" onSubmit={(e) => { e.preventDefault(); useKey() }}>
                      <input value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder={t.keyPlaceholder} className="flex-1 rounded-lg border border-line px-3 py-2 font-mono text-sm" />
                      <button className="rounded-lg bg-ink text-white px-4 py-2 font-bold">{t.useKey}</button>
                    </form>
                    {keyErr && <p className="text-red-700">{keyErr}</p>}
                    <p className="text-xs text-ink-soft">{t.forgotKey}</p>
                    <form className="flex flex-col sm:flex-row gap-2" onSubmit={(e) => { e.preventDefault(); restore() }}>
                      <input type="email" required value={restoreEmail} onChange={(e) => setRestoreEmail(e.target.value)} placeholder={t.emailPlaceholder} className="flex-1 rounded-lg border border-line px-3 py-2 text-sm" />
                      <button className="rounded-lg border border-line px-4 py-2">{t.restoreSend}</button>
                    </form>
                    {restoreMsg && <p className="text-xs text-ink-soft">{restoreMsg}</p>}
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-cream-deep/50">
        <div className="max-w-3xl mx-auto px-4 py-8 text-sm text-ink-soft space-y-3">
          <p className="font-bold text-ink">{t.footerDisclaimer}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <button onClick={() => setModal('terms')} className="underline">{t.legal}</button>
            <button onClick={() => setModal('tokushoho')} className="underline">{t.tokushoho}</button>
            <a href="https://imagination-apps.vercel.app/" className="underline">{t.moreTools}</a>
          </div>
          <p>{t.operator} · © {new Date().getFullYear()} Imagination apps</p>
        </div>
      </footer>

      {modal && (
        <div className="fixed inset-0 z-50 bg-ink/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setModal(null)}>
          <div role="dialog" aria-modal="true" className="bg-white w-full sm:max-w-2xl max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-6" onClick={(e) => e.stopPropagation()}>
            <LegalContent lang={lang} kind={modal} />
            <button onClick={() => setModal(null)} className="mt-6 rounded-lg border border-line px-4 py-2 text-sm">{t.close}</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Disclaimer({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-xl border border-orange-soft bg-white px-4 py-3 flex gap-3" role="note">
      <span className="shrink-0 mt-0.5 text-orange-deep" aria-hidden>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 8v5M12 16.5v.5" strokeLinecap="round" /></svg>
      </span>
      <div className="text-sm">
        <p className="font-bold">{title}</p>
        <p className="text-ink-soft mt-0.5 leading-relaxed">{text}</p>
      </div>
    </div>
  )
}

function BuyButton({ onClick, busy, label, className = '', subtle = false }: { onClick: () => void; busy: boolean; label: string; className?: string; subtle?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`${className} w-full sm:w-auto rounded-xl px-5 py-3 font-bold transition disabled:opacity-50 ${subtle ? 'border border-orange-deep text-orange-deep hover:bg-cream-deep' : 'bg-ink text-white hover:bg-ink/85'}`}
    >
      {label}
    </button>
  )
}

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden>
      <rect x="5" y="3" width="20" height="26" rx="3" fill="#FFF" stroke="#C85F28" strokeWidth="2" />
      <path d="M10 10h10M10 15h10M10 20h6" stroke="#E07A3E" strokeWidth="2" strokeLinecap="round" />
      <circle cx="23" cy="23" r="6" fill="#E07A3E" />
      <path d="M20.5 23l1.8 1.8 3.2-3.4" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function PdfIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#C85F28" strokeWidth="1.6" aria-hidden>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M12 12v6M9.5 15.5L12 18l2.5-2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 mt-0.5" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}
