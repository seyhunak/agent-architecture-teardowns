#!/usr/bin/env node
// Renders content/blog/diagrams/<slug>.json into public/blog/diagrams/<slug>.svg:
// the manual process today (left) beside the agent workflow (right).
// Usage: node scripts/render-diagrams.mjs   (re-run after editing a spec)
import fs from "node:fs"
import path from "node:path"

const SRC = "diagrams"
const OUT = "diagrams"
const C = { bg: "#06050f", card: "#0d0b1c", ink: "#f2f0fa", ink2: "#c9c5dc", muted: "#8e89a8", line: "#2b2745", brass: "#ffa54b" }
const W = 1200, COL = 520, LX = 40, RX = 640, BOX_H = 76, GAP = 26, TOP = 132

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
function wrap(text, max) {
  const lines = []; let cur = ""
  for (const w of String(text).split(/\s+/)) {
    if ((cur + " " + w).trim().length > max) { lines.push(cur.trim()); cur = w } else cur += " " + w
  }
  if (cur.trim()) lines.push(cur.trim())
  return lines.slice(0, 2).map((l, i, a) => (i === 1 && lines.length > 2 ? l.replace(/.{1}$/, "…") : l))
}

function box(x, y, step, side) {
  const human = step.kind === "human", system = step.kind === "system"
  const stroke = human ? C.brass : C.line
  const dash = system ? ' stroke-dasharray="5 4"' : ""
  const head = side === "before" ? step.actor : step.agent
  const right = side === "before" ? (step.minutes != null ? `${step.minutes} min` : "") : (step.model ?? (human ? "human" : ""))
  const lines = wrap(step.task, 62)
  return `
  <g>
    <rect x="${x}" y="${y}" width="${COL}" height="${BOX_H}" rx="10" fill="${C.card}" stroke="${stroke}" stroke-width="${human ? 1.5 : 1}"${dash}/>
    <text x="${x + 16}" y="${y + 24}" font-family="ui-sans-serif, -apple-system, Segoe UI, Helvetica, Arial, sans-serif" font-size="15" font-weight="600" fill="${C.ink}">${esc(head)}</text>
    <text x="${x + COL - 16}" y="${y + 24}" text-anchor="end" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="12" fill="${human ? C.brass : C.muted}">${esc(right)}</text>
    ${lines.map((l, i) => `<text x="${x + 16}" y="${y + 46 + i * 18}" font-family="ui-sans-serif, -apple-system, Segoe UI, Helvetica, Arial, sans-serif" font-size="13" fill="${C.ink2}">${esc(l)}</text>`).join("")}
  </g>`
}
const arrow = (x, y) => `<path d="M${x} ${y + 4} V${y + GAP - 6}" stroke="${C.muted}" stroke-width="1.2"/><path d="M${x - 4} ${y + GAP - 10} L${x} ${y + GAP - 4} L${x + 4} ${y + GAP - 10}" fill="none" stroke="${C.muted}" stroke-width="1.2"/>`

function render(spec) {
  const n = Math.max(spec.before.steps.length, spec.after.steps.length)
  const H = TOP + n * (BOX_H + GAP) + 96
  const col = (side, x) => spec[side].steps.map((s, i) => {
    const y = TOP + i * (BOX_H + GAP)
    return box(x, y, s, side) + (i < spec[side].steps.length - 1 ? arrow(x + COL / 2, y + BOX_H) : "")
  }).join("")
  const foot = (side, x) => {
    const y = TOP + spec[side].steps.length * (BOX_H + GAP) + 6
    return `<text x="${x}" y="${y + 20}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="14" fill="${side === "after" ? C.brass : C.ink}">${esc(spec[side].total)}</text>`
  }
  const head = (side, x) => `<text x="${x}" y="${TOP - 22}" font-family="Instrument Serif, Georgia, 'Times New Roman', serif" font-size="26" fill="${C.ink}">${esc(spec[side].label)}</text>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">
  <title id="t">${esc(spec.title)}</title>
  <desc id="d">${esc(`Left: ${spec.before.label}, ${spec.before.steps.length} manual steps, ${spec.before.total}. Right: ${spec.after.label}, ${spec.after.steps.length} steps, ${spec.after.total}.`)}</desc>
  <rect width="${W}" height="${H}" fill="${C.bg}"/>
  <text x="${LX}" y="52" font-family="Instrument Serif, Georgia, 'Times New Roman', serif" font-size="32" fill="${C.ink}">${esc(spec.title)}</text>
  <line x1="${W / 2}" y1="${TOP - 50}" x2="${W / 2}" y2="${H - 40}" stroke="${C.line}"/>
  ${head("before", LX)}${head("after", RX)}
  ${col("before", LX)}${col("after", RX)}
  ${foot("before", LX)}${foot("after", RX)}
  <text x="${W - 40}" y="${H - 16}" text-anchor="end" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11" fill="${C.muted}">brass outline = human checkpoint · dashed = deterministic code · seyhunakyurek.com</text>
</svg>
`
}

fs.mkdirSync(OUT, { recursive: true })
const files = fs.existsSync(SRC) ? fs.readdirSync(SRC).filter((f) => f.endsWith(".json")) : []
for (const f of files) {
  const spec = JSON.parse(fs.readFileSync(path.join(SRC, f), "utf8"))
  for (const side of ["before", "after"]) if (!spec[side]?.steps?.length) throw new Error(`${f}: ${side}.steps is empty`)
  fs.writeFileSync(path.join(OUT, f.replace(/\.json$/, ".svg")), render(spec))
  console.log(`rendered ${f}`)
}
