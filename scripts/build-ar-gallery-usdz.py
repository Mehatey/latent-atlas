#!/usr/bin/python3
"""Wrap verified Met USDZ scans in a spatial Latent Atlas exhibit.

Original USDZ files remain untouched. Generated *-gallery.usdz files add only:
- a slow, continuous turntable rotation around the scan;
- a neutral circular plinth with a thin metallic top trim;
- a readable, front-facing object plaque and restrained atlas particles.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps
from pxr import Gf, Sdf, Usd, UsdGeom, UsdShade


ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "public" / "ar" / "met-3d"

WORKS = {
    "lion-sarcophagus": {
        "title": "Marble Sarcophagus with Lions Felling Antelope",
        "maker": "Roman",
        "date": "3rd century",
        "medium": "Marble",
        "object_id": "854888",
        "description": "Lions grasp antelope at either end of a Roman sarcophagus, now readable as a complete object in space.",
    },
    "nayarit-house": {
        "title": "House Model",
        "maker": "Nayarit artist(s)",
        "date": "200 BCE–300 CE",
        "medium": "Ceramic, slip",
        "object_id": "312581",
        "description": "A compact architectural world opens across two levels, preserving figures, food, shelter, and gathering.",
    },
    "aphrodite-eros": {
        "title": "Limestone Statue of Aphrodite Holding Winged Eros",
        "maker": "Cypriot",
        "date": "late 4th century BCE",
        "medium": "Limestone",
        "object_id": "242017",
        "description": "A frontal goddess, elaborate headdress, and small winged Eros become legible from every side.",
    },
    "ngya-post": {
        "title": "Ngya (Commemorative Post)",
        "maker": "Bongo artist",
        "date": "late 19th century",
        "medium": "Mahogany",
        "object_id": "309909",
        "description": "A tall commemorative form turns a single carved tree trunk into presence, memory, and social standing.",
    },
}

SERIF = Path("/System/Library/Fonts/NewYork.ttf")
SANS = Path("/System/Library/Fonts/SFNS.ttf")
MONO = Path("/System/Library/Fonts/SFNSMono.ttf")


def font(path: Path, size: int):
    return ImageFont.truetype(str(path), size=size)


def wrapped_lines(draw: ImageDraw.ImageDraw, copy: str, typeface, max_width: int, max_lines: int):
    words = copy.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if draw.textbbox((0, 0), candidate, font=typeface)[2] <= max_width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
            if len(lines) == max_lines - 1:
                break
    if current and len(lines) < max_lines:
        remaining = " ".join(words[sum(len(line.split()) for line in lines):])
        while draw.textbbox((0, 0), remaining, font=typeface)[2] > max_width and " " in remaining:
            remaining = remaining.rsplit(" ", 1)[0]
        if remaining != " ".join(words[sum(len(line.split()) for line in lines):]):
            remaining = remaining.rstrip(".,;:") + "…"
        lines.append(remaining)
    return lines


def make_label(work: dict[str, str], destination: Path):
    image = Image.new("RGB", (1200, 1500), (10, 11, 14))
    draw = ImageDraw.Draw(image)
    accent = (217, 255, 114)
    ink = (246, 246, 241)
    muted = (193, 196, 203)
    quiet = (124, 128, 138)

    draw.rectangle((72, 76, 92, 96), fill=accent)
    draw.text((122, 70), "LATENT ATLAS", font=font(MONO, 31), fill=accent)
    draw.text((122, 112), "OBJECT IN SPACE", font=font(MONO, 25), fill=quiet)

    title_font = font(SERIF, 94)
    title_lines = wrapped_lines(draw, work["title"], title_font, 1036, 4)
    y = 214
    for line in title_lines:
        draw.text((72, y), line, font=title_font, fill=ink)
        y += 106

    meta_y = y + 26
    draw.text((72, meta_y), work["maker"], font=font(SANS, 42), fill=ink)
    draw.text((72, meta_y + 62), f'{work["date"]}  ·  {work["medium"]}', font=font(SANS, 34), fill=muted)
    rule_y = meta_y + 132
    draw.line((72, rule_y, 1128, rule_y), fill=(63, 67, 76), width=2)

    body_font = font(SERIF, 45)
    body_lines = wrapped_lines(draw, work["description"], body_font, 1036, 4)
    body_y = rule_y + 52
    for line in body_lines:
        draw.text((72, body_y), line, font=body_font, fill=muted)
        body_y += 58

    draw.line((72, 1344, 1128, 1344), fill=(49, 52, 60), width=2)
    draw.text((72, 1390), "THE METROPOLITAN MUSEUM OF ART  /  OPEN ACCESS", font=font(MONO, 23), fill=quiet)
    object_copy = f'OBJECT {work["object_id"]}'
    object_width = draw.textbbox((0, 0), object_copy, font=font(MONO, 23))[2]
    draw.text((1128 - object_width, 1430), object_copy, font=font(MONO, 23), fill=quiet)
    destination.parent.mkdir(parents=True, exist_ok=True)
    # USD Preview Surface and Quick Look resolve this front-facing texture with
    # the opposite UV origin from Pillow. Bake the correction into the asset so
    # both triangles remain continuous and text stays upright.
    ImageOps.mirror(image.rotate(180)).save(destination, "PNG", optimize=True)


def bind_material(stage: Usd.Stage, path: str, color: tuple[float, float, float], metallic: float, roughness: float, emissive: tuple[float, float, float] | None = None):
    material = UsdShade.Material.Define(stage, f"{path}/Material")
    shader = UsdShade.Shader.Define(stage, f"{path}/Material/Surface")
    shader.CreateIdAttr("UsdPreviewSurface")
    shader.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(*color))
    shader.CreateInput("metallic", Sdf.ValueTypeNames.Float).Set(metallic)
    shader.CreateInput("roughness", Sdf.ValueTypeNames.Float).Set(roughness)
    if emissive:
        shader.CreateInput("emissiveColor", Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(*emissive))
    shader.CreateOutput("surface", Sdf.ValueTypeNames.Token)
    material.CreateSurfaceOutput().ConnectToSource(shader.ConnectableAPI(), "surface")
    return material


def bind_texture(stage: Usd.Stage, path: str, asset_name: str):
    material = UsdShade.Material.Define(stage, path)
    shader = UsdShade.Shader.Define(stage, f"{path}/Surface")
    shader.CreateIdAttr("UsdPreviewSurface")
    texture = UsdShade.Shader.Define(stage, f"{path}/Texture")
    texture.CreateIdAttr("UsdUVTexture")
    texture.CreateInput("file", Sdf.ValueTypeNames.Asset).Set(asset_name)
    reader = UsdShade.Shader.Define(stage, f"{path}/ST")
    reader.CreateIdAttr("UsdPrimvarReader_float2")
    reader.CreateInput("varname", Sdf.ValueTypeNames.String).Set("st")
    reader.CreateOutput("result", Sdf.ValueTypeNames.Float2)
    texture.CreateInput("st", Sdf.ValueTypeNames.Float2).ConnectToSource(reader.ConnectableAPI(), "result")
    texture.CreateOutput("rgb", Sdf.ValueTypeNames.Float3)
    shader.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).ConnectToSource(texture.ConnectableAPI(), "rgb")
    shader.CreateInput("roughness", Sdf.ValueTypeNames.Float).Set(0.72)
    shader.CreateOutput("surface", Sdf.ValueTypeNames.Token)
    material.CreateSurfaceOutput().ConnectToSource(shader.ConnectableAPI(), "surface")
    return material


def make_panel(stage: Usd.Stage, path: str, width: float, height: float, center: Gf.Vec3d, material: UsdShade.Material):
    mesh = UsdGeom.Mesh.Define(stage, path)
    x, y, z = center
    mesh.CreatePointsAttr([
        Gf.Vec3f(x - width / 2, y - height / 2, z),
        Gf.Vec3f(x + width / 2, y - height / 2, z),
        Gf.Vec3f(x + width / 2, y + height / 2, z),
        Gf.Vec3f(x - width / 2, y + height / 2, z),
    ])
    mesh.CreateFaceVertexCountsAttr([4])
    mesh.CreateFaceVertexIndicesAttr([0, 1, 2, 3])
    mesh.CreateDoubleSidedAttr(False)
    mesh.CreateSubdivisionSchemeAttr(UsdGeom.Tokens.none)
    mesh.CreateNormalsAttr([Gf.Vec3f(0, 0, 1)])
    mesh.SetNormalsInterpolation(UsdGeom.Tokens.constant)
    st = UsdGeom.PrimvarsAPI(mesh).CreatePrimvar("st", Sdf.ValueTypeNames.TexCoord2fArray, UsdGeom.Tokens.vertex)
    st.Set([Gf.Vec2f(0, 1), Gf.Vec2f(1, 1), Gf.Vec2f(1, 0), Gf.Vec2f(0, 0)])
    UsdShade.MaterialBindingAPI.Apply(mesh.GetPrim()).Bind(material)
    return mesh


def build(source: Path):
    slug = source.stem
    work_info = WORKS[slug]
    destination = source.with_name(f"{slug}-gallery.usdz")
    work = Path(tempfile.mkdtemp(prefix=f"latent-{slug}-", dir="/tmp"))
    try:
        with zipfile.ZipFile(source) as archive:
            archive.extractall(work)
        model_layer = next(work.glob("*.usdc"))
        source_stage = Usd.Stage.Open(str(model_layer))
        default_prim = source_stage.GetDefaultPrim()
        bbox = UsdGeom.BBoxCache(
            Usd.TimeCode.Default(),
            [UsdGeom.Tokens.default_, UsdGeom.Tokens.render],
        ).ComputeWorldBound(default_prim).ComputeAlignedRange()
        minimum = bbox.GetMin()
        maximum = bbox.GetMax()
        span_x = maximum[0] - minimum[0]
        span_y = maximum[1] - minimum[1]
        span_z = maximum[2] - minimum[2]
        center_x = (minimum[0] + maximum[0]) / 2
        center_z = (minimum[2] + maximum[2]) / 2
        radius = ((span_x / 2) ** 2 + (span_z / 2) ** 2) ** 0.5 * 1.08
        base_height = max(0.025, min(0.08, span_y * 0.045))
        label_width = max(0.36, min(0.72, max(span_x * 0.28, span_y * 0.32)))
        label_height = label_width * (1500 / 1200)
        label_x = maximum[0] + label_width * 0.62
        label_bottom = minimum[1] + max(base_height + 0.03, span_y * 0.12)
        label_y = label_bottom + label_height / 2
        label_z = maximum[2] + max(0.018, radius * 0.025)
        label_path = work / "object-label.png"
        make_label(work_info, label_path)

        wrapper = work / "00-gallery.usda"
        stage = Usd.Stage.CreateNew(str(wrapper))
        stage.SetMetadata("metersPerUnit", 1.0)
        stage.SetMetadata("upAxis", "Y")
        stage.SetStartTimeCode(0)
        stage.SetEndTimeCode(240)
        stage.SetTimeCodesPerSecond(24)

        experience = UsdGeom.Xform.Define(stage, "/ARExperience")
        stage.SetDefaultPrim(experience.GetPrim())
        turntable = UsdGeom.Xform.Define(stage, "/ARExperience/Turntable")
        rotation = turntable.AddRotateYOp()
        rotation.Set(0, Usd.TimeCode(0))
        rotation.Set(360, Usd.TimeCode(240))
        scan = UsdGeom.Xform.Define(stage, "/ARExperience/Turntable/Scan")
        scan.GetPrim().GetReferences().AddReference(
            f"./{model_layer.name}",
            default_prim.GetPath(),
        )

        base = UsdGeom.Cylinder.Define(stage, "/ARExperience/Plinth")
        base.CreateAxisAttr("Y")
        base.CreateRadiusAttr(radius)
        base.CreateHeightAttr(base_height)
        base.AddTranslateOp().Set(Gf.Vec3d(center_x, minimum[1] - base_height / 2, center_z))
        dark = bind_material(stage, "/ARExperience/PlinthLook", (0.018, 0.021, 0.027), 0.0, 0.82)
        UsdShade.MaterialBindingAPI.Apply(base.GetPrim()).Bind(dark)

        trim = UsdGeom.Cylinder.Define(stage, "/ARExperience/Trim")
        trim.CreateAxisAttr("Y")
        trim.CreateRadiusAttr(radius * 0.965)
        trim.CreateHeightAttr(0.006)
        trim.AddTranslateOp().Set(Gf.Vec3d(center_x, minimum[1] + 0.003, center_z))
        metal = bind_material(stage, "/ARExperience/TrimLook", (0.24, 0.26, 0.29), 0.6, 0.22)
        UsdShade.MaterialBindingAPI.Apply(trim.GetPrim()).Bind(metal)

        label_material = bind_texture(stage, "/ARExperience/ObjectPlaque/LabelLook", label_path.name)
        make_panel(stage, "/ARExperience/ObjectPlaque/Label", label_width, label_height, Gf.Vec3d(label_x, label_y, label_z), label_material)

        stem = UsdGeom.Cylinder.Define(stage, "/ARExperience/ObjectPlaque/Stem")
        stem.CreateAxisAttr("Y")
        stem.CreateRadiusAttr(max(0.004, label_width * 0.012))
        stem.CreateHeightAttr(max(0.03, label_y - label_height / 2 - minimum[1]))
        stem.AddTranslateOp().Set(Gf.Vec3d(label_x, minimum[1] + stem.GetHeightAttr().Get() / 2, label_z - 0.012))
        UsdShade.MaterialBindingAPI.Apply(stem.GetPrim()).Bind(metal)

        particles = UsdGeom.Xform.Define(stage, "/ARExperience/AtlasOrbit")
        orbit_rotation = particles.AddRotateYOp()
        orbit_rotation.Set(0, Usd.TimeCode(0))
        orbit_rotation.Set(-360, Usd.TimeCode(240))
        particle_look = bind_material(stage, "/ARExperience/ParticleLook", (0.52, 0.66, 0.22), 0.1, 0.35, (0.08, 0.12, 0.015))
        particle_ring = max(radius * 0.78, span_x * 0.48)
        for index, (dx, dz, lift) in enumerate([
            (-0.82, -0.32, 0.18), (-0.48, 0.72, 0.35), (-0.12, -0.9, 0.54),
            (0.34, 0.83, 0.26), (0.68, -0.58, 0.45), (0.92, 0.14, 0.31),
        ]):
            tile = UsdGeom.Cube.Define(stage, f"/ARExperience/AtlasOrbit/Node{index + 1}")
            tile.CreateSizeAttr(1)
            size = max(0.012, min(0.032, max(span_y, radius) * 0.022))
            tile.AddScaleOp().Set(Gf.Vec3d(size * 1.45, size, size * 0.18))
            tile.AddTranslateOp().Set(Gf.Vec3d(center_x + dx * particle_ring, minimum[1] + base_height + lift * span_y, center_z + dz * particle_ring))
            UsdShade.MaterialBindingAPI.Apply(tile.GetPrim()).Bind(particle_look)
        stage.GetRootLayer().Save()

        subprocess.run(
            ["/usr/bin/usdzip", "--arkitAsset", wrapper.name, str(destination)],
            cwd=work,
            check=True,
        )
        subprocess.run(["/usr/bin/usdchecker", "--arkit", str(destination)], check=True)
        print(f"built {destination.name} ({destination.stat().st_size / 1024 / 1024:.1f} MB)")
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    for usdz in sorted(MODEL_DIR.glob("*.usdz")):
        if not usdz.name.endswith("-gallery.usdz"):
            build(usdz)
