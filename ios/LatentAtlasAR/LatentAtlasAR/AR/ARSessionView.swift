import ARKit
import RealityKit
import SwiftUI

struct ARSessionView: UIViewRepresentable {
    @ObservedObject var viewModel: ARViewModel

    func makeCoordinator() -> Coordinator {
        Coordinator(viewModel: viewModel)
    }

    func makeUIView(context: Context) -> ARView {
        let view = ARView(frame: .zero, cameraMode: .ar, automaticallyConfigureSession: false)
        view.session.delegate = context.coordinator
        view.environment.sceneUnderstanding.options.insert([.occlusion, .receivesLighting])
        view.renderOptions.insert(.disableMotionBlur)

        let configuration = ARWorldTrackingConfiguration()
        configuration.planeDetection = [.horizontal]
        configuration.environmentTexturing = .automatic
        if ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
            configuration.sceneReconstruction = .mesh
        }
        view.session.run(configuration, options: [.resetTracking, .removeExistingAnchors])

        let coaching = ARCoachingOverlayView()
        coaching.session = view.session
        coaching.goal = .horizontalPlane
        coaching.activatesAutomatically = true
        coaching.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(coaching)
        NSLayoutConstraint.activate([
            coaching.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            coaching.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            coaching.topAnchor.constraint(equalTo: view.topAnchor),
            coaching.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        viewModel.attach(to: view)
        return view
    }

    func updateUIView(_ uiView: ARView, context: Context) {}

    final class Coordinator: NSObject, ARSessionDelegate {
        private let viewModel: ARViewModel

        init(viewModel: ARViewModel) {
            self.viewModel = viewModel
        }

        func session(_ session: ARSession, didAdd anchors: [ARAnchor]) {
            guard anchors.contains(where: { $0 is ARPlaneAnchor }) else { return }
            Task { @MainActor in viewModel.planeDetected() }
        }

        func session(_ session: ARSession, didFailWithError error: Error) {
            Task { @MainActor in viewModel.trackingFailed() }
        }
    }
}
