// node fetch-text.mjs <page.html> <out.txt>
// Writes a fetched page's visible text (tags stripped) for reading.
// Fetch first with curl: curl -sSL -A "Mozilla/5.0" <url> -o page.html
import { readFileSync, writeFileSync } from 'node:fs'

const [input, out] = process.argv.slice(2)
const html = readFileSync(input, 'utf8')
const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]?.trim() ?? ''
const text = html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<(br|p|div|li|h[1-6]|pre|tr)[^>]*>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&#x27;|&#39;|&rsquo;/g, "'")
  .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
  .replace(/[ \t]+/g, ' ')
  .replace(/\n\s*\n+/g, '\n')
writeFileSync(out, `TITLE: ${title}\n\n${text}`)
console.log(out, '|', title, '|', text.length)
