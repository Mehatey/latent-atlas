# Latent Atlas AR — iPhone app

Native SwiftUI + RealityKit extension of Latent Atlas. Four verified Met Open Access scans are bundled with persistent camera UI, semantic neighbors, smooth turntable motion, spatial placement, gestures, and direct Met records.

## Install on an iPhone

1. Install the full Xcode app from the Mac App Store.
2. Open `LatentAtlasAR.xcodeproj`.
3. Connect and unlock the iPhone; accept **Trust This Computer**.
4. Select the `LatentAtlasAR` target → **Signing & Capabilities** → select your Apple ID team.
5. If the bundle identifier is unavailable, replace `com.siddharthmehta.latentatlasar` with a unique reverse-domain identifier.
6. Select the connected iPhone as the run destination and press **Run**.
7. If requested, enable **Developer Mode** under iPhone Settings → Privacy & Security, restart, and run again.

The app requires iOS 17 or later and an ARKit-compatible iPhone. AR camera behavior cannot be meaningfully tested in Simulator; use a physical device.

## Interaction

- Move slowly until the native coaching overlay finds a horizontal surface.
- Tap **Place in Space**.
- Drag to move, twist to rotate, pinch to scale, or walk around the object.
- Toggle automatic rotation from the `rotate.3d` control.
- Use the arrows to change verified scans.
- Open **Related** for six persistent semantic neighbors from the Latent Atlas embedding.
- Every primary and related work links to its Met collection record.

## Provenance

Object metadata and images: The Metropolitan Museum of Art Open Access / CC0. The four bundled USDZ files are verified Met 3D scans wrapped with a neutral generated plinth and non-destructive turntable animation. Original scan materials are unchanged.
