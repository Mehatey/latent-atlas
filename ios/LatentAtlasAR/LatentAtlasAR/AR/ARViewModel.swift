import ARKit
import Combine
import RealityKit
import simd
import SwiftUI
import UIKit

@MainActor
final class ARViewModel: ObservableObject {
    enum Phase: Equatable {
        case scanning
        case loading
        case ready
        case placed
        case failed(String)
    }

    @Published private(set) var currentIndex = 0
    @Published private(set) var phase: Phase = .scanning
    @Published var showsInfo = true
    @Published var showsRelated = false
    @Published var autoRotate = true
    @Published var selectedRelated: RelatedArtwork?
    @Published private(set) var statusMessage = "Move slowly to find a horizontal surface"

    let artworks = AtlasArtwork.collection

    var currentArtwork: AtlasArtwork { artworks[currentIndex] }
    var hasPlacementSurface: Bool { phase == .ready || phase == .placed }

    private weak var arView: ARView?
    private var loadedEntity: Entity?
    private var placedRoot: ModelEntity?
    private var anchor: AnchorEntity?
    private var loadCancellable: AnyCancellable?
    private var updateCancellable: Cancellable?

    func attach(to view: ARView) {
        arView = view
        updateCancellable = view.scene.subscribe(to: SceneEvents.Update.self) { [weak self] event in
            Task { @MainActor in
                guard let self, self.autoRotate, self.phase == .placed, let root = self.placedRoot else { return }
                let angle = Float(event.deltaTime) * 0.14
                root.transform.rotation = simd_quatf(angle: angle, axis: [0, 1, 0]) * root.transform.rotation
            }
        }
        loadCurrentArtwork()
    }

    func planeDetected() {
        guard phase == .scanning else { return }
        phase = loadedEntity == nil ? .loading : .ready
        statusMessage = loadedEntity == nil ? "Surface found · preparing object" : "Surface found · ready to place"
    }

    func trackingFailed() {
        statusMessage = "Camera tracking interrupted. Move to a brighter area."
    }

    func previous() { select(index: currentIndex - 1) }
    func next() { select(index: currentIndex + 1) }

    func select(index: Int) {
        currentIndex = (index + artworks.count) % artworks.count
        selectedRelated = nil
        showsRelated = false
        removePlacedObject()
        loadCurrentArtwork()
    }

    func loadCurrentArtwork() {
        phase = .loading
        statusMessage = "Loading \(currentArtwork.title)"
        loadedEntity = nil
        loadCancellable?.cancel()

        guard let url = resourceURL(for: currentArtwork.modelFilename) else {
            phase = .failed("The bundled 3D model could not be found.")
            statusMessage = "Model unavailable"
            return
        }

        loadCancellable = Entity.loadAsync(contentsOf: url)
            .receive(on: RunLoop.main)
            .sink { [weak self] completion in
                guard let self else { return }
                if case .failure = completion {
                    self.phase = .failed("The 3D model could not be decoded.")
                    self.statusMessage = "Could not load model"
                }
            } receiveValue: { [weak self] entity in
                guard let self else { return }
                self.loadedEntity = entity
                let hasPlane = self.arView?.session.currentFrame?.anchors.contains(where: { $0 is ARPlaneAnchor }) == true
                self.phase = hasPlane ? .ready : .scanning
                self.statusMessage = hasPlane ? "Surface found · ready to place" : "Model ready · keep scanning"
            }
    }

    func place() {
        guard let arView, let loadedEntity else {
            statusMessage = "Model is still loading"
            return
        }
        guard let result = arView.raycast(
            from: arView.center,
            allowing: .estimatedPlane,
            alignment: .horizontal
        ).first else {
            statusMessage = "Aim at a clear floor or table"
            UINotificationFeedbackGenerator().notificationOccurred(.warning)
            return
        }

        removePlacedObject()
        let root = ModelEntity()
        let bounds = loadedEntity.visualBounds(relativeTo: loadedEntity)
        let extent = simd_max(bounds.extents, SIMD3<Float>(repeating: 0.04))
        loadedEntity.position = [-bounds.center.x, -bounds.min.y, -bounds.center.z]
        root.addChild(loadedEntity)
        root.components.set(CollisionComponent(shapes: [
            ShapeResource.generateBox(size: extent)
                .offsetBy(translation: [0, extent.y / 2, 0])
        ]))

        let anchor = AnchorEntity(world: result.worldTransform)
        anchor.addChild(root)
        arView.scene.addAnchor(anchor)
        arView.installGestures([.translation, .rotation, .scale], for: root)
        self.anchor = anchor
        placedRoot = root
        self.loadedEntity = nil
        phase = .placed
        statusMessage = "Placed · drag, rotate, pinch, or walk around"
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    func resetPlacement() {
        removePlacedObject()
        loadCurrentArtwork()
        statusMessage = "Move slowly to place again"
    }

    func retry() { loadCurrentArtwork() }

    private func removePlacedObject() {
        anchor?.removeFromParent()
        anchor = nil
        placedRoot = nil
    }

    private func resourceURL(for filename: String) -> URL? {
        Bundle.main.url(forResource: filename, withExtension: nil, subdirectory: "Resources/Models")
            ?? Bundle.main.url(forResource: filename, withExtension: nil, subdirectory: "Models")
            ?? Bundle.main.url(forResource: filename, withExtension: nil)
    }
}
