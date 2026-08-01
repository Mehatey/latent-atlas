import SwiftUI

struct RelatedWorksShelf: View {
    let works: [RelatedArtwork]
    @Binding var selection: RelatedArtwork?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Related in the atlas")
                        .font(.headline)
                    Text("Nearest semantic neighbors")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text("\(works.count) works")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: 10) {
                    ForEach(works) { work in
                        Button {
                            withAnimation(.snappy(duration: 0.2)) { selection = work }
                        } label: {
                            HStack(spacing: 10) {
                                BundleImage(filename: work.imageName)
                                    .frame(width: 64, height: 64)
                                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                                    .overlay {
                                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                                            .stroke(.white.opacity(0.12), lineWidth: 0.5)
                                    }
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(work.title)
                                        .font(.subheadline.weight(.semibold))
                                        .lineLimit(2)
                                        .multilineTextAlignment(.leading)
                                    Text(work.artist)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                                .frame(width: 150, alignment: .leading)
                            }
                            .padding(8)
                            .background(selection == work ? Color.accentColor.opacity(0.2) : Color.white.opacity(0.08))
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Related work: \(work.title), \(work.artist)")
                    }
                }
            }

            if let selection {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(selection.title)
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(2)
                        Text("\(selection.artist) · \(selection.date)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Spacer()
                    Link(destination: selection.metURL) {
                        Label("The Met", systemImage: "arrow.up.right")
                            .font(.subheadline.weight(.semibold))
                            .frame(minHeight: 44)
                    }
                }
                .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
        }
        .padding(14)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}
