import * as THREE from "three/webgpu";
import {
  texture, uv, attribute, float, vec2, vec3, vec4, mod, floor, uniform, mix, min, step, pass,
  positionGeometry, modelViewMatrix, cameraProjectionMatrix, positionView, smoothstep, screenUV,
  sin, length,
} from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { loadCLIP, embedText, clipDevice } from "./clip.ts";
import { resumeAudio, playClick, playHover, startAmbient, setSoundEnabled, soundEnabled } from "./sound.ts";

// ---- types --------------------------------------------------------------
type Point = {
  id: number; title: string; artist: string; date: string; medium: string;
  culture: string; classification: string; department: string;
  image: string; tags: string[]; pos: [number, number, number]; cell: number;
};
type Atlas = { count: number; dim: number; atlas: { cols: number; tile: number }; points: Point[] };

// strip HTML tags + decode the few entities the Met data uses
function clean(s: string): string {
  return (s || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#39;|&rsquo;|&apos;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/\s+/g, " ").trim();
}

// ---- dom ----------------------------------------------------------------
const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const canvas = $("#scene") as HTMLCanvasElement;
const loader = $("#loader"), loaderText = $("#loader-text");
const card = $("#card") as HTMLElement;
const cardTitle = $("#card-title"), cardArtist = $("#card-artist");
const cardDesc = $("#card-desc"), cardMeta = $("#card-meta"), cardLink = $("#card-link") as HTMLAnchorElement;
const cardSimilar = $("#card-similar") as HTMLButtonElement;
const form = $("#search") as HTMLFormElement, qInput = $("#q") as HTMLInputElement;
const goBtn = $("#go") as HTMLButtonElement, modelStatus = $("#model-status");
const results = $("#results"), legend = $("#legend"), resultCount = $("#result-count");
const navPrev = $("#nav-prev") as HTMLButtonElement, navNext = $("#nav-next") as HTMLButtonElement;
const arrival = $("#arrival") as HTMLElement;
const enterBtn = $("#enter") as HTMLButtonElement;
const promptButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-query]")];
const soundToggle = $("#sound-toggle") as HTMLButtonElement;
const shareView = $("#share-view") as HTMLButtonElement;
const guideToggle = $("#guide-toggle") as HTMLButtonElement;
const fieldGuide = $("#field-guide") as HTMLElement;
const guideClose = $("#guide-close") as HTMLButtonElement;
const cursorAura = $("#cursor-aura") as HTMLElement;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---- state --------------------------------------------------------------
let data: Atlas;
let embeddings: Float32Array;        // count × dim, L2-normalised
let positions: THREE.Vector3[] = [];
let scoreAttr: THREE.InstancedBufferAttribute;
let heroAttr: THREE.InstancedBufferAttribute;   // 1 = the focused work (shown big), 0 = a point
let pointCloud: THREE.Mesh;          // every work as a glowing dot, revealed on search
const HERO = 2.7;                    // focused work size on the map (multiples of uBase) — big enough to breathe, full detail in the card
let uSearch = uniform(0);
let uSearchTarget = 0;             // uSearch eases toward this for a smooth transition
let uBase = uniform(2.6);
let uTime = uniform(0);
let uFogNear = uniform(40);
let uFogFar = uniform(400);
const clock = new THREE.Clock();
let renderer: THREE.WebGPURenderer;
let post: any = null;              // bloom post-processing (falls back to plain render)
let camera: THREE.PerspectiveCamera;
let controls: OrbitControls;
let scene: THREE.Scene;
let mesh: THREE.Mesh;
let selector: THREE.Mesh;          // billboarded outline marking the hovered work
let focusRing: THREE.Mesh;         // warm ring pinning the prime match / clicked work
let hiddenAttr: THREE.InstancedBufferAttribute; // 1 = atlas tile suppressed (covered by hi-res)
let sceneCenter = new THREE.Vector3();
let sceneRadius = 100;
let homePos: THREE.Vector3, homeTarget: THREE.Vector3;
let hoverIndex = -1;
let focusIndex = -1;               // the prime match (text) or clicked work — centered + ringed
let lastOrder: number[] = [];      // most recent ranking, for the results strip
let navOrder: number[] = [];       // diversified top results shown in the strip (used for ←→ nav)
let neighborIndices: number[] = []; // the LINK_N works connected by constellation lines

// high-res LOD: works near the camera get their real Met image instead of the 64px atlas tile
const NEAR_K = 64;
let nearPool: THREE.Mesh[] = [];
let nearActive: number[] = [];     // instance indices currently shown hi-res
const texCache = new Map<number, THREE.Texture>();
const texLoading = new Set<number>();
let texLoader: THREE.TextureLoader;

// drifting dust particles for atmosphere
let dust: THREE.Mesh;
// constellation tubes linking the prime match to its nearest neighbours
let linksGroup: THREE.Group;
let linkMeshes: THREE.Mesh[] = [];
const LINK_N = 8;

// camera fly target
let flyTarget: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
let hasEntered = false;
let navigationTimer = 0;
let guideReturnFocus: HTMLElement | null = null;
let searchToken = 0;

// card state: which work is shown, and whether it's sticky (click/search vs hover)
let cardIndex = -1;
let cardSticky = false;
// description cache: id → text (undefined = not fetched, "" = unavailable)
const descCache = new Map<number, string>();

const BASE = import.meta.env.BASE_URL;

// ---- boot ---------------------------------------------------------------
async function boot() {
  loaderText.textContent = "loading the collection…";
  const [atlasJson, embBuf, atlasTex] = await Promise.all([
    fetch(`${BASE}data/atlas.json`).then((r) => r.json()) as Promise<Atlas>,
    fetch(`${BASE}data/embeddings.bin`).then((r) => r.arrayBuffer()),
    loadTexture(`${BASE}data/atlas.png`),
  ]);
  data = atlasJson;
  // Met titles/fields carry HTML tags and entities (e.g. "<i>Nimai-Dō</i>") — clean once
  for (const p of data.points) {
    p.title = clean(p.title); p.artist = clean(p.artist); p.medium = clean(p.medium);
    p.culture = clean(p.culture); p.department = clean(p.department);
    p.tags = (p.tags || []).map(clean);
  }
  embeddings = new Float32Array(embBuf);

  initThree(atlasTex);
  buildPoints(atlasTex);
  bindInput();
  animate();
  startPlaceholderTypewriter();

  loader.classList.add("done");
  setTimeout(() => (loader.style.display = "none"), 700);

  // Warm CLIP in the background. This makes the first interaction feel immediate while
  // giving visitors an honest indication that the on-device search model is preparing.
  modelStatus.textContent = "preparing semantic search…";
  loadCLIP((s) => (modelStatus.textContent = s || "semantic search ready")).catch(() => {
    modelStatus.textContent = "search model unavailable";
  });

  // A link can open directly on an idea or an artwork constellation. This makes
  // discoveries shareable without introducing routing or server state.
  const view = new URLSearchParams(location.search);
  const sharedQuery = view.get("q")?.trim();
  const sharedWork = Number(view.get("work"));
  if (sharedQuery) {
    dismissArrival();
    qInput.value = sharedQuery;
    setTimeout(() => runSearch(sharedQuery), 80);
  } else if (Number.isFinite(sharedWork)) {
    const idx = data.points.findIndex((p) => p.id === sharedWork);
    if (idx >= 0) {
      dismissArrival();
      setTimeout(() => showSimilar(idx), 80);
    }
  }
}

function loadTexture(url: string): Promise<THREE.Texture> {
  return new Promise((res, rej) => {
    new THREE.TextureLoader().load(url, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.flipY = false;                 // we packed the atlas top-row-first
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = true;
      res(t);
    }, undefined, rej);
  });
}

// ---- three setup --------------------------------------------------------
function initThree(_tex: THREE.Texture) {
  renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(0x060608, 1);

  camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 2000);
  camera.position.set(0, 0, 200);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.9;
  controls.panSpeed = 0.8;
  controls.screenSpacePanning = true;
  controls.autoRotateSpeed = reducedMotion ? 0 : 0.35;

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // A WebGPU scene should not keep a render loop alive in a background tab.
  // Resume exactly where it left off when the visitor returns.
  document.addEventListener("visibilitychange", () => {
    renderer.setAnimationLoop(document.hidden ? null : renderFrame);
  });

}

// ---- the point cloud ----------------------------------------------------
function buildPoints(tex: THREE.Texture) {
  const n = data.count;
  const cols = data.atlas.cols;

  // instanced quad: one plane, N instances, each with its own world position + atlas cell
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute("position", base.attributes.position);
  geo.setAttribute("uv", base.attributes.uv);

  const cells = new Float32Array(n);
  const scores = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = data.points[i].pos;
    positions.push(new THREE.Vector3(p[0], p[1], p[2]));
    cells[i] = data.points[i].cell;
  }

  // Declutter by LOCAL DENSITY: a point in a sparse region (its k-th nearest neighbour is
  // far) is an isolated work or tiny clump — pull it toward the centroid so nothing floats
  // alone. Using the k-th (not 1st) neighbour catches isolated *pairs/clumps*, not just
  // single points. O(n²) is fine for ~1500 points.
  const c0 = new THREE.Vector3();
  positions.forEach((p) => c0.add(p));
  c0.multiplyScalar(1 / n);
  const K = 5;
  const kdist = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const top = new Float32Array(K).fill(Infinity); // k smallest squared distances
    const pi = positions[i];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const d = pi.distanceToSquared(positions[j]);
      if (d < top[K - 1]) { let k = K - 1; while (k > 0 && top[k - 1] > d) { top[k] = top[k - 1]; k--; } top[k] = d; }
    }
    kdist[i] = Math.sqrt(top[K - 1]);
  }
  const medK = [...kdist].sort((a, b) => a - b)[Math.floor(n / 2)] || 1;
  for (let i = 0; i < n; i++) {
    // only the genuinely isolated few get nudged inward; the organic tendrils are kept
    if (kdist[i] > medK * 3.2) positions[i].lerp(c0, 0.45);
  }

  // De-stack: UMAP drops many works onto near-identical coordinates, so thumbnails pile
  // up into an unreadable clump. Nudge each by a small deterministic jitter (~⅓ of the
  // median neighbour gap) so coincident works fan out into a legible little cloud.
  const hash = (i: number, s: number) => {
    const x = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453;
    return (x - Math.floor(x)) * 2 - 1; // -1..1
  };
  const jit = medK * 1.05;
  for (let i = 0; i < n; i++) {
    positions[i].x += hash(i, 1) * jit;
    positions[i].y += hash(i, 2) * jit;
    positions[i].z += hash(i, 3) * jit;
  }

  // centroid + 93rd-percentile radius for framing
  sceneCenter.set(0, 0, 0);
  positions.forEach((p) => sceneCenter.add(p));
  sceneCenter.multiplyScalar(1 / n);
  const dists = positions.map((p) => p.distanceTo(sceneCenter)).sort((a, b) => a - b);
  sceneRadius = Math.max(dists[Math.floor(n * 0.93)] || 1, 1);

  const iPos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    iPos[i * 3] = positions[i].x; iPos[i * 3 + 1] = positions[i].y; iPos[i * 3 + 2] = positions[i].z;
  }

  // shared instance attributes — the image mesh and the point-cloud mesh read the same
  // positions / scores / hero flag, so one needsUpdate keeps both in sync.
  const posAttr = new THREE.InstancedBufferAttribute(iPos, 3);
  scoreAttr = new THREE.InstancedBufferAttribute(scores, 1);
  heroAttr = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
  geo.setAttribute("iPos", posAttr);
  geo.setAttribute("cell", new THREE.InstancedBufferAttribute(cells, 1));
  geo.setAttribute("score", scoreAttr);
  geo.setAttribute("hero", heroAttr);
  hiddenAttr = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
  geo.setAttribute("hidden", hiddenAttr);
  geo.instanceCount = n;

  // thumbnails are opaque RGB (no alpha) → render opaque with depth, no transparency sorting
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: false, depthWrite: true, depthTest: true });

  const cell = attribute("cell", "float");
  const score = attribute("score", "float");
  const center = attribute("iPos", "vec3");
  const hidden = attribute("hidden", "float");
  const isHero = attribute("hero", "float");

  // --- vertex: build a camera-facing quad around each instance's world position ---
  // SpriteNodeMaterial ignores per-instance translation on an InstancedMesh, so we
  // billboard by hand: take the instance centre into view space, then offset by the
  // plane corner in the view plane (x,y) so it always faces the camera.
  // On search the field reorganises: every work collapses to nothing here (it becomes a
  // dot in the point cloud) EXCEPT the focused work, which blooms to a big hero image.
  const heroPulse = float(1).add(sin(uTime.mul(1.6)).mul(0.05)); // slow, visible breath
  const sizeF = mix(float(1.0), isHero.mul(HERO).mul(heroPulse), uSearch);
  const grow = uBase.mul(sizeF).mul(float(1).sub(hidden));
  const viewCenter = modelViewMatrix.mul(vec4(center, 1.0));
  const corner = vec4(positionGeometry.x.mul(grow), positionGeometry.y.mul(grow), 0.0, 0.0);
  mat.vertexNode = cameraProjectionMatrix.mul(viewCenter.add(corner));

  // --- fragment: sample this instance's tile out of the atlas ---
  const fcols = float(cols);
  const cx = mod(cell, fcols);
  const cy = floor(cell.div(fcols));
  // plane uv (0,0)=bottom-left; atlas packed top-row-first with flipY=false → flip v
  const au = cx.add(uv().x).div(fcols);
  const av = cy.add(float(1).sub(uv().y)).div(fcols);
  const tx = texture(tex, vec2(au, av));
  // atmospheric depth in the overview (works far from camera fade); full brightness once
  // a search isolates the hero so it reads crisp and bright.
  const depth = positionView.z.negate();
  const fog = float(1).sub(smoothstep(uFogNear, uFogFar, depth));
  const depthMul = mix(float(0.35).add(fog.mul(0.65)), float(1), uSearch);
  mat.colorNode = tx.rgb.mul(depthMul);

  mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  buildPointCloud(posAttr);

  uBase.value = Math.max(sceneRadius * 0.017, 1.0);
  const dist = sceneRadius / Math.sin((camera.fov * Math.PI) / 360) * 0.62; // start in closer, among the works
  camera.position.copy(sceneCenter).add(new THREE.Vector3(0, 0, dist));
  controls.target.copy(sceneCenter);
  controls.minDistance = sceneRadius * 0.05;
  controls.maxDistance = dist * 2.2;
  controls.update();
  homePos = camera.position.clone();
  homeTarget = sceneCenter.clone();
  uFogNear.value = dist - sceneRadius;
  uFogFar.value = dist + sceneRadius * 1.4;

  // intro: start pulled straight back, then ease into the framed view
  camera.position.copy(sceneCenter).add(new THREE.Vector3(0, 0, dist * 1.9));
  flyTarget = { pos: homePos.clone(), look: homeTarget.clone() };

  texLoader = new THREE.TextureLoader();
  texLoader.setCrossOrigin("anonymous"); // Met CDN sends ACAO:* so cross-origin textures are allowed

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x060608);
  scene.add(mesh);
  scene.add(pointCloud);
  scene.add(buildSelector());
  scene.add(buildFocusRing());
  scene.add(buildDust());
  scene.add(buildLinks());
  buildNearPool();
  setupPost();
}

// Every work as a soft glowing dot. Hidden in the overview (where the thumbnails live),
// it fades in on search so the field reads as a clean point cloud around the hero image:
// matches glow warm and bright, the rest stay faint and cool, the hero itself is omitted
// (it's shown as the big image instead).
function buildPointCloud(posAttr: THREE.InstancedBufferAttribute) {
  const base = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute("position", base.attributes.position);
  g.setAttribute("uv", base.attributes.uv);
  g.setAttribute("iPos", posAttr);     // shared with the image mesh
  g.setAttribute("score", scoreAttr);  // shared
  g.setAttribute("hero", heroAttr);    // shared
  g.instanceCount = posAttr.count;

  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: true });
  m.blending = THREE.AdditiveBlending;

  const center = attribute("iPos", "vec3");
  const score = attribute("score", "float");
  const isHero = attribute("hero", "float");

  // size: small points — faint works are tiny, matches a touch larger; the hero dot vanishes
  const sizePts = uBase.mul(float(0.08).add(score.mul(0.14))).mul(float(1).sub(isHero));
  const vc = modelViewMatrix.mul(vec4(center, 1.0));
  const corner = vec4(positionGeometry.x.mul(sizePts), positionGeometry.y.mul(sizePts), 0.0, 0.0);
  m.vertexNode = cameraProjectionMatrix.mul(vc.add(corner));

  // soft round falloff; cool grey-blue for non-matches → warm gold for matches.
  // kept dim on purpose so points stay crisp and don't blow out under the bloom pass.
  const d = length(uv().sub(0.5));
  const soft = smoothstep(0.5, 0.05, d);
  m.colorNode = mix(vec3(0.42, 0.48, 0.6), vec3(0.95, 0.78, 0.45), score);
  m.opacityNode = soft.mul(uSearch).mul(float(0.1).add(score.mul(0.4)));

  pointCloud = new THREE.Mesh(g, m);
  pointCloud.frustumCulled = false;
  pointCloud.renderOrder = -1; // behind the hero image and rings
}

// constellation tubes from the prime match to its nearest neighbours. WebGPU ignores
// line width, so 1px lines read as invisible hairlines — we use thin glowing cylinders
// instead, repositioned each search (cheap: orient + scale a shared unit cylinder).
function buildLinks(): THREE.Group {
  const g = new THREE.CylinderGeometry(1, 1, 1, 6); // unit radius, unit height along +Y
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false });
  m.blending = THREE.AdditiveBlending;
  m.colorNode = vec3(0.96, 0.87, 0.66);                      // warm gold
  m.opacityNode = float(0.5).add(sin(uTime.mul(2)).mul(0.12)); // gentle breathing
  linksGroup = new THREE.Group();
  linksGroup.visible = false;
  for (let i = 0; i < LINK_N; i++) {
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    mesh.visible = false;
    linkMeshes.push(mesh);
    linksGroup.add(mesh);
  }
  return linksGroup;
}

const _up = new THREE.Vector3(0, 1, 0);
const _mid = new THREE.Vector3(), _dirv = new THREE.Vector3();
function updateLinks(hero: number, order: number[]) {
  const hp = positions[hero];
  const r = uBase.value * 0.022; // thin glowing filaments, not heavy rods
  neighborIndices = [];
  let k = 0;
  for (let idx = 0; idx < order.length && k < LINK_N; idx++) {
    const j = order[idx];
    if (j === hero) continue;
    neighborIndices.push(j);
    const nb = positions[j];
    _mid.copy(hp).add(nb).multiplyScalar(0.5);
    _dirv.copy(nb).sub(hp);
    const len = _dirv.length();
    const mesh = linkMeshes[k];
    mesh.position.copy(_mid);
    mesh.quaternion.setFromUnitVectors(_up, _dirv.normalize());
    mesh.scale.set(r, len, r);
    mesh.visible = true;
    k++;
  }
  for (; k < LINK_N; k++) linkMeshes[k].visible = false;
  linksGroup.visible = true;
}

// warm pulsing ring that pins the prime match (or clicked work) so the eye lands on it
function buildFocusRing(): THREE.Mesh {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false });
  m.blending = THREE.AdditiveBlending;
  const b = uv();
  const edge = min(min(b.x, b.y), min(float(1).sub(b.x), float(1).sub(b.y)));
  m.colorNode = vec3(0.92, 0.8, 0.52);            // soft warm gold
  // feathered, low-opacity hairline — present but quiet, not a harsh stroke
  m.opacityNode = smoothstep(float(0.022), float(0.008), edge).mul(0.38);
  focusRing = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
  focusRing.frustumCulled = false;
  focusRing.renderOrder = 3;
  focusRing.visible = false;
  return focusRing;
}

// Mark a work on the map: ring it, flag it as the hero (point cloud omits it, image mesh
// shows it as a crisp marker), and frame its local neighbourhood so you can read where it
// sits among similar works. The full HD image + description live in the card.
function focusOn(hero: number, order: number[]) {
  focusIndex = hero;
  showCard(data.points[hero], hero, true);
  const ha = heroAttr.array as Float32Array;
  ha.fill(0);
  ha[hero] = 1;
  heroAttr.needsUpdate = true;
  getTexture(hero); // preload the hi-res so the marker (and card) are sharp right away
  const hp = positions[hero];
  // frame the local cluster: out far enough to see the nearest matches + the constellation
  let rad = uBase.value * 8;
  for (let k = 0, seen = 0; k < order.length && seen < 8; k++) {
    if (order[k] === hero) continue;
    rad = Math.max(rad, positions[order[k]].distanceTo(hp));
    seen++;
  }
  rad = Math.min(rad, sceneRadius * 0.4);
  const clusterFit = rad / Math.sin((camera.fov * Math.PI) / 360) * 1.25 + uBase.value * 6;
  // Original framing: take whichever is smaller (cluster fit or hero-readable distance),
  // then pull back 60% extra so tight clusters have breathing room between neighbours.
  // The hero shrinks from ~46% → ~29% of viewport height, but stays clearly readable.
  const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
  const heroDist = (uBase.value * HERO * 0.5) / (0.46 * tanHalf);
  const fitDist = Math.min(clusterFit, heroDist) * 1.6;
  const dir = camera.position.clone().sub(controls.target);
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
  dir.normalize();
  flyTarget = { pos: hp.clone().add(dir.multiplyScalar(fitDist)), look: hp.clone() };
}

// ---- drifting dust particles (atmosphere) -------------------------------
function buildDust(): THREE.Mesh {
  const COUNT = 1200;
  const base = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute("position", base.attributes.position);
  g.setAttribute("uv", base.attributes.uv);
  const dp = new Float32Array(COUNT * 3);
  const seed = new Float32Array(COUNT);
  const R = sceneRadius * 2.4;
  for (let i = 0; i < COUNT; i++) {
    // random point in a sphere shell around the cloud
    const u = Math.random(), v = Math.random(), w = Math.random();
    const theta = u * Math.PI * 2, phi = Math.acos(2 * v - 1), r = R * (0.25 + 0.75 * Math.cbrt(w));
    dp[i * 3] = sceneCenter.x + r * Math.sin(phi) * Math.cos(theta);
    dp[i * 3 + 1] = sceneCenter.y + r * Math.sin(phi) * Math.sin(theta);
    dp[i * 3 + 2] = sceneCenter.z + r * Math.cos(phi);
    seed[i] = Math.random() * 6.28;
  }
  g.setAttribute("iPos", new THREE.InstancedBufferAttribute(dp, 3));
  g.setAttribute("seed", new THREE.InstancedBufferAttribute(seed, 1));
  g.instanceCount = COUNT;

  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  m.blending = THREE.AdditiveBlending;
  const c = attribute("iPos", "vec3");
  const sd = attribute("seed", "float");
  // slow drift
  const drift = vec3(
    sin(uTime.mul(0.11).add(sd)),
    sin(uTime.mul(0.13).add(sd.mul(1.7))),
    sin(uTime.mul(0.09).add(sd.mul(2.3)))
  ).mul(sceneRadius * 0.05);
  const vc = modelViewMatrix.mul(vec4(c.add(drift), 1.0));
  const sz = sceneRadius * 0.012;
  const corner = vec4(positionGeometry.x.mul(sz), positionGeometry.y.mul(sz), 0.0, 0.0);
  m.vertexNode = cameraProjectionMatrix.mul(vc.add(corner));
  const d = length(uv().sub(0.5));
  const soft = smoothstep(0.5, 0.05, d);
  const twinkle = float(0.5).add(sin(uTime.mul(0.8).add(sd.mul(3))).mul(0.4));
  m.colorNode = vec3(0.6, 0.66, 0.82);
  m.opacityNode = soft.mul(twinkle).mul(0.7);
  dust = new THREE.Mesh(g, m);
  dust.frustumCulled = false;
  dust.renderOrder = -1;
  return dust;
}

// ---- high-res near layer ------------------------------------------------
let placeholderTex: THREE.Texture;
function buildNearPool() {
  placeholderTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  placeholderTex.needsUpdate = true;
  for (let i = 0; i < NEAR_K; i++) {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: true, depthTest: true });
    const texNode = texture(placeholderTex);   // swappable per-frame without recompiling
    m.colorNode = texNode;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = 1;
    (mesh as any).__idx = -1;
    (mesh as any).__texNode = texNode;
    nearPool.push(mesh);
    scene.add(mesh);
  }
}

// The Met CDN sits behind a WAF (Incapsula) that rejects cross-origin texture requests:
// crossOrigin="anonymous" omits cookies, so the WAF never gets its visid_incap cookie,
// challenges every request and strips the ACAO header — leaving every WebGL texture stuck
// on the blurry 64px atlas tile. Plain <img> (the card + strip) carry cookies and pass,
// which is why only the centre hero looked low-res. wsrv.nl refetches server-side and
// serves the image with proper CORS headers, so the full-res Met image is usable on the GPU.
const proxied = (url: string) => `https://wsrv.nl/?url=${encodeURIComponent(url)}`;

function getTexture(i: number): THREE.Texture | null {
  if (texCache.has(i)) return texCache.get(i)!;
  if (!texLoading.has(i)) {
    texLoading.add(i);
    texLoader.load(
      proxied(data.points[i].image),
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        t.minFilter = THREE.LinearMipmapNearestFilter; // crisp at hero size, no shimmer on far tiles
        t.generateMipmaps = true;
        texCache.set(i, t); texLoading.delete(i);
      },
      undefined,
      () => texLoading.delete(i)
    );
  }
  return null;
}

// pick which nearby works get the hi-res treatment (throttled — the scan+sort is the cost)
let nearFrame = 0;
function selectNearWorks() {
  const camPos = camera.position;
  const nearDist = sceneRadius * 0.45; // only upgrade works the camera has flown close to
  const searching = uSearch.value > 0.5;
  let chosen: number[];
  if (searching) {
    // hero + its constellation neighbours all get hi-res images; everything else stays a dot
    chosen = focusIndex >= 0 ? [focusIndex, ...neighborIndices] : [];
  } else {
    const cand: { i: number; d: number }[] = [];
    for (let i = 0; i < positions.length; i++) {
      const d = camPos.distanceTo(positions[i]);
      if (d < nearDist) cand.push({ i, d });
    }
    cand.sort((a, b) => a.d - b.d);
    chosen = cand.slice(0, NEAR_K).map((c) => c.i);
  }

  const hid = hiddenAttr.array as Float32Array;
  let changed = false;
  for (const i of nearActive) if (!chosen.includes(i)) { hid[i] = 0; changed = true; }

  for (let p = 0; p < nearPool.length; p++) {
    const m = nearPool[p];
    const i = chosen[p];
    if (i === undefined) { m.visible = false; (m as any).__idx = -1; continue; }
    const tex = getTexture(i);
    if (!tex) { m.visible = false; (m as any).__idx = -1; continue; } // loading → atlas tile stays
    if (hid[i] !== 1) { hid[i] = 1; changed = true; }
    if ((m as any).__idx !== i) {
      (m as any).__texNode.value = tex; // swap without recompiling
      (m as any).__idx = i;
      const img = tex.image as { width: number; height: number };
      (m as any).__aspect = img.width / img.height || 1;
    }
    m.visible = true;
  }
  nearActive = chosen;
  if (changed) hiddenAttr.needsUpdate = true;
}

// billboard the active hi-res planes toward the camera (cheap, every frame)
const _dir = new THREE.Vector3();
function updateNearLayer() {
  if (nearFrame++ % 5 === 0) selectNearWorks();
  for (const m of nearPool) {
    if (!m.visible) continue;
    const i = (m as any).__idx;
    if (i < 0) continue;
    const aspect = (m as any).__aspect || 1;
    // hero: large; constellation neighbours: medium; everything else: tile-sized crisp upgrade
    const isNeighbor = neighborIndices.includes(i);
    const box = i === focusIndex ? uBase.value * HERO : isNeighbor ? uBase.value * 1.7 : uBase.value * 1.15;
    const h = aspect >= 1 ? box / aspect : box, w = h * aspect;
    m.position.copy(positions[i]);
    _dir.copy(camera.position).sub(positions[i]).normalize();
    // lift just in front of the point cloud: hero furthest, neighbours mid, others just a touch
    const lift = i === focusIndex ? uBase.value * 1.2 : neighborIndices.includes(i) ? uBase.value * 0.8 : uBase.value * 0.4;
    m.position.addScaledVector(_dir, lift);
    m.quaternion.copy(camera.quaternion);
    m.scale.set(w, h, 1);
  }
}

// bloom so the bright matched works glow during a search; safe fallback to plain render
function setupPost() {
  try {
    const scenePass = pass(scene, camera);
    const bloomPass = bloom(scenePass, 0.42, 0.4, 0.9); // strength, radius, threshold
    // cinematic vignette: darken toward the frame edges so the framing reads as intentional
    const r = screenUV.sub(0.5).length();
    const vignette = smoothstep(0.95, 0.35, r);
    post = new THREE.PostProcessing(renderer);
    post.outputNode = scenePass.add(bloomPass).mul(vignette);
  } catch (e) {
    console.warn("bloom unavailable, rendering without post", e);
    post = null;
  }
}

// a thin square outline that billboards to face the camera, marking the hovered work
function buildSelector(): THREE.Mesh {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false });
  const b = uv();
  const edge = min(min(b.x, b.y), min(float(1).sub(b.x), float(1).sub(b.y)));
  m.colorNode = vec4(0.84, 0.82, 0.78, 1).xyz;
  m.opacityNode = step(edge, float(0.035)); // opaque only near the border → a thin frame
  selector = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
  selector.frustumCulled = false;
  selector.renderOrder = 2;
  selector.visible = false;
  return selector;
}

// ---- typewriter placeholder — cycles first-person prompts into the search
// box's placeholder so the empty state invites a query instead of listing examples.
const PLACEHOLDER_PHRASES = [
  "show me gold",
  "show me blue",
  "show me storms at sea",
  "show me quiet water",
  "show me something ancient",
];
let phTimer = 0;
let phRunning = false;
function stopPlaceholderTypewriter() {
  phRunning = false;
  clearTimeout(phTimer);
}
function startPlaceholderTypewriter() {
  if (phRunning || qInput.value || document.activeElement === qInput) return;
  phRunning = true;
  let phraseIdx = 0;
  const step = (charIdx: number, deleting: boolean) => {
    if (!phRunning) return;
    const phrase = PLACEHOLDER_PHRASES[phraseIdx];
    qInput.placeholder = phrase.slice(0, charIdx);
    if (!deleting) {
      if (charIdx < phrase.length) {
        phTimer = window.setTimeout(() => step(charIdx + 1, false), 55 + Math.random() * 45);
      } else {
        phTimer = window.setTimeout(() => step(charIdx, true), 1500);
      }
    } else {
      if (charIdx > 0) {
        phTimer = window.setTimeout(() => step(charIdx - 1, true), 28);
      } else {
        phraseIdx = (phraseIdx + 1) % PLACEHOLDER_PHRASES.length;
        phTimer = window.setTimeout(() => step(0, false), 450);
      }
    }
  };
  step(0, false);
}

// ---- hover picking (CPU, on pointer move) -------------------------------
let hoverRAF = 0;
function bindInput() {
  canvas.addEventListener("pointermove", (e) => {
    if (!reducedMotion) {
      cursorAura.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
      cursorAura.classList.add("is-active");
    }
    if (hoverRAF) return;
    hoverRAF = requestAnimationFrame(() => {
      hoverRAF = 0;
      const prev = hoverIndex;
      hoverIndex = pick(e.clientX, e.clientY);
      if (hoverIndex >= 0 && hoverIndex !== prev) playHover();
      if (hoverIndex >= 0) {
        canvas.style.cursor = "pointer";
        // If a work is already clicked/sticky, don't override the card while orbiting
        if (!cardSticky) showCard(data.points[hoverIndex], hoverIndex, false);
      } else {
        canvas.style.cursor = "grab";
        // Left all artworks — restore sticky focus card if present, else hide
        if (!cardSticky) {
          if (focusIndex >= 0) showCard(data.points[focusIndex], focusIndex, true);
          else hideCard();
        }
      }
    });
  });
  canvas.addEventListener("pointerleave", (e) => {
    cursorAura.classList.remove("is-active");
    if (card.contains(e.relatedTarget as Node)) return; // cursor went onto the card
    hoverIndex = -1;
    canvas.style.cursor = "grab";
    if (cardSticky) return; // clicked work — card stays as-is
    if (focusIndex >= 0) showCard(data.points[focusIndex], focusIndex, true);
    else hideCard();
  });

  // When cursor leaves the card without going back to canvas, restore focus card or hide
  card.addEventListener("mouseleave", (e) => {
    if (canvas.contains(e.relatedTarget as Node)) return; // back to canvas — canvas handlers take over
    if (focusIndex >= 0) {
      showCard(data.points[focusIndex], focusIndex, true);
    } else {
      forceHideCard();
    }
  });

  // direct manipulation just fades the controls hint — the gentle drift keeps going,
  // even after you zoom in, so the field is always quietly alive
  const takeOver = () => { dismissArrival(); legend.classList.add("faded"); resumeAudio(); startAmbient(); };
  canvas.addEventListener("pointerdown", takeOver);
  canvas.addEventListener("wheel", () => {
    takeOver();
    if (reducedMotion) return;
    canvas.classList.add("is-navigating");
    clearTimeout(navigationTimer);
    navigationTimer = window.setTimeout(() => canvas.classList.remove("is-navigating"), 140);
  }, { passive: true });

  // click a work → focus on it and show its neighbours; click empty space → just navigate (no exit)
  // Escape is the intentional way out of focus mode — a click on empty canvas should never kick you back
  canvas.addEventListener("click", (e) => {
    const i = pick(e.clientX, e.clientY);
    if (i >= 0) { playClick(); showSimilar(i); }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    resumeAudio(); startAmbient();
    playClick(1.1);
    const q = qInput.value.trim();
    if (q) { dismissArrival(); await runSearch(q); }
  });

  enterBtn.addEventListener("click", () => {
    dismissArrival();
    setSoundEnabled(true);
    syncSoundButton();
    playClick(0.86);
  });

  promptButtons.forEach((button) => button.addEventListener("click", async () => {
    const query = button.dataset.query;
    if (!query) return;
    dismissArrival();
    qInput.value = query;
    await runSearch(query);
  }));

  soundToggle.addEventListener("click", () => {
    setSoundEnabled(!soundEnabled());
    syncSoundButton();
    if (soundEnabled()) playClick(0.82);
  });

  shareView.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      shareView.textContent = "link copied";
      setTimeout(() => { shareView.textContent = "copy this view"; }, 1600);
    } catch {
      shareView.textContent = "copy unavailable";
      setTimeout(() => { shareView.textContent = "copy this view"; }, 1600);
    }
  });

  guideToggle.addEventListener("click", () => setGuideOpen(fieldGuide.hidden));
  guideClose.addEventListener("click", () => setGuideOpen(false));
  cardSimilar.addEventListener("click", () => {
    if (cardIndex < 0) return;
    playClick(0.94);
    showSimilar(cardIndex);
  });

  navPrev.addEventListener("click", () => navStep(-1));
  navNext.addEventListener("click", () => navStep(1));

  qInput.addEventListener("focus", () => { dismissArrival(); stopPlaceholderTypewriter(); });
  qInput.addEventListener("input", () => { if (qInput.value) stopPlaceholderTypewriter(); });
  qInput.addEventListener("blur", () => { if (!qInput.value) startPlaceholderTypewriter(); });

  // keyboard: ← → for result navigation, Esc to reset
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") { setGuideOpen(false); resetView(); }
    if (e.key === "?" && document.activeElement !== qInput) setGuideOpen(fieldGuide.hidden);
    if (document.activeElement !== qInput) {
      if (e.key === "ArrowRight") navStep(1);
      if (e.key === "ArrowLeft")  navStep(-1);
    }
  });
}

function setGuideOpen(open: boolean) {
  if (open) guideReturnFocus = document.activeElement as HTMLElement | null;
  fieldGuide.hidden = !open;
  guideToggle.setAttribute("aria-expanded", String(open));
  if (open) {
    dismissArrival();
    guideClose.focus();
  } else if (guideReturnFocus) {
    guideReturnFocus.focus();
    guideReturnFocus = null;
  }
}

function dismissArrival() {
  if (hasEntered) return;
  hasEntered = true;
  arrival.classList.add("is-dismissed");
}

function syncSoundButton() {
  const on = soundEnabled();
  soundToggle.textContent = on ? "sound on" : "sound off";
  soundToggle.setAttribute("aria-pressed", String(on));
  soundToggle.setAttribute("aria-label", on ? "Disable sound" : "Enable sound");
}

function setViewUrl(view: { q?: string; work?: number } = {}) {
  const url = new URL(location.href);
  url.searchParams.delete("q");
  url.searchParams.delete("work");
  if (view.q) url.searchParams.set("q", view.q);
  if (view.work) url.searchParams.set("work", String(view.work));
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  shareView.hidden = !view.q && !view.work;
}

function resetView() {
  searchToken++;
  const scores = scoreAttr.array as Float32Array;
  scores.fill(0);
  scoreAttr.needsUpdate = true;
  uSearchTarget = 0;
  qInput.value = "";
  modelStatus.textContent = "";
  results.hidden = true;
  resultCount.hidden = true;
  resultCount.textContent = "";
  startPlaceholderTypewriter();
  focusIndex = -1;
  neighborIndices = [];
  if (heroAttr) { (heroAttr.array as Float32Array).fill(0); heroAttr.needsUpdate = true; }
  if (focusRing) focusRing.visible = false;
  if (linksGroup) linksGroup.visible = false;
  forceHideCard();
  navOrder = [];
  navPrev.hidden = true;
  navNext.hidden = true;
  flyTarget = { pos: homePos.clone(), look: homeTarget.clone() };
  setViewUrl();
}

const proj = new THREE.Vector3();
function pick(mx: number, my: number): number {
  let best = -1, bestD = 18 * 18; // px radius²
  for (let i = 0; i < positions.length; i++) {
    proj.copy(positions[i]).project(camera);
    if (proj.z > 1) continue; // behind camera
    const sx = (proj.x * 0.5 + 0.5) * innerWidth;
    const sy = (-proj.y * 0.5 + 0.5) * innerHeight;
    const d = (sx - mx) ** 2 + (sy - my) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function fillCard(p: Point) {
  cardTitle.textContent = p.title;
  cardArtist.textContent = p.artist + (p.date ? `, ${p.date}` : "");
  cardMeta.textContent = p.medium || "";
  cardLink.href = `https://www.metmuseum.org/art/collection/search/${p.id}`;
  cardSimilar.setAttribute("aria-label", `Explore works similar to ${p.title}`);
  // description: show cached value, or clear for hover-only cards
  const cached = descCache.get(p.id);
  cardDesc.textContent = cached ?? "";
  cardDesc.classList.remove("loading");
}

// One or two lines about the work itself — never the artist's biography (no birthplace/dates).
function buildDescFromMet(m: any): string {
  // prefer curator gallery label (richest narrative text)
  if (m.labelText?.trim()) {
    const sentences = (m.labelText.trim() as string).match(/[^.!?]+[.!?]+/g) ?? [m.labelText.trim()];
    return sentences.slice(0, 2).join(" ").trim();
  }
  // compose from structured fields about the object — period, place — not the artist's life
  const geo = [m.geographyType, m.city, m.country, m.region].filter(Boolean).join(" ");
  const era = [m.period, m.dynasty, m.reign].filter(Boolean).join(", ");
  if (!era && !geo) return "";
  const line = [era, geo && `from ${geo}`].filter(Boolean).join(", ");
  return line.charAt(0).toUpperCase() + line.slice(1) + ".";
}

async function fetchDescription(p: Point) {
  if (descCache.has(p.id)) return;
  descCache.set(p.id, ""); // mark in-flight
  cardDesc.textContent = "···";
  cardDesc.classList.add("loading");
  try {
    const r = await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${p.id}`);
    const desc = r.ok ? buildDescFromMet(await r.json()) : "";
    descCache.set(p.id, desc);
    if (cardIndex >= 0 && data.points[cardIndex]?.id === p.id) {
      cardDesc.textContent = desc;
      cardDesc.classList.remove("loading");
    }
  } catch {
    descCache.set(p.id, "");
    cardDesc.textContent = "";
    cardDesc.classList.remove("loading");
  }
}

function showCard(p: Point, idx: number, sticky = false) {
  fillCard(p);
  cardIndex = idx;
  if (sticky) {
    cardSticky = true;
    fetchDescription(p); // kick off AI description on click/focus
  }
  card.hidden = false;
}

function hideCard() {
  if (cardSticky) return;
  card.hidden = true;
  cardIndex = -1;
}

function forceHideCard() {
  cardSticky = false;
  card.hidden = true;
  cardIndex = -1;
}

// ---- scoring (shared by text search and "more like this") ---------------
// queryVec is L2-normalised and lives in the same space as the image embeddings,
// so a dot product is cosine similarity. Used by CLIP text search AND by clicking
// a work (which uses that work's own image embedding as the query).
function applyScores(qv: Float32Array): { top: number; order: number[] } {
  const n = data.count, dim = data.dim;
  const scores = scoreAttr.array as Float32Array;
  const raw = new Float32Array(n);
  let max = -1, top = 0, lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) {
    let s = 0;
    const off = i * dim;
    for (let k = 0; k < dim; k++) s += qv[k] * embeddings[off + k];
    raw[i] = s;
    if (s > max) { max = s; top = i; }
    if (s < lo) lo = s;
    if (s > hi) hi = s;
  }
  const range = hi - lo || 1;
  for (let i = 0; i < n; i++) scores[i] = Math.pow((raw[i] - lo) / range, 3.5); // gamma sharpens the highlight
  scoreAttr.needsUpdate = true;
  uSearchTarget = 1;
  legend.classList.add("faded");

  const order = [...raw.keys()].sort((a, b) => raw[b] - raw[a]);
  lastOrder = order;
  focusOn(top, order);    // center the prime match, never dive into the clump
  updateLinks(top, order); // constellation from the prime match to its neighbours
  return { top, order };
}

// MMR re-rank for the results strip: keep it relevant to the query but visually
// varied, so a tight cluster of near-duplicates (e.g. a whole shelf of white-and-
// gold porcelain) doesn't fill every slot. Greedily trade similarity-to-query
// against similarity-to-already-picked. The prime match still lands first (with
// nothing picked yet, the best score is pure relevance).
function diversify(qv: Float32Array, order: number[], k: number, lambda = 0.5): number[] {
  const dim = data.dim;
  const dot = (a: Float32Array, off: number) => {
    let s = 0;
    for (let t = 0; t < dim; t++) s += a[t] * embeddings[off + t];
    return s;
  };
  const between = (a: number, b: number) => dot(embeddings.subarray(a * dim, a * dim + dim), b * dim);

  const pool = order.slice(0, Math.max(k * 6, 60)); // rank from a relevant shortlist
  const rel = new Map<number, number>();
  for (const i of pool) rel.set(i, dot(qv, i * dim));

  const picked: number[] = [];
  const remaining = new Set(pool);
  while (picked.length < k && remaining.size) {
    let best = -1, bestScore = -Infinity;
    for (const i of remaining) {
      let maxSim = 0;
      for (const p of picked) { const s = between(i, p); if (s > maxSim) maxSim = s; }
      const score = lambda * rel.get(i)! - (1 - lambda) * maxSim;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    picked.push(best);
    remaining.delete(best);
  }
  return picked;
}

function renderResults(order: number[]) {
  navOrder = order;
  results.innerHTML = "";
  for (const i of order) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.idx = String(i);
    button.setAttribute("aria-label", `Focus ${data.points[i].title} by ${data.points[i].artist}`);
    const img = document.createElement("img");
    img.src = data.points[i].image;
    img.title = `${data.points[i].title} — ${data.points[i].artist}`;
    img.alt = img.title;
    button.addEventListener("click", () => {
      playClick(0.9);
      focusOn(i, lastOrder);
      updateLinks(i, lastOrder);
      markActiveResult(i);
    });
    button.appendChild(img);
    results.appendChild(button);
  }
  results.hidden = order.length === 0;
  const hasResults = order.length > 0;
  navPrev.hidden = !hasResults;
  navNext.hidden = !hasResults;
}

function markActiveResult(idx: number) {
  results.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", (button as HTMLButtonElement).dataset.idx === String(idx));
  });
}

function navStep(dir: 1 | -1) {
  if (navOrder.length === 0) return;
  const cur = navOrder.indexOf(focusIndex);
  const next = navOrder[(cur + dir + navOrder.length) % navOrder.length];
  playClick(dir === 1 ? 1.05 : 0.95);
  focusOn(next, lastOrder);
  updateLinks(next, lastOrder);
  markActiveResult(next);
}

async function runSearch(q: string) {
  const token = ++searchToken;
  goBtn.disabled = true;
  goBtn.classList.add("busy");
  try {
    await loadCLIP((s) => (modelStatus.textContent = s));
    const qv = await embedText(q);
    if (token !== searchToken) return;
    const { top, order } = applyScores(qv);
    const div = diversify(qv, order, 12);
    renderResults(div);
    markActiveResult(top);
    modelStatus.textContent = "";
    resultCount.textContent = `${div.length} matches for “${q}”`;
    resultCount.hidden = false;
    setViewUrl({ q });
  } catch (err) {
    if (token !== searchToken) return;
    console.error(err);
    modelStatus.textContent = "couldn’t search — try again";
  } finally {
    if (token !== searchToken) return;
    goBtn.disabled = false;
    goBtn.classList.remove("busy");
  }
}

// click a work → highlight its nearest neighbours using its own image embedding
function showSimilar(i: number) {
  // A direct artwork exploration supersedes any text embedding still in flight.
  searchToken++;
  const dim = data.dim;
  const qv = embeddings.slice(i * dim, (i + 1) * dim);
  const { order } = applyScores(qv);
  const div = diversify(qv, order, 12);
  renderResults(div);
  markActiveResult(i);
  qInput.value = "";
  modelStatus.textContent = "";
  resultCount.textContent = `${div.length} similar works`;
  resultCount.hidden = false;
  startPlaceholderTypewriter();
  setViewUrl({ work: data.points[i].id });
}

// ---- loop ---------------------------------------------------------------
function animate() {
  renderer.setAnimationLoop(renderFrame);
}

function renderFrame() {
  uTime.value = clock.getElapsedTime();
  uSearch.value += (uSearchTarget - uSearch.value) * 0.08; // ease the search transition

  if (flyTarget) {
    camera.position.lerp(flyTarget.pos, 0.05);
    controls.target.lerp(flyTarget.look, 0.05);
    if (camera.position.distanceTo(flyTarget.pos) < sceneRadius * 0.012) flyTarget = null;
  }
  updateNearLayer();
  // hover frame follows the cursor — but not over the big focused hero (the ring marks it)
  const searching = uSearch.value > 0.5;
  if (hoverIndex >= 0 && !(searching && hoverIndex === focusIndex)) {
    selector.visible = true;
    selector.position.copy(positions[hoverIndex]);
    selector.quaternion.copy(camera.quaternion);
    const s = uBase.value * 1.9;
    selector.scale.set(s, s, s);
  } else {
    selector.visible = false;
  }
  // focus ring frames the big hero image, gently pulsing
  if (focusIndex >= 0 && uSearch.value > 0.12) {
    focusRing.visible = true;
    focusRing.position.copy(positions[focusIndex]);
    focusRing.quaternion.copy(camera.quaternion);
    const s = uBase.value * HERO * 1.05 * (1 + 0.03 * Math.sin(uTime.value * 1.6));
    focusRing.scale.set(s, s, s);
  } else {
    focusRing.visible = false;
  }
  // Drift in the overview; pause when a work is focused so you can pan freely
  controls.autoRotate = !flyTarget && focusIndex < 0;
  controls.update();
  if (post) post.render();
  else renderer.render(scene, camera);
}

boot().catch((e) => {
  console.error(e);
  loaderText.textContent = "failed to load — is the data built? run `npm run atlas`";
});
