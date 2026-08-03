import "@google/model-viewer";

type Scan = {
  id: number;
  slug: string;
  title: string;
  artist: string;
  date: string;
  medium: string;
  description: string;
  orbit: string;
};

type AtlasPoint = {
  id: number;
  title: string;
  artist: string;
  date: string;
  medium: string;
  image: string;
  pos: [number, number, number];
};

const scans: Scan[] = [
  {
    id: 854888,
    slug: "lion-sarcophagus",
    title: "Marble Sarcophagus with Lions Felling Antelope",
    artist: "Roman",
    date: "3rd century",
    medium: "Marble",
    description: "Lions grasp antelope at either end of a Roman sarcophagus, now readable as a complete object in space.",
    orbit: "28deg 72deg 110%",
  },
  {
    id: 312581,
    slug: "nayarit-house",
    title: "House Model",
    artist: "Nayarit artist(s)",
    date: "200 BCE–300 CE",
    medium: "Ceramic, slip",
    description: "A compact architectural world opens across two levels, preserving figures, food, shelter, and gathering.",
    orbit: "32deg 68deg 140%",
  },
  {
    id: 242017,
    slug: "aphrodite-eros",
    title: "Limestone Statue of Aphrodite Holding Winged Eros",
    artist: "Cypriot",
    date: "late 4th century BCE",
    medium: "Limestone",
    description: "A frontal goddess, elaborate headdress, and small winged Eros become legible from every side.",
    orbit: "26deg 74deg 145%",
  },
  {
    id: 309909,
    slug: "ngya-post",
    title: "Ngya (Commemorative Post)",
    artist: "Bongo artist",
    date: "late 19th century",
    medium: "Mahogany",
    description: "A tall commemorative form turns a single carved tree trunk into presence, memory, and social standing.",
    orbit: "24deg 72deg 500%",
  },
];

// Each scan is paired with a comparable object already embedded in the atlas.
// Related cards are the nearest spatial neighbors around that anchor.
const relatedAnchorIndices = [1118, 54, 843, 534];
const arAssetVersion = "20260803";

const viewer = document.querySelector("#viewer") as HTMLElement & {
  cameraOrbit?: string;
  jumpCameraToGoal?: () => void;
  activateAR?: () => Promise<void>;
};
const shell = document.querySelector(".viewer-shell") as HTMLElement;
const poster = document.querySelector("#viewer-poster") as HTMLImageElement;
const title = document.querySelector("#work-title") as HTMLElement;
const meta = document.querySelector("#work-meta") as HTMLElement;
const description = document.querySelector("#work-description") as HTMLElement;
const metLink = document.querySelector("#met-link") as HTMLAnchorElement;
const launch = document.querySelector("#ar-launch") as HTMLAnchorElement;
const launchImage = document.querySelector("#ar-launch-image") as HTMLImageElement;
const returnToast = document.querySelector("#ar-return-toast") as HTMLElement;
const returnRelated = document.querySelector("#return-related") as HTMLButtonElement;
const previous = document.querySelector("#previous-work") as HTMLButtonElement;
const next = document.querySelector("#next-work") as HTMLButtonElement;
const drift = document.querySelector("#drift-toggle") as HTMLButtonElement;
const reset = document.querySelector("#reset-view") as HTMLButtonElement;
const info = document.querySelector("#info-toggle") as HTMLButtonElement;
const relatedToggle = document.querySelector("#related-toggle") as HTMLButtonElement;
const relatedPanel = document.querySelector("#related-panel") as HTMLElement;
const closeRelated = document.querySelector("#close-related") as HTMLButtonElement;
const relatedList = document.querySelector("#related-list") as HTMLElement;
const relatedTitle = document.querySelector("#related-title") as HTMLElement;
const relatedMeta = document.querySelector("#related-meta") as HTMLElement;
const relatedMetLink = document.querySelector("#related-met-link") as HTMLAnchorElement;
const context = document.querySelector("#context-panel") as HTMLElement;
const loading = document.querySelector("#viewer-loading") as HTMLElement;
const loadPercent = document.querySelector("#load-percent") as HTMLElement;
const error = document.querySelector("#viewer-error") as HTMLElement;
const errorTitle = document.querySelector("#viewer-error-title") as HTMLElement;
const errorCopy = document.querySelector("#viewer-error-copy") as HTMLElement;
const retry = document.querySelector("#retry-model") as HTMLButtonElement;
const position = document.querySelector("#scan-position") as HTMLElement;
const options = [...document.querySelectorAll<HTMLButtonElement>(".scan-option")];
const intro = document.querySelector("#brand-intro") as HTMLElement;
const skipIntro = document.querySelector("#skip-intro") as HTMLButtonElement;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let current = 0;
let driftActive = true;
let introTimer = 0;
let atlasPoints: AtlasPoint[] | null = null;
let relatedRequest = 0;
let arSessionStarted = false;
let arBecameHidden = false;
let returnToastTimer = 0;
let modelLoadTimer = 0;

function path(scan: Scan, extension: "glb" | "usdz" | "jpg") {
  const suffix = extension === "usdz" ? "-gallery.usdz" : `.${extension}`;
  const version = extension === "usdz" ? `?v=${arAssetVersion}` : "";
  return `./ar/met-3d/${scan.slug}${suffix}${version}`;
}

function metUrl(scan: Scan) {
  return `https://www.metmuseum.org/art/collection/search/${scan.id}`;
}

function quickLookUrl(scan: Scan) {
  const title = encodeURIComponent(scan.title);
  const subtitle = encodeURIComponent(`${scan.artist} · ${scan.date}`);
  const action = encodeURIComponent("View at The Met");
  const canonical = encodeURIComponent(metUrl(scan));
  return `${path(scan, "usdz")}#allowsContentScaling=1&callToAction=${action}&checkoutTitle=${title}&checkoutSubtitle=${subtitle}&canonicalWebPageURL=${canonical}`;
}

function isiOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function closeIntro() {
  window.clearTimeout(introTimer);
  intro.classList.add("is-leaving");
  window.setTimeout(() => {
    intro.hidden = true;
    document.body.classList.remove("is-intro");
  }, reducedMotion.matches ? 0 : 480);
}

function showLoading() {
  window.clearTimeout(modelLoadTimer);
  error.hidden = true;
  loading.hidden = false;
  loadPercent.textContent = "0%";
  viewer.classList.remove("is-loaded");
  shell.classList.add("is-changing");
  shell.classList.remove("has-live-model");
  modelLoadTimer = window.setTimeout(() => {
    loading.hidden = true;
    errorTitle.textContent = "3D preview is taking longer";
    errorCopy.textContent = "The object poster and AR placement are ready. Retry the interactive preview when your connection or device frees up.";
    error.hidden = false;
    shell.classList.remove("is-changing");
  }, 12000);
}

async function loadAtlasPoints() {
  if (atlasPoints) return atlasPoints;
  const response = await fetch("./data/atlas.json");
  if (!response.ok) throw new Error(`Atlas data returned ${response.status}`);
  const data = await response.json() as { points: AtlasPoint[] };
  atlasPoints = data.points;
  return atlasPoints;
}

function selectRelated(point: AtlasPoint, card: HTMLButtonElement) {
  relatedList.querySelectorAll(".related-card").forEach((item) => item.classList.remove("is-active"));
  card.classList.add("is-active");
  relatedTitle.textContent = point.title;
  relatedMeta.textContent = `${point.artist || "Unknown artist"} · ${point.date || point.medium}`;
  relatedMetLink.href = `https://www.metmuseum.org/art/collection/search/${point.id}`;
  relatedMetLink.hidden = false;
}

function showReturnToast() {
  window.clearTimeout(returnToastTimer);
  returnToast.hidden = false;
  requestAnimationFrame(() => returnToast.classList.add("is-visible"));
  returnToastTimer = window.setTimeout(() => {
    returnToast.classList.remove("is-visible");
    window.setTimeout(() => { returnToast.hidden = true; }, reducedMotion.matches ? 0 : 220);
  }, 5200);
}

async function renderRelated() {
  const request = ++relatedRequest;
  relatedList.innerHTML = `<div class="related-loading" role="status">Finding nearby works…</div>`;
  relatedTitle.textContent = `Neighbors of ${scans[current].title}`;
  relatedMeta.textContent = "These works remain available until you close this tray.";
  relatedMetLink.hidden = true;

  try {
    const points = await loadAtlasPoints();
    if (request !== relatedRequest) return;
    const anchorIndex = relatedAnchorIndices[current];
    const anchor = points[anchorIndex];
    const neighbors = points
      .map((point, index) => ({
        point,
        index,
        distance: point.pos.reduce((sum, value, axis) => sum + (value - anchor.pos[axis]) ** 2, 0),
      }))
      .filter((candidate) => candidate.index !== anchorIndex)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 6);

    relatedList.replaceChildren();
    neighbors.forEach(({ point, index }, neighborIndex) => {
      const card = document.createElement("button");
      card.className = "related-card";
      card.type = "button";
      card.setAttribute("role", "listitem");
      card.innerHTML = `
        <img src="./data/thumbs/${index}.jpg" alt="" loading="lazy" decoding="async" />
        <span><b>${point.title}</b><small>${point.artist || point.medium || "The Met"}</small></span>
      `;
      const image = card.querySelector("img") as HTMLImageElement;
      image.addEventListener("error", () => {
        if (point.image && image.src !== point.image) image.src = point.image;
      }, { once: true });
      card.addEventListener("click", () => selectRelated(point, card));
      relatedList.append(card);
      if (neighborIndex === 0) selectRelated(point, card);
    });
  } catch {
    relatedList.innerHTML = `<div class="related-loading is-error">Related works could not load. Try again.</div>`;
  }
}

function setRelatedOpen(open: boolean) {
  relatedPanel.hidden = !open;
  relatedToggle.classList.toggle("is-active", open);
  relatedToggle.setAttribute("aria-expanded", String(open));
  if (open) void renderRelated();
}

function selectScan(index: number) {
  current = (index + scans.length) % scans.length;
  const scan = scans[current];
  showLoading();

  title.textContent = scan.title;
  meta.textContent = `${scan.artist} · ${scan.date} · ${scan.medium}`;
  description.textContent = scan.description;
  position.textContent = `${current + 1} / ${scans.length}`;
  metLink.href = metUrl(scan);
  metLink.textContent = `View object ${scan.id} at The Met ↗`;
  launch.href = quickLookUrl(scan);
  launchImage.src = path(scan, "jpg");
  poster.src = path(scan, "jpg");
  poster.alt = `Preview of the ${scan.title} 3D scan`;

  options.forEach((option, optionIndex) => {
    const active = optionIndex === current;
    option.classList.toggle("is-active", active);
    if (active) {
      option.setAttribute("aria-current", "true");
      const rail = option.parentElement as HTMLElement;
      rail.scrollTo({
        left: option.offsetLeft - (rail.clientWidth - option.offsetWidth) / 2,
        behavior: reducedMotion.matches ? "auto" : "smooth",
      });
    } else {
      option.removeAttribute("aria-current");
    }
  });

  window.setTimeout(() => {
    viewer.setAttribute("src", path(scan, "glb"));
    viewer.setAttribute("ios-src", path(scan, "usdz"));
    viewer.setAttribute("poster", path(scan, "jpg"));
    viewer.setAttribute("alt", `Interactive 3D model of ${scan.title}`);
    viewer.setAttribute("camera-orbit", scan.orbit);
    if (!relatedPanel.hidden) void renderRelated();
  }, reducedMotion.matches ? 0 : 120);
}

function retryCurrent() {
  const scan = scans[current];
  showLoading();
  viewer.removeAttribute("src");
  requestAnimationFrame(() => viewer.setAttribute("src", path(scan, "glb")));
}

options.forEach((option, index) => option.addEventListener("click", () => selectScan(index)));
previous.addEventListener("click", () => selectScan(current - 1));
next.addEventListener("click", () => selectScan(current + 1));
retry.addEventListener("click", retryCurrent);
skipIntro.addEventListener("click", closeIntro);

drift.addEventListener("click", () => {
  driftActive = !driftActive;
  drift.classList.toggle("is-active", driftActive);
  drift.setAttribute("aria-pressed", String(driftActive));
  if (driftActive) viewer.setAttribute("auto-rotate", "");
  else viewer.removeAttribute("auto-rotate");
});

reset.addEventListener("click", () => {
  viewer.setAttribute("camera-orbit", scans[current].orbit);
  viewer.jumpCameraToGoal?.();
});

info.addEventListener("click", () => {
  const open = !context.classList.contains("is-open");
  context.classList.toggle("is-open", open);
  info.setAttribute("aria-expanded", String(open));
  if (open) context.scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "nearest" });
});

relatedToggle.addEventListener("click", () => setRelatedOpen(relatedPanel.hidden));
closeRelated.addEventListener("click", () => setRelatedOpen(false));

launch.addEventListener("click", async (event) => {
  if (isiOS()) {
    arSessionStarted = true;
    arBecameHidden = false;
    return;
  }
  event.preventDefault();
  await viewer.activateAR?.();
});

launch.addEventListener("message", (event: Event) => {
  if ((event as MessageEvent).data === "_apple_ar_quicklook_button_tapped") {
    window.location.href = metUrl(scans[current]);
  }
});

document.addEventListener("visibilitychange", () => {
  if (!arSessionStarted) return;
  if (document.hidden) {
    arBecameHidden = true;
    return;
  }
  if (arBecameHidden) {
    arSessionStarted = false;
    arBecameHidden = false;
    setRelatedOpen(true);
    showReturnToast();
  }
});

returnRelated.addEventListener("click", () => {
  window.clearTimeout(returnToastTimer);
  returnToast.classList.remove("is-visible");
  returnToast.hidden = true;
  setRelatedOpen(true);
});

viewer.addEventListener("progress", (event: Event) => {
  const value = (event as CustomEvent<{ totalProgress: number }>).detail.totalProgress;
  const percent = Math.round(value * 100);
  viewer.style.setProperty("--load", String(value));
  loadPercent.textContent = `${percent}%`;
});

viewer.addEventListener("load", () => {
  window.clearTimeout(modelLoadTimer);
  loading.hidden = true;
  error.hidden = true;
  viewer.classList.add("is-loaded");
  shell.classList.remove("is-changing");
  shell.classList.add("has-live-model");
});

viewer.addEventListener("error", () => {
  window.clearTimeout(modelLoadTimer);
  loading.hidden = true;
  errorTitle.textContent = "Interactive 3D preview unavailable";
  errorCopy.textContent = "The object poster and AR placement are still ready. Close unused tabs, then retry the preview.";
  error.hidden = false;
  shell.classList.remove("is-changing");
});

const params = new URLSearchParams(location.search);
const requested = scans.findIndex((scan) => scan.slug === params.get("work"));
if (requested >= 0) selectScan(requested);

if (params.get("intro") === "0") {
  intro.hidden = true;
  document.body.classList.remove("is-intro");
} else {
  introTimer = window.setTimeout(closeIntro, reducedMotion.matches ? 0 : 1850);
}
