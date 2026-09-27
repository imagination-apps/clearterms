// ClearTerms — 価格・上限・モデルの定数はすべてここで管理する。
// 値を変える場合はこのファイルだけ書き換えればよい(フロント・API共通)。

export const PRODUCT_ID = 'clearterms'

/** 無料版(ティザー) */
export const FREE = {
  /** 確認済みメール1件あたり/同一IPあたり の1日の上限回数(UTC日付で区切る) */
  dailyLimit: 3,
  /** 無料版でAPIに送る最大文字数(これを超える部分は送らない=原価がかからない) */
  teaserChars: 2000,
  model: 'claude-haiku-4-5-20251001',
  maxOutputTokens: 2000,
} as const

/** 有料版(フル変換パック) */
export const PAID = {
  priceLabel: '$9.99',
  /** 1パックあたりの回数 */
  creditsPerPack: 20,
  /** パックの有効期限(月)。資金決済法の前払式支払手段の適用除外のため 6 を超えないこと */
  packValidityMonths: 6,
  /** 1回分として扱う最大文字数。超えると ceil(文字数 / この値) 回分を消費 */
  charsPerCredit: 30000,
  /** 1リクエストで消費できる最大回数(= 受け付ける最大文字数 90,000) */
  maxCreditsPerRequest: 3,
  model: 'claude-sonnet-5',
  maxOutputTokens: 16000,
  /** 残りがこの回数以下になったら追加購入ボタンを強調 */
  lowCreditsThreshold: 3,
} as const

/** 期限切れの何日前にリマインドメールを送るか */
export const EXPIRY_REMINDER_DAYS = 14

/** 確認コード */
export const VERIFY = {
  codeTtlMinutes: 10,
  resendCooldownSeconds: 60,
  maxAttempts: 5,
  /** 確認済みトークンの有効日数 */
  sessionDays: 30,
} as const

export function creditsNeeded(chars: number): number {
  return Math.max(1, Math.ceil(chars / PAID.charsPerCredit))
}

export const MAX_PAID_CHARS = PAID.charsPerCredit * PAID.maxCreditsPerRequest

export type Lang = 'en' | 'ja'
