import { getStore } from "@netlify/blobs"
import type { Config } from "@netlify/functions"

// Posições do "Pedalar em grupo".
// Cada pessoa grava só a própria posição, numa chave derivada do código do grupo
// e de um identificador secreto do aparelho. Ninguém lê o código nem o identificador
// de volta, apenas versões embaralhadas (hash). Posições somem da lista após 90 s
// sem atualização e são apagadas de vez após 10 min.

const SHOW_MS = 90_000
const PURGE_MS = 600_000
const MAX_MEMBERS = 40

const store = () => getStore({ name: "grupo-posicoes", consistency: "strong" })

async function hash(text: string, len = 32) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, len)
}

const num = (v: unknown, lo: number, hi: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null

type Pos = { name: string; lat: number; lng: number; h: number | null; v: number | null; t: number }

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } })

export default async (req: Request) => {
  let b: any
  try { b = await req.json() } catch { return json({ error: "Pedido inválido." }, 400) }

  const code = typeof b?.group === "string" ? b.group.trim().toLowerCase() : ""
  const secret = typeof b?.id === "string" && /^[A-Za-z0-9-]{16,64}$/.test(b.id) ? b.id : null
  if (code.length < 4 || code.length > 40 || !secret) return json({ error: "Código do grupo ou identificador inválido." }, 400)

  const g = await hash("cyclemap-grupo:" + code)
  const me = await hash("cyclemap-membro:" + secret, 24)
  const key = `${g}/${me}`
  const s = store()

  if (b.off) {
    await s.delete(key)
    return json({ ok: true })
  }

  const lat = num(b.lat, -90, 90), lng = num(b.lng, -180, 180)
  if (lat == null || lng == null) return json({ error: "Posição inválida." }, 400)
  const name = String(b.name ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 24) || "Ciclista"
  const now = Date.now()

  const pos: Pos = { name, lat, lng, h: num(b.h, 0, 360), v: num(b.v, 0, 150), t: now }
  await s.setJSON(key, pos)

  const { blobs } = await s.list({ prefix: g + "/" })
  const others: Array<Record<string, unknown>> = []
  await Promise.all(blobs.slice(0, MAX_MEMBERS).map(async ({ key: k }) => {
    if (k === key) return
    const p = (await s.get(k, { type: "json" }).catch(() => null)) as Pos | null
    if (!p || typeof p.t !== "number") return
    const age = now - p.t
    if (age > PURGE_MS) { await s.delete(k).catch(() => {}); return }
    if (age > SHOW_MS) return
    others.push({ id: k.slice(g.length + 1), name: p.name, lat: p.lat, lng: p.lng, h: p.h, v: p.v, age: Math.max(0, Math.round(age / 1000)) })
  }))

  others.sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR"))
  return json({ others })
}

export const config: Config = { path: "/api/grupo", method: "POST" }
