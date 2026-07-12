/**
 * clip.ts — runs CLIP's *text* encoder live in the browser via transformers.js.
 *
 * The pipeline embedded every artwork's image with CLIP. Because CLIP puts images and
 * text in the same 512-d space, we can embed a typed phrase here, in the browser, and
 * compare it directly against those image vectors — that's the cross-modal search.
 *
 * Prefers the WebGPU execution provider; falls back to WASM automatically.
 */
import { AutoTokenizer, CLIPTextModelWithProjection, env } from "@huggingface/transformers";

env.allowLocalModels = false;
env.allowRemoteModels = true;

const MODEL = "Xenova/clip-vit-base-patch32";

let tokenizer: any = null;
let model: any = null;
let device: "webgpu" | "wasm" = "wasm";
let loading: Promise<void> | null = null;

export function clipDevice() { return device; }

export function loadCLIP(onStatus: (s: string) => void): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    // surface real download progress per weight file (first load fetches ~250MB)
    const pct: Record<string, number> = {};
    const progress_callback = (p: any) => {
      if (p.status === "progress" && p.file) {
        pct[p.file] = p.progress ?? 0;
        const avg = Object.values(pct).reduce((a, b) => a + b, 0) / Object.values(pct).length;
        onStatus(`preparing search… ${Math.round(avg)}%`);
      }
    };
    onStatus("preparing search…");
    tokenizer = await AutoTokenizer.from_pretrained(MODEL, { progress_callback });
    const hasWebGPU = "gpu" in navigator;
    try {
      model = await CLIPTextModelWithProjection.from_pretrained(MODEL, {
        device: hasWebGPU ? "webgpu" : "wasm",
        dtype: hasWebGPU ? "fp32" : "q8",
        progress_callback,
      });
      device = hasWebGPU ? "webgpu" : "wasm";
    } catch {
      model = await CLIPTextModelWithProjection.from_pretrained(MODEL, { device: "wasm", dtype: "q8", progress_callback });
      device = "wasm";
    }
    onStatus(""); // ready — no dev readout in the UI
  })();
  return loading;
}

export async function embedText(text: string): Promise<Float32Array> {
  if (!model) throw new Error("CLIP not loaded");
  const inputs = tokenizer([text], { padding: true, truncation: true });
  const { text_embeds } = await model(inputs);
  const v = text_embeds.data as Float32Array;
  // L2-normalise so a dot product == cosine similarity
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  s = Math.sqrt(s) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / s;
  return out;
}
