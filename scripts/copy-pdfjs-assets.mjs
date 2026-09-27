// pdf.js の日本語フォント用CMap等を public/pdfjs にコピー(ビルド前に自動実行)
import { cpSync, mkdirSync } from 'node:fs'
mkdirSync('public/pdfjs', { recursive: true })
for (const dir of ['cmaps', 'standard_fonts']) {
  cpSync(`node_modules/pdfjs-dist/${dir}`, `public/pdfjs/${dir}`, { recursive: true })
}
console.log('pdfjs assets copied')
