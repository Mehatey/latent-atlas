import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

type Work = {
  id: number;
  title: string;
  artist: string;
  date: string;
  medium: string;
  description: string;
  source: string;
  slug: string;
};

const root = path.resolve("public/ar");
const modelDir = path.join(root, "models");
const imageDir = path.join(root, "artworks");
const sourceDir = path.resolve("ar-source/usdz");
const gatewayDir = path.join(root, "gateway");

const works: Work[] = [
  {
    id: 10481,
    slug: "heart-of-the-andes",
    title: "Heart of the Andes",
    artist: "Frederic Edwin Church",
    date: "1859",
    medium: "Oil on canvas",
    description: "A panoramic landscape compressing tropical ecologies into one imagined journey.",
    source: "https://images.metmuseum.org/CRDImages/ad/original/DT78.jpg",
  },
  {
    id: 436532,
    slug: "self-portrait",
    title: "Self-Portrait with a Straw Hat",
    artist: "Vincent van Gogh",
    date: "1887",
    medium: "Oil on canvas",
    description: "Directional strokes turn the artist’s face into a field of color and motion.",
    source: "https://images.metmuseum.org/CRDImages/ep/original/DT1502_cropped2.jpg",
  },
  {
    id: 435904,
    slug: "vanitas",
    title: "Still Life with a Skull and a Writing Quill",
    artist: "Pieter Claesz",
    date: "1628",
    medium: "Oil on wood",
    description: "A vanitas: time, knowledge, and mortality held inside a small frame.",
    source: "https://images.metmuseum.org/CRDImages/ep/original/DP145929.jpg",
  },
  {
    id: 250945,
    slug: "perseus-and-andromeda",
    title: "Perseus and Andromeda in Landscape",
    artist: "Unknown Roman artist",
    date: "1st century BCE",
    medium: "Fresco",
    description: "Myth unfolds inside a Roman landscape painted for an imperial villa.",
    source: "https://images.metmuseum.org/CRDImages/gr/original/DP138761.jpg",
  },
  {
    id: 435882,
    slug: "cezanne-primroses",
    title: "Still Life with Apples and a Pot of Primroses",
    artist: "Paul Cézanne",
    date: "ca. 1890",
    medium: "Oil on canvas",
    description: "Apples, cloth, and flowers become a study in unstable perspective and balanced weight.",
    source: "https://images.metmuseum.org/CRDImages/ep/original/DT47.jpg",
  },
  {
    id: 437397,
    slug: "rembrandt-self-portrait",
    title: "Self-Portrait",
    artist: "Rembrandt van Rijn",
    date: "1660",
    medium: "Oil on canvas",
    description: "A late self-portrait built from direct light, worked paint, and an unguarded gaze.",
    source: "https://images.metmuseum.org/CRDImages/ep/original/DP-16323-001.jpg",
  },
  {
    id: 435702,
    slug: "horse-fair",
    title: "The Horse Fair",
    artist: "Rosa Bonheur",
    date: "1852–55",
    medium: "Oil on canvas",
    description: "A turning mass of horses and handlers makes physical force visible across the canvas.",
    source: "https://images.metmuseum.org/CRDImages/ep/original/DP-23550-001.jpg",
  },
  {
    id: 11951,
    slug: "nydia",
    title: "Nydia, the Blind Flower Girl of Pompeii",
    artist: "Randolph Rogers",
    date: "1853–54; carved 1859",
    medium: "Marble",
    description: "A marble figure listens through the imagined darkness of Pompeii’s final hours.",
    source: "https://images.metmuseum.org/CRDImages/ad/original/DP340535.jpg",
  },
];

const align4 = (n: number) => (n + 3) & ~3;
const xml = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function plaqueSvg(work: Work) {
  const title = work.title.length > 38
    ? [work.title.slice(0, work.title.lastIndexOf(" ", 38)), work.title.slice(work.title.lastIndexOf(" ", 38) + 1)]
    : [work.title];
  return Buffer.from(`
    <svg width="1100" height="760" xmlns="http://www.w3.org/2000/svg">
      <rect x="30" y="30" width="1040" height="700" rx="56" fill="#0c0c0f" fill-opacity=".56" stroke="#f3eee4" stroke-opacity=".18" stroke-width="2"/>
      <text x="78" y="112" fill="#cbbfa9" font-family="Arial, sans-serif" font-size="25" letter-spacing="5">LATENT ATLAS / MET OPEN ACCESS</text>
      ${title.map((line, i) => `<text x="78" y="${210 + i * 64}" fill="#f3eee4" font-family="Georgia, serif" font-size="54">${xml(line)}</text>`).join("")}
      <text x="78" y="${title.length > 1 ? 374 : 312}" fill="#d8cebb" font-family="Arial, sans-serif" font-size="28">${xml(work.artist)} · ${xml(work.date)}</text>
      <text x="78" y="${title.length > 1 ? 422 : 360}" fill="#8f897f" font-family="Arial, sans-serif" font-size="24">${xml(work.medium)}</text>
      <line x1="78" y1="${title.length > 1 ? 470 : 408}" x2="1022" y2="${title.length > 1 ? 470 : 408}" stroke="#d8cebb" stroke-opacity=".22"/>
      <text x="78" y="${title.length > 1 ? 540 : 478}" fill="#d8cebb" font-family="Georgia, serif" font-size="31">${xml(work.description.slice(0, 58))}</text>
      <text x="78" y="${title.length > 1 ? 588 : 526}" fill="#d8cebb" font-family="Georgia, serif" font-size="31">${xml(work.description.slice(58))}</text>
      <text x="78" y="670" fill="#77736c" font-family="Arial, sans-serif" font-size="21" letter-spacing="2">CC0 · THE METROPOLITAN MUSEUM OF ART · OBJECT ${work.id}</text>
    </svg>`);
}

function addChunk(chunks: Buffer[], data: Buffer) {
  const offset = chunks.reduce((n, c) => n + c.length, 0);
  chunks.push(data);
  const pad = align4(data.length) - data.length;
  if (pad) chunks.push(Buffer.alloc(pad));
  return { byteOffset: offset, byteLength: data.length };
}

function boxGeometry(width: number, height: number, depth: number, cx: number, cy: number, cz: number) {
  const x0 = cx - width / 2, x1 = cx + width / 2;
  const y0 = cy - height / 2, y1 = cy + height / 2;
  const z0 = cz - depth / 2, z1 = cz + depth / 2;
  const faces = [
    [[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1],[0,0,1]],
    [[x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0],[0,0,-1]],
    [[x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[1,0,0]],
    [[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0],[-1,0,0]],
    [[x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0],[0,1,0]],
    [[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1],[0,-1,0]],
  ] as number[][][];
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (const face of faces) {
    const base = positions.length / 3;
    for (let i = 0; i < 4; i++) {
      positions.push(...face[i]);
      normals.push(...face[4]);
      uvs.push(...[[0,0],[1,0],[1,1],[0,1]][i]);
    }
    indices.push(base,base+1,base+2,base,base+2,base+3);
  }
  return { positions, normals, uvs, indices };
}

function planeGeometry(width: number, height: number, cx: number, cy: number, z: number) {
  return {
    positions: [cx-width/2,cy-height/2,z, cx+width/2,cy-height/2,z, cx+width/2,cy+height/2,z, cx-width/2,cy+height/2,z],
    normals: [0,0,1, 0,0,1, 0,0,1, 0,0,1],
    uvs: [0,1, 1,1, 1,0, 0,0],
    indices: [0,1,2,0,2,3],
  };
}

async function makeGlb(work: Work, art: Buffer, plaque: Buffer, aspect: number) {
  const artHeight = aspect > 1.7 ? .7 : .9;
  const artWidth = artHeight * aspect;
  const plaqueWidth = .61, plaqueHeight = .422, gap = .08;
  const total = artWidth + gap + plaqueWidth;
  const artX = -total / 2 + artWidth / 2;
  const plaqueX = total / 2 - plaqueWidth / 2;
  const geometries = [
    planeGeometry(artWidth, artHeight, artX, 0, 0),
    planeGeometry(plaqueWidth, plaqueHeight, plaqueX, 0, 0),
  ];
  const chunks: Buffer[] = [];
  const bufferViews: any[] = [];
  const accessors: any[] = [];
  const primitives: any[] = [];
  const componentType = { float: 5126, ushort: 5123 };
  const addAccessor = (values: number[], type: string, components: number, target: number, isIndex = false) => {
    const raw = isIndex
      ? Buffer.from(new Uint16Array(values).buffer)
      : Buffer.from(new Float32Array(values).buffer);
    const view = addChunk(chunks, raw);
    const bv = bufferViews.push({ buffer: 0, ...view, target }) - 1;
    const count = values.length / components;
    const acc: any = { bufferView: bv, componentType: isIndex ? componentType.ushort : componentType.float, count, type };
    if (type === "VEC3" && !isIndex) {
      const rows = Array.from({length: count}, (_,i)=>values.slice(i*3,i*3+3));
      acc.min = [0,1,2].map(j=>Math.min(...rows.map(r=>r[j])));
      acc.max = [0,1,2].map(j=>Math.max(...rows.map(r=>r[j])));
    }
    return accessors.push(acc) - 1;
  };
  geometries.forEach((g, i) => {
    primitives.push({
      attributes: {
        POSITION: addAccessor(g.positions, "VEC3", 3, 34962),
        NORMAL: addAccessor(g.normals, "VEC3", 3, 34962),
        TEXCOORD_0: addAccessor(g.uvs, "VEC2", 2, 34962),
      },
      indices: addAccessor(g.indices, "SCALAR", 1, 34963, true),
      material: i,
    });
  });
  const artView = addChunk(chunks, art);
  const artBufferView = bufferViews.push({ buffer: 0, ...artView }) - 1;
  const plaqueView = addChunk(chunks, plaque);
  const plaqueBufferView = bufferViews.push({ buffer: 0, ...plaqueView }) - 1;
  const binary = Buffer.concat(chunks);
  const gltf = {
    asset: { version: "2.0", generator: "LATENT ATLAS AR builder" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: work.title }],
    meshes: [{ primitives }],
    materials: [
      { name: "Artwork", pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: .72 } },
      {
        name: "Label",
        alphaMode: "BLEND",
        doubleSided: true,
        pbrMetallicRoughness: { baseColorTexture: { index: 1 }, metallicFactor: 0, roughnessFactor: .9 },
      },
    ],
    textures: [{ source: 0 }, { source: 1 }],
    samplers: [{}],
    images: [
      { bufferView: artBufferView, mimeType: "image/jpeg" },
      { bufferView: plaqueBufferView, mimeType: "image/png" },
    ],
    accessors,
    bufferViews,
    buffers: [{ byteLength: binary.length }],
  };
  const json = Buffer.from(JSON.stringify(gltf));
  const jsonPad = Buffer.concat([json, Buffer.alloc(align4(json.length)-json.length, 0x20)]);
  const totalLength = 12 + 8 + jsonPad.length + 8 + binary.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(totalLength, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonPad.length, 0); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binary.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  await writeFile(path.join(modelDir, `${work.slug}.glb`), Buffer.concat([header,jsonHeader,jsonPad,binHeader,binary]));
  return { artWidth, artHeight, artX, plaqueWidth, plaqueHeight, plaqueX };
}

function usda(work: Work, g: Awaited<ReturnType<typeof makeGlb>>) {
  const mesh = (name: string, width: number, height: number, x: number, z: number, material: string) => `
    def Mesh "${name}" (
      prepend apiSchemas = ["MaterialBindingAPI"]
    ) {
      uniform token subdivisionScheme = "none"
      int[] faceVertexCounts = [4]
      int[] faceVertexIndices = [0, 1, 2, 3]
      point3f[] points = [(${x-width/2}, ${-height/2}, ${z}), (${x+width/2}, ${-height/2}, ${z}), (${x+width/2}, ${height/2}, ${z}), (${x-width/2}, ${height/2}, ${z})]
      normal3f[] normals = [(0,0,1)]
      uniform token normals:interpolation = "constant"
      texCoord2f[] primvars:st = [(0,0),(1,0),(1,1),(0,1)] (interpolation = "vertex")
      rel material:binding = </AR/${material}>
    }`;
  return `#usda 1.0
(
  defaultPrim = "AR"
  metersPerUnit = 1
  upAxis = "Y"
  startTimeCode = 0
  endTimeCode = 180
  timeCodesPerSecond = 30
)
def Xform "AR" {
  double3 xformOp:translate.timeSamples = {
    0: (0, 0, 0), 30: (0, .004, 0), 60: (0, .014, 0), 90: (0, .018, 0),
    120: (0, .014, 0), 150: (0, .004, 0), 180: (0, 0, 0)
  }
  float xformOp:rotateY.timeSamples = {
    0: -1.4, 30: -1.05, 60: -.35, 90: 1.4,
    120: -.35, 150: -1.05, 180: -1.4
  }
  uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:rotateY"]
  ${mesh("Artwork", g.artWidth, g.artHeight, g.artX, 0, "ArtworkMaterial")}
  ${mesh("Label", g.plaqueWidth, g.plaqueHeight, g.plaqueX, 0, "LabelMaterial")}
  def Material "ArtworkMaterial" {
    token outputs:surface.connect = </AR/ArtworkMaterial/Surface.outputs:surface>
    def Shader "Surface" {
      uniform token info:id = "UsdPreviewSurface"
      color3f inputs:diffuseColor.connect = </AR/ArtworkMaterial/Texture.outputs:rgb>
      float inputs:roughness = .72
      token outputs:surface
    }
    def Shader "Texture" {
      uniform token info:id = "UsdUVTexture"
      asset inputs:file = @artwork.jpg@
      float2 inputs:st.connect = </AR/ArtworkMaterial/ST.outputs:result>
      token outputs:rgb
    }
    def Shader "ST" {
      uniform token info:id = "UsdPrimvarReader_float2"
      string inputs:varname = "st"
      float2 outputs:result
    }
  }
  def Material "LabelMaterial" {
    token outputs:surface.connect = </AR/LabelMaterial/Surface.outputs:surface>
    def Shader "Surface" {
      uniform token info:id = "UsdPreviewSurface"
      color3f inputs:diffuseColor.connect = </AR/LabelMaterial/Texture.outputs:rgb>
      float inputs:opacity.connect = </AR/LabelMaterial/Texture.outputs:a>
      float inputs:opacityThreshold = .01
      float inputs:roughness = .9
      token outputs:surface
    }
    def Shader "Texture" {
      uniform token info:id = "UsdUVTexture"
      asset inputs:file = @label.png@
      float2 inputs:st.connect = </AR/LabelMaterial/ST.outputs:result>
      float outputs:a
      token outputs:rgb
    }
    def Shader "ST" {
      uniform token info:id = "UsdPrimvarReader_float2"
      string inputs:varname = "st"
      float2 outputs:result
    }
  }
}`;
}

await Promise.all([
  mkdir(modelDir,{recursive:true}),
  mkdir(imageDir,{recursive:true}),
  mkdir(sourceDir,{recursive:true}),
  mkdir(gatewayDir,{recursive:true}),
]);
await Promise.all([
  copyFile("FINAL-PORTFOLIO-MEDIA/cover-1920x1080.png", path.join(gatewayDir, "atlas-cover.png")),
  copyFile("FINAL-PORTFOLIO-MEDIA/module-01-atlas-formation-web.mp4", path.join(gatewayDir, "atlas-formation.mp4")),
]);

for (const work of works) {
  const response = await fetch(work.source);
  if (!response.ok) throw new Error(`Could not fetch ${work.source}: ${response.status}`);
  const original = Buffer.from(await response.arrayBuffer());
  const image = sharp(original).rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) throw new Error(`No dimensions for ${work.title}`);
  const art = await image.jpeg({ quality: 92, chromaSubsampling: "4:4:4" }).toBuffer();
  const thumb = await sharp(art)
    .resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
  const plaque = await sharp(plaqueSvg(work)).png().toBuffer();
  await writeFile(path.join(imageDir, `${work.slug}.jpg`), art);
  await writeFile(path.join(imageDir, `${work.slug}-thumb.webp`), thumb);
  await writeFile(path.join(imageDir, `${work.slug}-label.png`), plaque);
  const g = await makeGlb(work, art, plaque, metadata.width / metadata.height);
  const staging = path.join(sourceDir, work.slug);
  await mkdir(staging, { recursive: true });
  await writeFile(path.join(staging, "scene.usda"), usda(work, g));
  await writeFile(path.join(staging, "artwork.jpg"), art);
  await writeFile(path.join(staging, "label.png"), plaque);
}

await writeFile(path.join(root, "works.json"), JSON.stringify(works, null, 2));
console.log(`Built ${works.length} verified Met Open Access AR scenes.`);
