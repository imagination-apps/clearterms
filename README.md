# ClearTerms

フリーランス・個人事業主向けの、契約書・利用規約を平易な言葉に言い換えるツール(英語・日本語対応)。
運営:ロウヤ / Imagination apps

- Vite + React + Tailwind(フロント)
- Vercel Functions(`api/`)+ Supabase + Resend + Stripe(ライセンス・課金)
- Claude API(無料版は Haiku 4.5・冒頭のみ、有料版は Sonnet 5・全文)

## 仕様の要点

| 項目 | 無料(ティザー) | 有料(フル変換パック) |
|---|---|---|
| 送る文字数 | 冒頭約2,000文字**だけ**をAPIに送る | 全文(1回30,000文字まで。超えたら事前確認のうえ2〜3回分を消費) |
| モデル | claude-haiku-4-5-20251001 | claude-sonnet-5 |
| 回数 | 確認済みメール1件・同一IPそれぞれ1日3回 | $9.99で20回分、何度でも追加購入可 |
| 本人確認 | メールに6桁コード(Resend) | ライセンスキー(メール送付・復元可) |
| 有効期限 | — | パックごとに購入日から6か月(延長しない)、期限の近い順に消費 |

- 数値はすべて `api/_lib/config.ts` で変更できる
- 回数は「先に原子的に確保 → API失敗時は返却」方式。連打・並列リクエストでもすり抜け不可、失敗時は消費されない
- 契約書の本文はDB・ログに一切保存しない。PDFはブラウザ内で読み取り、ファイルは送信しない
- 出力は「言い換え」と「相手に確認したい質問」のみ(有利・不利の判断や修正提案はしない=弁護士法72条対策)
- 免責表示:ページ上部・結果画面・フッター・Stripe決済画面・メールに表示、初回は同意チェック必須
- 期限14日前に残数のあるユーザーへリマインドメール(Vercel Cron)
- Supabaseキープアライブ(`api/cron/keepalive.ts` + `vercel.json` の crons + `CRON_SECRET`)組み込み済み

## セットアップ(初回のみ)

1. **Supabase**:CSV Bridgeと同じプロジェクトの SQL Editor で `supabase/clearterms.sql` を実行
2. **Anthropic Console**:APIキー発行・支払い設定、使用量の通知(例:$10)と月間上限(例:$30)を設定
3. **Stripe**:商品「ClearTerms フル変換20回分パック」$9.99(1回払い)を作成し、価格ID(price_...)を控える
   - Webhook:エンドポイント `https://<ドメイン>/api/stripe-webhook`、イベント `checkout.session.completed` と `checkout.session.async_payment_succeeded`
4. **Vercel**:Import → Framework は Vite。`.env.example` の環境変数をすべて登録してデプロイ
5. 動作確認後、ハブページ(imagination-apps/home)の `data/products.json` に追記

## ローカル開発

```
npm install
vercel dev          # API込みで動かす場合
npm run dev         # フロントのみ(API_PROXY=https://… で本番APIに転送も可)
```
