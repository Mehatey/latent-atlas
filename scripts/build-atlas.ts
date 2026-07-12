/**
 * build-atlas.ts — the data pipeline.
 *
 * 1. Pull a varied set of real artworks from the Met Museum Open Access API (no key).
 * 2. Keep only objects that actually carry a thumbnail.
 * 3. Embed each artwork's image with CLIP (Xenova/clip-vit-base-patch32) — the SAME
 *    vector space CLIP uses for text, which is what makes the in-browser text search work.
 * 4. Project the 512-d embeddings down to 3D with UMAP so similar art sits near each other.
 * 5. Pack the thumbnails into one texture atlas and write everything the front end needs.
 *
 * Output (public/data/):
 *   atlas.json        metadata + 3D positions + atlas cell per artwork + atlas dims
 *   embeddings.bin    Float32 [N x 512], L2-normalised — for browser cosine search
 *   atlas.png         the thumbnail texture atlas
 */

import { AutoProcessor, CLIPVisionModelWithProjection, RawImage, env } from "@huggingface/transformers";
import { UMAP } from "umap-js";
import sharp from "sharp";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

// ---- config -------------------------------------------------------------
const TARGET = Number(process.env.N ?? 1500);     // how many artworks in the galaxy
const TILE = 64;                                   // atlas cell size in px
const MET = "https://collectionapi.metmuseum.org/public/collection/v1";
const OUT = path.resolve("public/data");
const THUMBS = path.join(OUT, "thumbs");
const FETCH_CONCURRENCY = 8; // for thumbnail downloads only (the image CDN tolerates concurrency)

// Broad, varied queries so the collection is visually diverse (and clusters mean something).
const QUERIES = [
  "landscape", "portrait", "abstract", "sculpture", "flowers", "ocean",
  "animals", "architecture", "mythology", "still life", "textile", "ceramic",
  "drawing", "armor", "gold", "mask", "river", "night", "garden", "horse",
];

// ---- tiny helpers -------------------------------------------------------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const UA = "latent-atlas/0.1 (portfolio research project; contact mehts818@newschool.edu)";

async function getJSON(url: string, tries = 5): Promise<any> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        signal: AbortSignal.timeout(15000), // Node fetch has no default timeout; a hung WAF connection would block forever
      });
      // 403/429/5xx from the Met's WAF are usually transient burst throttling — back off and retry
      if (r.status === 403 || r.status === 429 || r.status >= 500) {
        await sleep(800 * (i + 1) * (i + 1));
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(500 * (i + 1));
    }
  }
  throw new Error(`giving up after ${tries} tries: ${url}`);
}

// The Met's API WAF 403s ANY concurrent burst (verified), so every API call is funneled
// through a single serialized queue with a minimum gap. The image CDN is a different host
// and tolerates concurrency, so thumbnail downloads bypass this.
let metChain: Promise<any> = Promise.resolve();
let lastMet = 0;
const MET_GAP = 20; // ms between API calls — sequential is what the WAF wants; the gap is just safety
function metGet(url: string): Promise<any> {
  const run = metChain.then(async () => {
    const wait = MET_GAP - (Date.now() - lastMet);
    if (wait > 0) await sleep(wait);
    lastMet = Date.now();
    return getJSON(url);
  });
  metChain = run.catch(() => {});
  return run;
}

async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (idx < items.length) {
        const cur = idx++;
        out[cur] = await fn(items[cur], cur);
      }
    })
  );
  return out;
}

type Art = {
  id: number; title: string; artist: string; date: string; medium: string;
  culture: string; classification: string; department: string;
  image: string;          // Met CDN url (loaded on demand in the detail card)
  tags: string[];
};

// ---- 1. gather candidate object IDs ------------------------------------
async function gatherIds(): Promise<number[]> {
  const seen = new Set<number>();
  const buckets: number[][] = [];
  for (const q of QUERIES) {
    const d = await metGet(`${MET}/search?hasImages=true&q=${encodeURIComponent(q)}`).catch(() => null);
    buckets.push((d?.objectIDs ?? []).slice(0, 600));
  }
  // interleave the query buckets so the final set stays varied even if we stop early
  const order: number[] = [];
  for (let i = 0; ; i++) {
    let added = false;
    for (const b of buckets) if (b[i] !== undefined) { order.push(b[i]); added = true; }
    if (!added) break;
  }
  const ids: number[] = [];
  for (const id of order) if (!seen.has(id)) { seen.add(id); ids.push(id); }
  return ids;
}

// ---- 2. fetch object details, keep ones with a real thumbnail ----------
async function collectArtworks(ids: number[]): Promise<Art[]> {
  const kept: Art[] = [];
  // sequential, paced — the API WAF won't tolerate concurrency
  for (let i = 0; i < ids.length && kept.length < TARGET; i++) {
    const o = await metGet(`${MET}/objects/${ids[i]}`).catch(() => null);
    const img = o?.primaryImageSmall;
    if (o && img) {
      kept.push({
        id: o.objectID,
        title: o.title || "Untitled",
        artist: o.artistDisplayName || "Unknown",
        date: o.objectDate || "",
        medium: o.medium || "",
        culture: o.culture || o.country || "",
        classification: o.classification || "",
        department: o.department || "",
        image: img,
        tags: (o.tags || []).map((t: any) => t.term).slice(0, 8),
      });
    }
    if (i % 20 === 0) process.stdout.write(`\r  collected ${kept.length}/${TARGET} (scanned ${i + 1} ids)   `);
  }
  process.stdout.write(`\r  collected ${kept.length}/${TARGET}                         \n`);
  return kept;
}

// ---- 3. download thumbnails --------------------------------------------
async function downloadThumbs(art: Art[]): Promise<(string | null)[]> {
  return pool(art, FETCH_CONCURRENCY, async (a, i) => {
    const file = path.join(THUMBS, `${i}.jpg`);
    try {
      const r = await fetch(a.image, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      await writeFile(file, buf);
      if (i % 100 === 0) process.stdout.write(`\r  downloaded ${i}/${art.length}   `);
      return file;
    } catch {
      return null;
    }
  });
}

// ---- 4. CLIP image embeddings ------------------------------------------
async function embedImages(files: (string | null)[]): Promise<Float32Array[]> {
  env.allowLocalModels = false;            // pull weights from the HF hub
  const model = "Xenova/clip-vit-base-patch32";
  console.log("  loading CLIP vision model…");
  const processor = await AutoProcessor.from_pretrained(model);
  const vision = await CLIPVisionModelWithProjection.from_pretrained(model, { dtype: "fp32" });

  const out: Float32Array[] = new Array(files.length);
  const BATCH = 16;
  for (let i = 0; i < files.length; i += BATCH) {
    const idxs: number[] = [];
    const imgs: RawImage[] = [];
    for (let j = i; j < Math.min(i + BATCH, files.length); j++) {
      const f = files[j];
      if (!f) { out[j] = new Float32Array(512); continue; }
      try { imgs.push(await RawImage.read(f)); idxs.push(j); }
      catch { out[j] = new Float32Array(512); }
    }
    if (imgs.length) {
      const inputs = await processor(imgs);
      const { image_embeds } = await vision(inputs);
      const data = image_embeds.data as Float32Array;
      const dim = image_embeds.dims[1];
      for (let k = 0; k < idxs.length; k++) {
        const v = data.slice(k * dim, (k + 1) * dim);
        out[idxs[k]] = l2norm(v);
      }
    }
    process.stdout.write(`\r  embedded ${Math.min(i + BATCH, files.length)}/${files.length}   `);
  }
  process.stdout.write("\n");
  return out;
}

function l2norm(v: Float32Array): Float32Array {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  s = Math.sqrt(s) || 1;
  const o = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) o[i] = v[i] / s;
  return o;
}

// ---- 5. UMAP to 3D ------------------------------------------------------
function project3d(embs: Float32Array[]): number[][] {
  console.log("  running UMAP → 3D…");
  const umap = new UMAP({ nComponents: 3, nNeighbors: 15, minDist: 0.1 });
  const coords = umap.fit(embs.map((e) => Array.from(e)));
  // center + scale to a comfortable viewing volume
  const mins = [Infinity, Infinity, Infinity], maxs = [-Infinity, -Infinity, -Infinity];
  for (const c of coords) for (let d = 0; d < 3; d++) { mins[d] = Math.min(mins[d], c[d]); maxs[d] = Math.max(maxs[d], c[d]); }
  const span = Math.max(maxs[0] - mins[0], maxs[1] - mins[1], maxs[2] - mins[2]) || 1;
  const SCALE = 120;
  return coords.map((c) => c.map((v, d) => ((v - (mins[d] + maxs[d]) / 2) / span) * SCALE));
}

// ---- 6. build the texture atlas ----------------------------------------
async function buildAtlas(files: (string | null)[]): Promise<{ cols: number; size: number }> {
  const n = files.length;
  const cols = Math.ceil(Math.sqrt(n));
  const size = cols * TILE;
  console.log(`  packing ${n} thumbnails into a ${size}×${size} atlas…`);
  const tiles = await Promise.all(
    files.map(async (f, i) => {
      const left = (i % cols) * TILE;
      const top = Math.floor(i / cols) * TILE;
      if (!f) return null;
      try {
        const buf = await sharp(f).resize(TILE, TILE, { fit: "cover" }).removeAlpha().toBuffer();
        return { input: buf, left, top };
      } catch { return null; }
    })
  );
  await sharp({ create: { width: size, height: size, channels: 3, background: { r: 8, g: 8, b: 10 } } })
    .composite(tiles.filter(Boolean) as sharp.OverlayOptions[])
    .png()
    .toFile(path.join(OUT, "atlas.png"));
  return { cols, size };
}

// ---- main ---------------------------------------------------------------
async function main() {
  console.time("pipeline");
  if (existsSync(THUMBS)) await rm(THUMBS, { recursive: true, force: true });
  await mkdir(THUMBS, { recursive: true });

  console.log("① gathering object ids from the Met…");
  const ids = await gatherIds();
  console.log(`  ${ids.length} candidate ids`);

  console.log("② fetching object details…");
  const art = await collectArtworks(ids);

  console.log("③ downloading thumbnails…");
  const files = await downloadThumbs(art);

  console.log("④ embedding with CLIP…");
  const embs = await embedImages(files);

  console.log("⑤ projecting to 3D…");
  const coords = project3d(embs);

  console.log("⑥ building texture atlas…");
  const { cols } = await buildAtlas(files);

  // write embeddings.bin (Float32 N x 512)
  const dim = 512;
  const flat = new Float32Array(art.length * dim);
  embs.forEach((e, i) => flat.set(e, i * dim));
  await writeFile(path.join(OUT, "embeddings.bin"), Buffer.from(flat.buffer));

  // write atlas.json
  const points = art.map((a, i) => ({
    ...a,
    pos: coords[i].map((v) => Math.round(v * 1000) / 1000),
    cell: i, // atlas cell index == array index
  }));
  await writeFile(
    path.join(OUT, "atlas.json"),
    JSON.stringify({ count: art.length, dim, atlas: { cols, tile: TILE }, points }, null, 0)
  );

  console.log(`\n✓ wrote ${art.length} artworks → public/data/{atlas.json, embeddings.bin, atlas.png}`);
  console.timeEnd("pipeline");
}

main().catch((e) => { console.error(e); process.exit(1); });
