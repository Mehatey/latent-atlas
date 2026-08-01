import Foundation

struct RelatedArtwork: Identifiable, Hashable {
    let id: Int
    let title: String
    let artist: String
    let date: String
    let imageName: String

    var metURL: URL {
        URL(string: "https://www.metmuseum.org/art/collection/search/\(id)")!
    }
}

struct AtlasArtwork: Identifiable, Hashable {
    let id: Int
    let title: String
    let maker: String
    let date: String
    let medium: String
    let description: String
    let modelFilename: String
    let related: [RelatedArtwork]

    var metURL: URL {
        URL(string: "https://www.metmuseum.org/art/collection/search/\(id)")!
    }
}

extension AtlasArtwork {
    static let collection: [AtlasArtwork] = [
        AtlasArtwork(
            id: 854888,
            title: "Marble Sarcophagus with Lions Felling Antelope",
            maker: "Roman",
            date: "3rd century",
            medium: "Marble",
            description: "Lions grasp antelope at either end of a Roman sarcophagus, now readable as a complete object in space.",
            modelFilename: "lion-sarcophagus-gallery.usdz",
            related: [
                .init(id: 464039, title: "Plaque with God Creating the Animals", artist: "Unknown", date: "1084", imageName: "775.jpg"),
                .init(id: 252499, title: "Terracotta Plaque with Pelops and Hippodamia", artist: "Unknown", date: "27 BCE–68 CE", imageName: "5.jpg"),
                .init(id: 210829, title: "Personification of the River Nile", artist: "Giovanni Volpato", date: "ca. 1785–95", imageName: "151.jpg"),
                .init(id: 202696, title: "Architecture", artist: "Clodion", date: "ca. 1780–90", imageName: "4.jpg"),
                .init(id: 38511, title: "Krishna Killing the Horse Demon Keshi", artist: "Unknown", date: "5th century", imageName: "631.jpg"),
                .init(id: 252535, title: "Marble Round Altar with Animals and Masks", artist: "Unknown", date: "1st century CE", imageName: "1393.jpg")
            ]
        ),
        AtlasArtwork(
            id: 312581,
            title: "House Model",
            maker: "Nayarit artist(s)",
            date: "200 BCE–300 CE",
            medium: "Ceramic, slip",
            description: "A compact architectural world opens across two levels, preserving figures, food, shelter, and gathering.",
            modelFilename: "nayarit-house-gallery.usdz",
            related: [
                .init(id: 250939, title: "Wall Painting on Black Ground: Landscape", artist: "Unknown", date: "1st century BCE", imageName: "69.jpg"),
                .init(id: 684753, title: "Christ in the Garden of Gethsemane", artist: "Unknown", date: "1520–30", imageName: "590.jpg"),
                .init(id: 446191, title: "Panel with Horse Heads", artist: "Unknown", date: "11th century", imageName: "582.jpg"),
                .init(id: 199840, title: "Miniature Collector’s Cabinet", artist: "Bernard Salomon", date: "ca. 1600", imageName: "239.jpg"),
                .init(id: 3873, title: "Garden Table", artist: "Unknown", date: "ca. 1860", imageName: "728.jpg"),
                .init(id: 207551, title: "Floral Still Life", artist: "Dirck van Rijswijck", date: "1662", imageName: "188.jpg")
            ]
        ),
        AtlasArtwork(
            id: 242017,
            title: "Limestone Statue of Aphrodite Holding Winged Eros",
            maker: "Cypriot",
            date: "late 4th century BCE",
            medium: "Limestone",
            description: "A frontal goddess, elaborate headdress, and small winged Eros become legible from every side.",
            modelFilename: "aphrodite-eros-gallery.usdz",
            related: [
                .init(id: 250701, title: "Marble Bust of a Woman", artist: "Unknown", date: "mid–3rd century CE", imageName: "1469.jpg"),
                .init(id: 208978, title: "Self Portrait", artist: "Philippe Laurent Roland", date: "ca. 1785", imageName: "584.jpg"),
                .init(id: 248741, title: "Marble Portrait Bust of a Woman", artist: "Unknown", date: "ca. 155–165 CE", imageName: "1220.jpg"),
                .init(id: 467705, title: "Tomb Effigy Bust of Marie de France", artist: "Jean de Liège", date: "ca. 1381", imageName: "1132.jpg"),
                .init(id: 248799, title: "Marble Portrait, Probably of Matidia", artist: "Unknown", date: "117–138 CE", imageName: "1494.jpg"),
                .init(id: 248310, title: "Marble Portrait of a Young Woman", artist: "Unknown", date: "ca. 139–150 CE", imageName: "1239.jpg")
            ]
        ),
        AtlasArtwork(
            id: 309909,
            title: "Ngya (Commemorative Post)",
            maker: "Bongo artist",
            date: "late 19th century",
            medium: "Mahogany",
            description: "A tall commemorative form turns a single carved tree trunk into presence, memory, and social standing.",
            modelFilename: "ngya-post-gallery.usdz",
            related: [
                .init(id: 317703, title: "Abstract Stone Figure", artist: "Unknown", date: "late 3rd millennium BCE", imageName: "1011.jpg"),
                .init(id: 317704, title: "Abstract Stone Figure", artist: "Unknown", date: "late 3rd millennium BCE", imageName: "998.jpg"),
                .init(id: 311294, title: "Ancestor Figure", artist: "Kambot artist", date: "19th century", imageName: "648.jpg"),
                .init(id: 312231, title: "Aduno Koro Vessel with Ancestral Figures", artist: "Dogon blacksmith", date: "16th–19th century", imageName: "542.jpg"),
                .init(id: 547745, title: "Sacred Animal Mummy in the Form of an Ibis", artist: "Unknown", date: "ca. 400 BCE–100 CE", imageName: "270.jpg"),
                .init(id: 552443, title: "Sacred Animal Mummy of a Cat", artist: "Unknown", date: "664 BCE–1st century CE", imageName: "721.jpg")
            ]
        )
    ]
}
