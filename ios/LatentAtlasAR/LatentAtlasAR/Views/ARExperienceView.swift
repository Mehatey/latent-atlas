import SwiftUI

struct ARExperienceView: View {
    @StateObject private var viewModel = ARViewModel()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            ARSessionView(viewModel: viewModel)
                .ignoresSafeArea()

            LinearGradient(
                colors: [.black.opacity(0.58), .clear, .black.opacity(0.28)],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
            .allowsHitTesting(false)

            VStack(spacing: 12) {
                header
                Spacer(minLength: 12)
                placementGuide
                Spacer(minLength: 12)
                if viewModel.showsRelated {
                    RelatedWorksShelf(
                        works: viewModel.currentArtwork.related,
                        selection: $viewModel.selectedRelated
                    )
                    .frame(maxHeight: 250)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
                }
                objectPanel
                placementControls
            }
            .padding(.horizontal, 14)
            .padding(.top, 8)
            .padding(.bottom, 8)
        }
        .tint(Color(red: 0.85, green: 1, blue: 0.45))
        .statusBarHidden(false)
        .onAppear {
            if reduceMotion { viewModel.autoRotate = false }
        }
        .animation(reduceMotion ? nil : .snappy(duration: 0.22), value: viewModel.showsInfo)
        .animation(reduceMotion ? nil : .snappy(duration: 0.24), value: viewModel.showsRelated)
    }

    private var header: some View {
        HStack(spacing: 12) {
            Text("Latent Atlas")
                .font(.title3.weight(.semibold))
                .accessibilityAddTraits(.isHeader)
            Spacer()
            HStack(spacing: 6) {
                Circle()
                    .fill(statusColor)
                    .frame(width: 8, height: 8)
                Text(viewModel.statusMessage)
                    .font(.caption.weight(.medium))
                    .lineLimit(1)
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(.thinMaterial, in: Capsule())
        }
    }

    @ViewBuilder
    private var placementGuide: some View {
        if viewModel.phase != .placed {
            VStack(spacing: 10) {
                Image(systemName: viewModel.hasPlacementSurface ? "viewfinder.circle.fill" : "viewfinder.circle")
                    .font(.system(size: 48, weight: .light))
                    .symbolEffect(.pulse, options: .repeating, isActive: !reduceMotion && !viewModel.hasPlacementSurface)
                Text(viewModel.hasPlacementSurface ? "Aim, then place" : "Find a surface")
                    .font(.headline)
                Text("Move slowly across a well-lit floor or table")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .padding(16)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .accessibilityElement(children: .combine)
        }
    }

    private var objectPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 5) {
                    Label("Verified Met 3D scan", systemImage: "checkmark.seal.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Color.accentColor)
                    Text(viewModel.currentArtwork.title)
                        .font(.title3.weight(.semibold))
                        .lineLimit(3)
                    Text("\(viewModel.currentArtwork.maker) · \(viewModel.currentArtwork.date) · \(viewModel.currentArtwork.medium)")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                Spacer(minLength: 8)
                Text("\(viewModel.currentIndex + 1) / \(viewModel.artworks.count)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }

            if viewModel.showsInfo {
                Text(viewModel.currentArtwork.description)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
                    .transition(.opacity)
            }

            HStack(spacing: 8) {
                controlButton("Info", systemImage: "info.circle", isActive: viewModel.showsInfo) {
                    viewModel.showsInfo.toggle()
                }
                controlButton("Related", systemImage: "point.3.connected.trianglepath.dotted", isActive: viewModel.showsRelated) {
                    viewModel.showsRelated.toggle()
                }
                controlButton("Rotate", systemImage: "rotate.3d", isActive: viewModel.autoRotate) {
                    viewModel.autoRotate.toggle()
                }
                Spacer()
                Link(destination: viewModel.currentArtwork.metURL) {
                    Label("View at The Met", systemImage: "arrow.up.right")
                        .font(.subheadline.weight(.semibold))
                        .frame(minHeight: 44)
                }
            }
        }
        .padding(14)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var placementControls: some View {
        HStack(spacing: 10) {
            Button(action: viewModel.previous) {
                Image(systemName: "chevron.left")
                    .frame(width: 48, height: 48)
            }
            .buttonStyle(.borderedProminent)
            .tint(.black.opacity(0.62))
            .accessibilityLabel("Previous object")

            Button {
                switch viewModel.phase {
                case .placed: viewModel.resetPlacement()
                case .failed: viewModel.retry()
                default: viewModel.place()
                }
            } label: {
                Label(primaryActionTitle, systemImage: primaryActionIcon)
                    .font(.headline)
                    .frame(maxWidth: .infinity, minHeight: 48)
            }
            .buttonStyle(.borderedProminent)
            .disabled(viewModel.phase == .loading || viewModel.phase == .scanning)

            Button(action: viewModel.next) {
                Image(systemName: "chevron.right")
                    .frame(width: 48, height: 48)
            }
            .buttonStyle(.borderedProminent)
            .tint(.black.opacity(0.62))
            .accessibilityLabel("Next object")
        }
        .padding(8)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func controlButton(
        _ title: String,
        systemImage: String,
        isActive: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .symbolVariant(isActive ? .fill : .none)
                .frame(width: 44, height: 44)
        }
        .buttonStyle(.bordered)
        .tint(isActive ? Color.accentColor : .secondary)
        .accessibilityLabel(title)
        .accessibilityValue(isActive ? "On" : "Off")
    }

    private var statusColor: Color {
        switch viewModel.phase {
        case .ready, .placed: Color.accentColor
        case .failed: .red
        case .loading: .orange
        case .scanning: .white.opacity(0.75)
        }
    }

    private var primaryActionTitle: String {
        switch viewModel.phase {
        case .placed: "Place Again"
        case .failed: "Retry Model"
        case .loading: "Loading Model"
        case .scanning: "Find a Surface"
        case .ready: "Place in Space"
        }
    }

    private var primaryActionIcon: String {
        switch viewModel.phase {
        case .placed: "arrow.counterclockwise"
        case .failed: "arrow.clockwise"
        case .loading: "hourglass"
        case .scanning: "viewfinder"
        case .ready: "arkit"
        }
    }
}
