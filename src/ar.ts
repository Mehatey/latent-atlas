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
const arAssetVersion = "20260803b";

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
const launch = document.querySelector("#ar-launch") as HTMLButtonElement;
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
const cameraStage = document.querySelector("#camera-stage") as HTMLElement;
const cameraFeed = document.querySelector("#camera-feed") as HTMLVideoElement;
const cameraStatus = document.querySelector("#camera-status span") as HTMLElement;
const cameraPermission = document.querySelector("#camera-permission") as HTMLElement;
const retryCamera = document.querySelector("#retry-camera") as HTMLButtonElement;
const closeCameraStage = document.querySelector("#close-camera-stage") as HTMLButtonElement;
const stageObject = document.querySelector("#stage-object") as HTMLElement;
const stageMoveSurface = document.querySelector("#stage-move-surface") as HTMLElement;
const stageViewer = document.querySelector("#stage-viewer") as HTMLElement & {
  jumpCameraToGoal?: () => void;
};
const stageTitle = document.querySelector("#stage-title") as HTMLElement;
const stageMeta = document.querySelector("#stage-meta") as HTMLElement;
const stageDescription = document.querySelector("#stage-description") as HTMLElement;
const stageCounter = document.querySelector("#stage-counter") as HTMLElement;
const stageMetLink = document.querySelector("#stage-met-link") as HTMLAnchorElement;
const stageInfo = document.querySelector("#stage-info") as HTMLElement;
const stageMove = document.querySelector("#stage-move") as HTMLButtonElement;
const stageOrbit = document.querySelector("#stage-orbit") as HTMLButtonElement;
const stageInfoToggle = document.querySelector("#stage-info-toggle") as HTMLButtonElement;
const stageSound = document.querySelector("#stage-sound") as HTMLButtonElement;
const stageGuide = document.querySelector("#stage-guide") as HTMLElement;
const stagePlace = document.querySelector("#stage-place") as HTMLButtonElement;
const stagePrevious = document.querySelector("#stage-previous") as HTMLButtonElement;
const stageNext = document.querySelector("#stage-next") as HTMLButtonElement;
const stageQuickLook = document.querySelector("#stage-quick-look") as HTMLAnchorElement;
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
let cameraStream: MediaStream | null = null;
let stageMoveActive = false;
let stageSoundActive = true;
let stagePlaced = false;
let stageX = 0;
let stageY = 0;
let stageScale = 1;
let audioContext: AudioContext | null = null;
const activePointers = new Map<number, { x: number; y: number }>();
let gestureOrigin = { x: 0, y: 0, stageX: 0, stageY: 0, distance: 0, scale: 1 };

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

function playCue(kind: "open" | "select" | "place" | "mode" = "select") {
  if (!stageSoundActive) return;
  try {
    audioContext ??= new AudioContext();
    if (audioContext.state === "suspended") void audioContext.resume();
    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const frequencies = { open: [174, 261], select: [246, 329], place: [196, 392], mode: [220, 277] }[kind];
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequencies[0], now);
    oscillator.frequency.exponentialRampToValueAtTime(frequencies[1], now + .16);
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(.055, now + .018);
    gain.gain.exponentialRampToValueAtTime(.0001, now + .24);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + .26);
  } catch {
    // Audio is enhancement only; camera-stage interaction remains complete without it.
  }
}

function setStageTransform() {
  stageObject.style.setProperty("--stage-x", `${stageX}px`);
  stageObject.style.setProperty("--stage-y", `${stageY}px`);
  stageObject.style.setProperty("--stage-scale", String(stageScale));
}

function resetStagePosition() {
  stageX = 0;
  stageY = 0;
  stageScale = 1;
  setStageTransform();
  stageObject.classList.remove("is-placed");
  stagePlaced = false;
  const label = stagePlace.querySelector("span");
  const helper = stagePlace.querySelector("small");
  if (label) label.textContent = "Place object";
  if (helper) helper.textContent = "tap to settle";
}

function setStageMoveMode(active: boolean) {
  stageMoveActive = active;
  stageMoveSurface.hidden = !active;
  stageMove.classList.toggle("is-active", active);
  stageMove.setAttribute("aria-pressed", String(active));
  stageOrbit.classList.toggle("is-active", !active);
  stageOrbit.setAttribute("aria-pressed", String(!active));
  stageViewer.toggleAttribute("auto-rotate", !active);
  stageGuide.querySelector("strong")!.textContent = active ? "Move the object with one finger" : "Orbit the object with one finger";
  stageGuide.querySelector("span")!.textContent = active ? "Drag anywhere on the object · pinch to resize" : "Drag to inspect · pinch to scale · tap Move to reposition";
  playCue("mode");
}

async function startCamera() {
  cameraPermission.hidden = true;
  cameraStage.classList.add("is-requesting-camera");
  cameraStatus.textContent = "Starting";
  try {
    cameraStream?.getTracks().forEach((track) => track.stop());
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
    cameraFeed.srcObject = cameraStream;
    await cameraFeed.play();
    cameraStage.classList.add("has-camera");
    cameraStatus.textContent = "Live camera";
  } catch {
    cameraStage.classList.remove("has-camera");
    cameraStatus.textContent = "Camera blocked";
    cameraPermission.hidden = false;
  } finally {
    cameraStage.classList.remove("is-requesting-camera");
  }
}

function openStage() {
  closeIntro();
  cameraStage.hidden = false;
  document.body.classList.add("stage-open");
  resetStagePosition();
  setStageMoveMode(false);
  stageObject.classList.remove("is-entering");
  requestAnimationFrame(() => stageObject.classList.add("is-entering"));
  window.setTimeout(() => stageObject.classList.remove("is-entering"), reducedMotion.matches ? 0 : 720);
  void startCamera();
  playCue("open");
}

function closeStage() {
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  cameraFeed.srcObject = null;
  cameraStage.classList.remove("has-camera", "is-requesting-camera");
  cameraStage.hidden = true;
  document.body.classList.remove("stage-open");
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
  launchImage.src = path(scan, "jpg");
  poster.src = path(scan, "jpg");
  poster.alt = `Preview of the ${scan.title} 3D scan`;
  stageTitle.textContent = scan.title;
  stageMeta.textContent = `${scan.artist} · ${scan.date} · ${scan.medium}`;
  stageDescription.textContent = scan.description;
  stageCounter.textContent = `${current + 1} / ${scans.length}`;
  stageMetLink.href = metUrl(scan);
  stageMetLink.textContent = `Object ${scan.id} at The Met ↗`;
  stageQuickLook.href = quickLookUrl(scan);

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
    stageViewer.setAttribute("src", path(scan, "glb"));
    stageViewer.setAttribute("poster", path(scan, "jpg"));
    stageViewer.setAttribute("alt", `Interactive spatial model of ${scan.title}`);
    stageViewer.setAttribute("camera-orbit", scan.orbit);
    stageViewer.jumpCameraToGoal?.();
    if (!relatedPanel.hidden) void renderRelated();
  }, reducedMotion.matches ? 0 : 120);

  if (!cameraStage.hidden) {
    stageObject.classList.add("is-switching");
    window.setTimeout(() => stageObject.classList.remove("is-switching"), reducedMotion.matches ? 0 : 420);
    playCue("select");
  }
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

relatedToggle.addEventListener("click", () => setRelatedOpen(relatedPanel.hasAttribute("hidden")));
closeRelated.addEventListener("click", () => setRelatedOpen(false));

launch.addEventListener("click", openStage);
closeCameraStage.addEventListener("click", closeStage);
retryCamera.addEventListener("click", () => void startCamera());
stagePrevious.addEventListener("click", () => selectScan(current - 1));
stageNext.addEventListener("click", () => selectScan(current + 1));
stageMove.addEventListener("click", () => setStageMoveMode(true));
stageOrbit.addEventListener("click", () => setStageMoveMode(false));

stageInfoToggle.addEventListener("click", () => {
  const visible = !stageInfo.classList.contains("is-hidden");
  stageInfo.classList.toggle("is-hidden", visible);
  stageInfoToggle.classList.toggle("is-active", !visible);
  stageInfoToggle.setAttribute("aria-pressed", String(!visible));
  playCue("mode");
});

stageSound.addEventListener("click", () => {
  stageSoundActive = !stageSoundActive;
  stageSound.classList.toggle("is-active", stageSoundActive);
  stageSound.setAttribute("aria-pressed", String(stageSoundActive));
  if (stageSoundActive) playCue("mode");
});

stagePlace.addEventListener("click", () => {
  stagePlaced = !stagePlaced;
  stageObject.classList.toggle("is-placed", stagePlaced);
  const label = stagePlace.querySelector("span");
  const helper = stagePlace.querySelector("small");
  if (label) label.textContent = stagePlaced ? "Object placed" : "Place object";
  if (helper) helper.textContent = stagePlaced ? "tap to reposition" : "tap to settle";
  if (!stagePlaced) setStageMoveMode(true);
  else setStageMoveMode(false);
  playCue("place");
});

stageQuickLook.addEventListener("click", () => {
  arSessionStarted = true;
  arBecameHidden = false;
});

function pointerDistance() {
  const points = [...activePointers.values()];
  if (points.length < 2) return 0;
  return Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
}

stageMoveSurface.addEventListener("pointerdown", (event) => {
  stageMoveSurface.setPointerCapture(event.pointerId);
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (activePointers.size === 1) {
    gestureOrigin = { x: event.clientX, y: event.clientY, stageX, stageY, distance: 0, scale: stageScale };
  } else if (activePointers.size === 2) {
    gestureOrigin.distance = pointerDistance();
    gestureOrigin.scale = stageScale;
  }
});

stageMoveSurface.addEventListener("pointermove", (event) => {
  if (!activePointers.has(event.pointerId)) return;
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (activePointers.size === 1) {
    stageX = Math.max(-innerWidth * .38, Math.min(innerWidth * .38, gestureOrigin.stageX + event.clientX - gestureOrigin.x));
    stageY = Math.max(-innerHeight * .24, Math.min(innerHeight * .24, gestureOrigin.stageY + event.clientY - gestureOrigin.y));
  } else if (activePointers.size >= 2 && gestureOrigin.distance > 0) {
    stageScale = Math.max(.55, Math.min(1.8, gestureOrigin.scale * pointerDistance() / gestureOrigin.distance));
  }
  setStageTransform();
});

function releasePointer(event: PointerEvent) {
  activePointers.delete(event.pointerId);
  if (activePointers.size === 1) {
    const remaining = [...activePointers.values()][0];
    gestureOrigin = { x: remaining.x, y: remaining.y, stageX, stageY, distance: 0, scale: stageScale };
  }
}

stageMoveSurface.addEventListener("pointerup", releasePointer);
stageMoveSurface.addEventListener("pointercancel", releasePointer);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !cameraStage.hidden) closeStage();
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
