import type { Config } from "@netlify/functions"

// Busca pontos do OpenStreetMap (via Overpass) para o mapa.
// Só monta consultas fixas a partir de parâmetros validados; nunca repassa consultas livres.

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
]

const POI: Record<string, string> = {
  fuel: '["amenity"="fuel"]',
  bike: '["shop"="bicycle"]',
  repair: '["amenity"="bicycle_repair_station"]',
  water: '["amenity"="drinking_water"]',
  wc: '["amenity"="toilets"]',
}

const DISC = [
  'nwr["natural"="beach"]["name"]',
  'nwr["leisure"="park"]["name"]',
  'nwr["place"="square"]["name"]',
  'nwr["tourism"~"^(museum|gallery|viewpoint|attraction)$"]["name"]',
  'nwr["amenity"~"^(arts_centre|theatre)$"]["name"]',
  'nwr["natural"="spring"]["name"]',
  'nwr["waterway"="waterfall"]["name"]',
  'nwr["historic"="monument"]["name"]',
]

const n = (v: string | null, lo: number, hi: number) => {
  const x = v == null ? NaN : Number(v)
  return Number.isFinite(x) && x >= lo && x <= hi ? x : null
}

const err = (msg: string, status = 400) =>
  Response.json({ error: msg }, { status, headers: { "cache-control": "no-store" } })

async function ask(url: string, q: string, ms: number) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  try {
    const r = await fetch(url, {
      method: "POST",
      signal: ctl.signal,
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "Cyclemap/1.0 (mapa de ciclismo; netlify)" },
      body: "data=" + encodeURIComponent(q),
    })
    if (!r.ok) throw new Error("HTTP " + r.status)
    const j = await r.json()
    if (!Array.isArray(j.elements)) throw new Error("sem dados")
    return j.elements as any[]
  } finally {
    clearTimeout(timer)
  }
}

async function overpass(q: string) {
  // Consulta os servidores em paralelo e usa a primeira resposta válida (limite total ~20 s).
  return await Promise.any(ENDPOINTS.map(u => ask(u, q, 20000).catch(e => {
    console.log(`overpass falhou em ${u}: ${e?.name === "AbortError" ? "tempo esgotado" : e?.message || e}`)
    throw e
  })))
}

export default async (req: Request) => {
  const u = new URL(req.url)
  const kind = u.searchParams.get("kind")
  let q: string

  if (kind === "poi") {
    const s = n(u.searchParams.get("s"), -90, 90), w = n(u.searchParams.get("w"), -180, 180)
    const no = n(u.searchParams.get("n"), -90, 90), e = n(u.searchParams.get("e"), -180, 180)
    const cats = (u.searchParams.get("cats") || "").split(",").filter(c => c in POI)
    if (s == null || w == null || no == null || e == null || no <= s || e <= w || !cats.length) return err("Parâmetros inválidos.")
    if ((no - s) * (e - w) > 0.25) return err("Área grande demais. Aproxime o mapa.")
    const bb = [s, w, no, e].map(x => x.toFixed(3)).join(",")
    q = `[out:json][timeout:18];(${cats.map(c => `nwr${POI[c]}(${bb});`).join("")});out center tags 500;`
  } else if (kind === "disc") {
    const lat = n(u.searchParams.get("lat"), -90, 90), lng = n(u.searchParams.get("lng"), -180, 180)
    const r = n(u.searchParams.get("r"), 1, 60)
    if (lat == null || lng == null || r == null) return err("Parâmetros inválidos.")
    const a = `(around:${Math.round(r * 1000)},${lat.toFixed(3)},${lng.toFixed(3)})`
    q = `[out:json][timeout:18];(${DISC.map(x => x + a + ";").join("")});out center tags 800;`
  } else return err("Tipo de busca inválido.")

  try {
    const els = await overpass(q)
    // Só o necessário para o mapa
    const out = els.map(e => ({
      lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon,
      tags: Object.fromEntries(Object.entries(e.tags || {}).filter(([k]) =>
        /^(name|brand|opening_hours|amenity|shop|natural|leisure|place|tourism|historic|waterway)$/.test(k))),
    })).filter(e => typeof e.lat === "number" && typeof e.lon === "number")
    return Response.json({ elements: out }, {
      headers: { "cache-control": "public, max-age=600", "netlify-cdn-cache-control": "public, durable, max-age=86400, stale-while-revalidate=604800" },
    })
  } catch {
    return err("O serviço de mapas não respondeu. Tente de novo em instantes.", 502)
  }
}

export const config: Config = { path: "/api/osm", method: "GET" }
