import SwiftUI

@main
struct LatentAtlasARApp: App {
    var body: some Scene {
        WindowGroup {
            ARExperienceView()
                .preferredColorScheme(.dark)
        }
    }
}
