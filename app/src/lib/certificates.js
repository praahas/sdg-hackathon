// Builds certificate PDFs in the browser (A4 landscape, one page per member).
// Content comes from issued certificate rows, so a certificate always matches its
// verification record. Fonts are the PDF standard fonts (Times, Helvetica).
import { jsPDF } from 'jspdf'

const W = 297, H = 210
const NAVY = [22, 50, 63], TEAL = [15, 122, 110], GOLD = [176, 132, 32], GREY = [94, 111, 117], INK = [33, 41, 45]
const SDG_STRIP = ['#E5243B', '#DDA63A', '#4C9F38', '#C5192D', '#FF3A21', '#26BDE2', '#FCC30B', '#A21942', '#FD6925',
  '#DD1367', '#FD9D24', '#BF8B2E', '#3F7E44', '#0A97D9', '#56C02B', '#00689D', '#19486A']

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const longDate = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '')
const titleCase = (s) => (s || '').replace(/\b([a-z])/g, (m) => m.toUpperCase())

// Characters outside the PDF standard fonts' range are replaced so nothing prints as garbage.
const clean = (s) => String(s ?? '')
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, ' - ')
  .replace(/…/g, '...').replace(/[^\x20-\x7E -ÿ]/g, '').replace(/\s+/g, ' ').trim()

export const verifyUrl = (code) => `${window.location.origin}${window.location.pathname}#/verify/${code}`

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ src, w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = src
  })
}

// Centered rich text: segments [{ text, bold }] wrapped to maxW, drawn line by line.
function richCentered(doc, segments, cx, y, maxW, { size = 12.5, lead = 6.4, font = 'helvetica', color = INK } = {}) {
  const words = []
  for (const s of segments) {
    if (s.nowrap) words.push({ w: clean(s.text), bold: !!s.bold })          // kept on one line, e.g. a date
    else clean(s.text).split(' ').filter(Boolean).forEach((w) => words.push({ w, bold: !!s.bold }))
  }
  const width = (t, bold) => { doc.setFont(font, bold ? 'bold' : 'normal'); doc.setFontSize(size); return doc.getTextWidth(t) }
  const space = width(' ', false)
  const lines = []; let line = []; let lw = 0
  for (const wd of words) {
    const ww = width(wd.w, wd.bold)
    if (line.length && lw + space + ww > maxW) { lines.push({ line, lw }); line = []; lw = 0 }
    lw += (line.length ? space : 0) + ww; line.push({ ...wd, ww })
  }
  if (line.length) lines.push({ line, lw })
  doc.setTextColor(...color)
  lines.forEach(({ line: ln, lw: total }, i) => {
    let x = cx - total / 2
    ln.forEach((wd, j) => {
      doc.setFont(font, wd.bold ? 'bold' : 'normal'); doc.setFontSize(size)
      doc.text(wd.w, x, y + i * lead)
      x += wd.ww + (j < ln.length - 1 ? space : 0)
    })
  })
  return y + lines.length * lead
}

// Fit text into at most `maxLines` lines, ending with "..." if it had to be cut.
function fitLines(doc, text, maxW, maxLines) {
  const lines = doc.splitTextToSize(clean(text), maxW)
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  let last = kept[maxLines - 1]
  while (last.length && doc.getTextWidth(`${last}...`) > maxW) last = last.replace(/\s*\S+$/, '')
  kept[maxLines - 1] = `${last}...`
  return kept
}

async function drawCertificate(doc, c, ctx) {
  const { settings: s, roundName, sdgById, signatories } = ctx
  const winner = c.kind === 'winner'
  const accent = winner ? GOLD : TEAL

  // Frame
  doc.setFillColor(255, 255, 255); doc.rect(0, 0, W, H, 'F')
  doc.setDrawColor(...NAVY); doc.setLineWidth(1.4); doc.rect(8, 8, W - 16, H - 16)
  doc.setDrawColor(...accent); doc.setLineWidth(0.4); doc.rect(11, 11, W - 22, H - 22)
  // SDG colour strip
  const sw = (W - 22) / 17
  SDG_STRIP.forEach((col, i) => { doc.setFillColor(...hex(col)); doc.rect(11 + i * sw, 11, sw + 0.05, 2.6, 'F') })

  // Logos: top-left and top-right; a corner without a logo stays blank.
  for (const [logo, left] of [[ctx.logos.left, true], [ctx.logos.right, false]]) {
    if (!logo) continue
    const maxW = 34, maxH = 26
    const r = Math.min(maxW / logo.w, maxH / logo.h)
    const lw = logo.w * r, lh = logo.h * r
    const x = left ? 20 : W - 20 - lw
    try { doc.addImage(logo.src, logo.src.startsWith('data:image/png') ? 'PNG' : 'JPEG', x, 18 + (maxH - lh) / 2, lw, lh) } catch { /* unreadable image: leave blank */ }
  }

  const cx = W / 2
  doc.setTextColor(...NAVY); doc.setFont('times', 'bold'); doc.setFontSize(20)
  doc.text(clean(s.institution), cx, 27, { align: 'center' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11.5); doc.setTextColor(...GREY)
  doc.text(clean(`Department of ${s.department}`), cx, 34, { align: 'center' })
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...TEAL)
  doc.text(clean(s.title).toUpperCase(), cx, 43, { align: 'center', charSpace: 0.6 })

  doc.setFont('times', 'bold'); doc.setFontSize(29); doc.setTextColor(...NAVY)
  doc.text(winner ? 'CERTIFICATE OF ACHIEVEMENT' : 'CERTIFICATE OF PARTICIPATION', cx, 58, { align: 'center', charSpace: 0.5 })
  if (winner && c.place) {
    const label = titleCase(clean(c.place))
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
    const bw = doc.getTextWidth(label) + 14
    doc.setFillColor(...GOLD); doc.roundedRect(cx - bw / 2, 62.5, bw, 8.5, 4.2, 4.2, 'F')
    doc.setTextColor(255, 255, 255); doc.text(label, cx, 68.4, { align: 'center' })
  }

  let y = winner ? 82 : 75
  doc.setFont('times', 'italic'); doc.setFontSize(13); doc.setTextColor(...GREY)
  doc.text('This is to certify that', cx, y, { align: 'center' })
  y += 13
  doc.setFont('times', 'bold'); doc.setFontSize(28); doc.setTextColor(...INK)
  const name = clean(c.member_name)
  doc.text(name, cx, y, { align: 'center' })
  const nw = Math.max(90, doc.getTextWidth(name) + 20)
  doc.setDrawColor(...accent); doc.setLineWidth(0.5); doc.line(cx - nw / 2, y + 3, cx + nw / 2, y + 3)
  if (c.usn) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...GREY)
    doc.text(`USN ${clean(c.usn)}`, cx, y + 8.5, { align: 'center' })
  }
  y += c.usn ? 17 : 13

  const team = [{ text: 'of team' }, { text: `${c.team_code ? `${c.team_code} ` : ''}${c.team_name}`, bold: true }]
  const where = [{ text: 'in the' }, { text: roundName(c.event_id), bold: true }, { text: 'of' }, { text: s.title, bold: true },
    { text: `organised by the Department of ${s.department}, ${s.institution}, held on` }, { text: `${longDate(c.event_date)}.`, bold: true, nowrap: true }]
  const body = winner
    ? [...team, { text: 'has secured' }, { text: titleCase(clean(c.place)), bold: true, nowrap: true }, ...where]
    : [...team, { text: 'has participated' }, ...where]
  y = richCentered(doc, body, cx, y, 226)

  // Problem statement and SDGs
  if (c.problem) {
    y += 2.5
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...GREY)
    doc.text('PROBLEM STATEMENT', cx, y, { align: 'center', charSpace: 0.5 })
    doc.setFont('times', 'italic'); doc.setFontSize(12.5); doc.setTextColor(...INK)
    const lines = fitLines(doc, `"${c.problem}"`, 210, 2)
    lines.forEach((ln, i) => doc.text(ln, cx, y + 5.8 + i * 5.6, { align: 'center' }))
    y += 5.8 + lines.length * 5.6
  }
  const sdgs = [c.primary_sdg, c.secondary_sdg].filter((v, i, a) => v && a.indexOf(v) === i).map((id) => sdgById[id]).filter(Boolean)
  if (sdgs.length) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5)
    const items = sdgs.map((g) => ({ g, label: clean(`SDG ${g.id}: ${g.name}`) }))
    const total = items.reduce((a, it) => a + 5 + doc.getTextWidth(it.label), 0) + (items.length - 1) * 8
    let x = cx - total / 2
    const yy = y + 2.5
    items.forEach((it) => {
      doc.setFillColor(...hex(it.g.color)); doc.rect(x, yy - 3, 3.4, 3.4, 'F')
      doc.setTextColor(...INK); doc.text(it.label, x + 5, yy)
      x += 5 + doc.getTextWidth(it.label) + 8
    })
  }

  // Signatories
  const sigs = signatories.slice(0, 3)
  if (sigs.length) {
    const slot = Math.min(80, (W - 90) / sigs.length)
    const start = cx - (slot * sigs.length) / 2
    const lineY = 176
    sigs.forEach((sg, i) => {
      const sx = start + slot * i + slot / 2
      if (sg.img) {
        const maxW = 52, maxH = 18
        const r = Math.min(maxW / sg.img.w, maxH / sg.img.h)
        const iw = sg.img.w * r, ih = sg.img.h * r
        try { doc.addImage(sg.img.src, sg.img.src.startsWith('data:image/png') ? 'PNG' : 'JPEG', sx - iw / 2, lineY - 1.5 - ih, iw, ih) } catch { /* unreadable image: leave space */ }
      }
      doc.setDrawColor(...GREY); doc.setLineWidth(0.3); doc.line(sx - slot / 2 + 8, lineY, sx + slot / 2 - 8, lineY)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...INK)
      doc.text(clean(sg.name), sx, lineY + 5, { align: 'center' })
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...GREY)
      doc.splitTextToSize(clean(sg.designation), slot - 10).slice(0, 2).forEach((ln, k) => doc.text(ln, sx, lineY + 9.5 + k * 3.8, { align: 'center' }))
    })
  }

  // Certificate ID (can be checked at the site's #/verify page)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...GREY)
  doc.text(`Certificate ID: ${c.code}`, 18, H - 19)
  doc.text(`Issued ${longDate(String(c.issued_at).slice(0, 10))}`, 18, H - 15.5)
}

// certs: issued certificate rows. ctx: { settings, events, sdgById, signatories }
export async function buildCertificatesPdf(certs, ctx) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
  doc.setProperties({ title: clean(`${ctx.settings.title} certificates`), creator: 'SDG Hackathon evaluation' })
  const sigs = await Promise.all(ctx.signatories.filter((s) => s.active).sort((a, b) => a.sort - b.sort || a.id - b.id)
    .map(async (s) => ({ ...s, img: s.signature ? await loadImage(s.signature) : null })))
  const evName = Object.fromEntries(ctx.events.map((e) => [e.id, e.name]))
  const b = ctx.branding || {}
  const [left, right] = await Promise.all([b.logo_left ? loadImage(b.logo_left) : null, b.logo_right ? loadImage(b.logo_right) : null])
  const won = new Set(certs.filter((c) => c.kind === 'winner').map((c) => c.team_id))
  const sorted = [...certs].sort((a, b) => (won.has(b.team_id) - won.has(a.team_id))
    || (won.has(a.team_id) ? (a.rank ?? 999) - (b.rank ?? 999) : 0)
    || String(a.team_code).localeCompare(String(b.team_code), undefined, { numeric: true })
    || a.member_index - b.member_index || (a.kind === 'winner' ? -1 : b.kind === 'winner' ? 1 : 0))
  for (let i = 0; i < sorted.length; i++) {
    if (i) doc.addPage()
    await drawCertificate(doc, sorted[i], { ...ctx, signatories: sigs, logos: { left, right }, roundName: (id) => evName[id] || '' })
  }
  return doc
}

export async function downloadCertificates(certs, ctx, filename) {
  if (!certs.length) throw new Error('There are no certificates to download.')
  const doc = await buildCertificatesPdf(certs, ctx)
  doc.save(filename.replace(/[^\w.-]+/g, '_'))
}

// Logo upload: scale down only; colours and transparency are kept.
export function readLogo(file, max = 600) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return reject(new Error('Upload the logo as a PNG or JPG image.'))
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('That file is not a readable image.'))
      img.onload = () => {
        const r = Math.min(1, max / img.naturalWidth, max / img.naturalHeight)
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.naturalWidth * r); canvas.height = Math.round(img.naturalHeight * r)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(file.type === 'image/jpeg' ? canvas.toDataURL('image/jpeg', 0.92) : canvas.toDataURL('image/png'))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

// Signature upload: scale down and re-encode as PNG so it stays small in the database.
export function readSignature(file, maxW = 600, maxH = 220) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return reject(new Error('Upload a PNG or JPG image of the signature.'))
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('That file is not a readable image.'))
      img.onload = () => {
        const r = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight)
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.naturalWidth * r); canvas.height = Math.round(img.naturalHeight * r)
        const g = canvas.getContext('2d')
        g.drawImage(img, 0, 0, canvas.width, canvas.height)
        // Make near-white pixels transparent so the signature sits cleanly on the certificate.
        const px = g.getImageData(0, 0, canvas.width, canvas.height)
        for (let i = 0; i < px.data.length; i += 4) {
          const v = Math.min(px.data[i], px.data[i + 1], px.data[i + 2])
          if (v > 225) px.data[i + 3] = 0
          else if (v > 180) px.data[i + 3] = Math.round(px.data[i + 3] * (225 - v) / 45)
        }
        g.putImageData(px, 0, 0)
        resolve(canvas.toDataURL('image/png'))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}
