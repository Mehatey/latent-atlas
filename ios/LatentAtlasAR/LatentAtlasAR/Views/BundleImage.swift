import SwiftUI
import UIKit

struct BundleImage: View {
    let filename: String

    var body: some View {
        Group {
            if let image = loadImage() {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                ZStack {
                    Color.secondary.opacity(0.16)
                    Image(systemName: "photo")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityHidden(true)
    }

    private func loadImage() -> UIImage? {
        let url = Bundle.main.url(forResource: filename, withExtension: nil, subdirectory: "Resources/Related")
            ?? Bundle.main.url(forResource: filename, withExtension: nil, subdirectory: "Related")
            ?? Bundle.main.url(forResource: filename, withExtension: nil)
        return url.flatMap { UIImage(contentsOfFile: $0.path) }
    }
}
