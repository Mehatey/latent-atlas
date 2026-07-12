/**
 * server/index.ts — a thin Fastify backend.
 *
 * The experience runs fully client-side, but a real product wants a server: this one
 * serves the built front end and exposes the same semantic search as a JSON API
 * (/api/nearest?q=...), running CLIP's text encoder in Node. It demonstrates the
 * full-stack shape — Vite front end + a typed Node service over the same model.
 *
 *   npm run build && npm run server   →   http://localhost:8080
 */
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { AutoTokenizer, CLIPTextModelWithProjection, env } from "@huggingface/transformers";

env.allowLocalModels = false;

const ROOT = path.resolve(".");
const DATA = path.join(ROOT, "public/data");
const DIST = path.join(ROOT, "dist");
// Keep the server aligned with Vite's public base. The production build is designed
// for GitHub Pages at /ai-prototypes/latent-atlas/, not the domain root.
const BASE_PATH = "/ai-prototypes/latent-atlas/";

// --- load the atlas + embeddings once at boot -----------------------------
type Atlas = { count: number; dim: number; points: any[] };
let atlas: Atlas;
let embeddings: Float32Array;

async function loadData() {
  atlas = JSON.parse(await readFile(path.join(DATA, "atlas.json"), "utf8"));
  const buf = await readFile(path.join(DATA, "embeddings.bin"));
  embeddings = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  console.log(`loaded ${atlas.count} artworks (${atlas.dim}-d embeddings)`);
}

// --- CLIP text encoder (lazy) ---------------------------------------------
let tokenizer: any, model: any;
async function clip() {
  if (!model) {
    const id = "Xenova/clip-vit-base-patch32";
    tokenizer = await AutoTokenizer.from_pretrained(id);
    model = await CLIPTextModelWithProjection.from_pretrained(id, { dtype: "fp32" });
  }
  return { tokenizer, model };
}

async function embedText(text: string): Promise<Float32Array> {
  const { tokenizer, model } = await clip();
  const { text_embeds } = await model(tokenizer([text], { padding: true, truncation: true }));
  const v = text_embeds.data as Float32Array;
  let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  s = Math.sqrt(s) || 1;
  return v.map((x: number) => x / s) as Float32Array;
}

// --- description cache + AI describe endpoint ----------------------------
const CACHE_PATH = path.join(ROOT, "server/desc-cache.json");
let descCache: Record<number, string> = {};
try {
  if (existsSync(CACHE_PATH)) descCache = JSON.parse(await readFile(CACHE_PATH, "utf8"));
} catch {}
async function saveDescCache() {
  await writeFile(CACHE_PATH, JSON.stringify(descCache, null, 2));
}

// --- server ----------------------------------------------------------------
async function main() {
  await loadData();
  const app = Fastify({ logger: false });

  // Serve the exact Vite output at its configured public base. `dist` already
  // contains the generated data, so all links work under the same base path.
  await app.register(fastifyStatic, { root: DIST, prefix: BASE_PATH, decorateReply: false });
  app.get("/", async (_req, reply) => reply.redirect(BASE_PATH));

  // semantic search over the collection
  app.get("/api/nearest", async (req, reply) => {
    const q = String((req.query as any).q ?? "").trim();
    const requestedK = Number((req.query as any).k ?? 12);
    const k = Number.isFinite(requestedK) ? Math.max(1, Math.min(Math.floor(requestedK), 60)) : 12;
    if (!q) return reply.code(400).send({ error: "missing ?q=" });

    const qv = await embedText(q);
    const { count, dim } = atlas;
    const scored: { i: number; score: number }[] = [];
    for (let i = 0; i < count; i++) {
      let s = 0; const off = i * dim;
      for (let d = 0; d < dim; d++) s += qv[d] * embeddings[off + d];
      scored.push({ i, score: s });
    }
    scored.sort((a, b) => b.score - a.score);
    return {
      query: q,
      results: scored.slice(0, k).map(({ i, score }) => {
        const p = atlas.points[i];
        return {
          score: Math.round(score * 1000) / 1000,
          id: p.id, title: p.title, artist: p.artist, date: p.date,
          image: p.image, met: `https://www.metmuseum.org/art/collection/search/${p.id}`,
        };
      }),
    };
  });

  // artwork description: curator label text → Claude Haiku fallback
  app.get("/api/describe/:id", async (req, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    const id = Number((req.params as any).id);
    if (!Number.isFinite(id)) return reply.code(400).send({ error: "bad id" });

    if (descCache[id] !== undefined) return reply.send({ description: descCache[id] });

    // fetch Met API for extra metadata (free, CORS-open)
    let met: any = {};
    try {
      const r = await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`);
      if (r.ok) met = await r.json();
    } catch {}

    // prefer curator gallery label if the Met has one
    if (met.labelText?.trim()) {
      const raw = met.labelText.trim();
      // take up to 2 sentences
      const sentences = raw.match(/[^.!?]+[.!?]+/g) ?? [raw];
      const desc = sentences.slice(0, 2).join(" ").trim();
      descCache[id] = desc;
      await saveDescCache();
      return reply.send({ description: desc });
    }

    // fall back to Claude Haiku
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { descCache[id] = ""; return reply.send({ description: "" }); }

    const parts: string[] = [
      met.title, met.artistDisplayName, met.objectDate, met.medium,
      met.period, met.dynasty, met.reign, met.artistDisplayBio,
      met.dimensions,
      [met.geographyType, met.city, met.country, met.region].filter(Boolean).join(" ") || null,
    ].filter(Boolean) as string[];

    try {
      const cr = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 120,
          messages: [{
            role: "user",
            content: `Write 1 to 2 sentences describing this artwork for a gallery visitor. Be evocative and specific, not generic. Metadata: ${parts.join("; ")}. Reply with just the sentences, nothing else.`,
          }],
        }),
      });
      const cd = await cr.json() as any;
      const desc = cd.content?.[0]?.text?.trim() ?? "";
      descCache[id] = desc;
      await saveDescCache();
      return reply.send({ description: desc });
    } catch {
      descCache[id] = "";
      return reply.send({ description: "" });
    }
  });

  const port = Number(process.env.PORT ?? 8080);
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`latent-atlas → http://localhost:${port}${BASE_PATH}  ·  try /api/nearest?q=storms+at+sea`);
}

main().catch((e) => { console.error(e); process.exit(1); });
