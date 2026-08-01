#!/usr/bin/python3
"""Wrap verified Met USDZ scans in a restrained animated gallery plinth.

Original USDZ files remain untouched. Generated *-gallery.usdz files add only:
- a slow, continuous turntable rotation around the scan;
- a neutral circular plinth with a thin metallic top trim.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

from pxr import Gf, Sdf, Usd, UsdGeom, UsdShade


ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "public" / "ar" / "met-3d"


def bind_material(stage: Usd.Stage, path: str, color: tuple[float, float, float], metallic: float, roughness: float):
    material = UsdShade.Material.Define(stage, f"{path}/Material")
    shader = UsdShade.Shader.Define(stage, f"{path}/Material/Surface")
    shader.CreateIdAttr("UsdPreviewSurface")
    shader.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(*color))
    shader.CreateInput("metallic", Sdf.ValueTypeNames.Float).Set(metallic)
    shader.CreateInput("roughness", Sdf.ValueTypeNames.Float).Set(roughness)
    shader.CreateOutput("surface", Sdf.ValueTypeNames.Token)
    material.CreateSurfaceOutput().ConnectToSource(shader.ConnectableAPI(), "surface")
    return material


def build(source: Path):
    slug = source.stem
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

        wrapper = work / "00-gallery.usda"
        stage = Usd.Stage.CreateNew(str(wrapper))
        stage.SetMetadata("metersPerUnit", 1.0)
        stage.SetMetadata("upAxis", "Y")
        stage.SetStartTimeCode(0)
        stage.SetEndTimeCode(864)
        stage.SetTimeCodesPerSecond(24)

        experience = UsdGeom.Xform.Define(stage, "/ARExperience")
        stage.SetDefaultPrim(experience.GetPrim())
        turntable = UsdGeom.Xform.Define(stage, "/ARExperience/Turntable")
        rotation = turntable.AddRotateYOp()
        rotation.Set(0, Usd.TimeCode(0))
        rotation.Set(360, Usd.TimeCode(864))
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
        dark = bind_material(stage, "/ARExperience/PlinthLook", (0.055, 0.06, 0.07), 0.08, 0.3)
        UsdShade.MaterialBindingAPI.Apply(base.GetPrim()).Bind(dark)

        trim = UsdGeom.Cylinder.Define(stage, "/ARExperience/Trim")
        trim.CreateAxisAttr("Y")
        trim.CreateRadiusAttr(radius * 0.965)
        trim.CreateHeightAttr(0.006)
        trim.AddTranslateOp().Set(Gf.Vec3d(center_x, minimum[1] + 0.003, center_z))
        metal = bind_material(stage, "/ARExperience/TrimLook", (0.24, 0.26, 0.29), 0.6, 0.22)
        UsdShade.MaterialBindingAPI.Apply(trim.GetPrim()).Bind(metal)
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
