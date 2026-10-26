// The look. Color as Goethe saw it: born where light meets darkness. Yellow and red at the light's edge
// (Snapchain, the warm pole), blue and violet at darkness's edge (Hypersnap, the cool pole). Surfaces are lazure:
// thin veils of color laid over each other, as Steiner had the Goetheanum's walls painted. Forms avoid the right angle.
import SwiftUI

enum Ink {
    static let parchment = Color(red: 0.97, green: 0.94, blue: 0.88)
    static let mist = Color(red: 0.97, green: 0.94, blue: 0.88).opacity(0.62)
    static let faint = Color(red: 0.97, green: 0.94, blue: 0.88).opacity(0.38)
    static let gold = Color(red: 0.93, green: 0.73, blue: 0.33)
    static let peach = Color(red: 0.96, green: 0.76, blue: 0.67)   // peach blossom: Steiner's color of the living soul
    static let carmine = Color(red: 0.78, green: 0.29, blue: 0.40)
    static let lilac = Color(red: 0.68, green: 0.60, blue: 0.86)
    static let indigo = Color(red: 0.13, green: 0.12, blue: 0.33)
    static let night = Color(red: 0.06, green: 0.05, blue: 0.14)
    static let azure = Color(red: 0.36, green: 0.55, blue: 0.86)
    static let verdigris = Color(red: 0.40, green: 0.72, blue: 0.66)

    static func pole(_ n: Net) -> Color { n == .snapchain ? gold : lilac }
    static func pole2(_ n: Net) -> Color { n == .snapchain ? carmine : azure }

    /// Each soul its own color, steady across sessions: a hue walked by the golden angle from its FID.
    static func soul(_ fid: UInt64) -> Color {
        let h = (Double(fid % 100_000) * 0.618_033_988_75).truncatingRemainder(dividingBy: 1)
        return Color(hue: h, saturation: 0.45, brightness: 0.95)
    }
}

extension Font {
    static func serif(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font { .system(size: size, weight: weight, design: .serif) }
}

/// Small caps labels, letter-spaced, like inscriptions.
struct Inscription: View {
    let text: String; var color: Color = Ink.mist; var size: CGFloat = 11
    init(_ text: String, color: Color = Ink.mist, size: CGFloat = 11) { self.text = text; self.color = color; self.size = size }
    var body: some View { Text(text.uppercased()).font(.serif(size, .medium)).tracking(size * 0.28).foregroundStyle(color) }
}

// MARK: - The day's planet: Steiner's sevenfold week, each day under its planet and color

struct Planet {
    let glyph: String; let name: String; let color: Color
    static var today: Planet {
        switch Calendar.current.component(.weekday, from: Date()) {
        case 1: return Planet(glyph: "☉", name: "Sun", color: Ink.gold)
        case 2: return Planet(glyph: "☽", name: "Moon", color: Ink.lilac)
        case 3: return Planet(glyph: "♂", name: "Mars", color: Ink.carmine)
        case 4: return Planet(glyph: "☿", name: "Mercury", color: Color(red: 0.95, green: 0.86, blue: 0.40))
        case 5: return Planet(glyph: "♃", name: "Jupiter", color: Color(red: 0.95, green: 0.58, blue: 0.30))
        case 6: return Planet(glyph: "♀", name: "Venus", color: Ink.verdigris)
        default: return Planet(glyph: "♄", name: "Saturn", color: Ink.azure)
        }
    }
}

// MARK: - Lazure: the living background

struct Lazure: View {
    var net: Net
    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 20)) { tl in
            let t = tl.date.timeIntervalSinceReferenceDate
            let warm = net == .snapchain
            let s = { (a: Double, f: Double) in Float(sin(t * f + a) * 0.06) }
            MeshGradient(width: 3, height: 3, points: [
                [0, 0], [0.5 + s(0, 0.11), 0], [1, 0],
                [0, 0.5 + s(1, 0.09)], [0.5 + s(2, 0.07), 0.45 + s(3, 0.08)], [1, 0.5 + s(4, 0.1)],
                [0, 1], [0.5 + s(5, 0.06), 1], [1, 1],
            ], colors: [
                Ink.night, warm ? Ink.carmine.mix(with: Ink.night, by: 0.55) : Ink.indigo, Ink.indigo.mix(with: Ink.night, by: 0.3),
                Ink.indigo, warm ? Ink.gold.mix(with: Ink.carmine, by: 0.5).mix(with: Ink.night, by: 0.62) : Ink.lilac.mix(with: Ink.night, by: 0.6),
                warm ? Ink.peach.mix(with: Ink.night, by: 0.72) : Ink.azure.mix(with: Ink.night, by: 0.6),
                Ink.night, Ink.indigo.mix(with: Ink.night, by: 0.4), warm ? Ink.carmine.mix(with: Ink.night, by: 0.78) : Ink.verdigris.mix(with: Ink.night, by: 0.8),
            ])
        }
        .overlay(Veils())
        .ignoresSafeArea()
        .animation(.easeInOut(duration: 2.4), value: net)
    }
}

/// A few slow translucent washes drifting over the mesh: the lazure layers.
private struct Veils: View {
    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 15)) { tl in
            let t = tl.date.timeIntervalSinceReferenceDate
            Canvas { ctx, size in
                ctx.addFilter(.blur(radius: 60))
                for i in 0..<4 {
                    let d = Double(i)
                    let x = size.width * (0.5 + 0.42 * sin(t * 0.03 * (1 + d * 0.3) + d * 1.7))
                    let y = size.height * (0.5 + 0.40 * cos(t * 0.025 * (1 + d * 0.2) + d * 2.3))
                    let r = size.width * (0.35 + 0.1 * d)
                    let c = [Ink.peach, Ink.lilac, Ink.gold, Ink.verdigris][i]
                    ctx.fill(Path(ellipseIn: CGRect(x: x - r, y: y - r * 0.7, width: r * 2, height: r * 1.4)), with: .color(c.opacity(0.07)))
                }
            }
        }
        .allowsHitTesting(false)
    }
}

// MARK: - Forms

/// A veil: the card shape. No right angles; the corners answer each other across the diagonal.
struct Veil: InsettableShape {
    var big: CGFloat = 26, small: CGFloat = 9, inset: CGFloat = 0
    func path(in r: CGRect) -> Path {
        UnevenRoundedRectangle(topLeadingRadius: big, bottomLeadingRadius: small, bottomTrailingRadius: big, topTrailingRadius: small, style: .continuous)
            .path(in: r.insetBy(dx: inset, dy: inset))
    }
    func inset(by a: CGFloat) -> Veil { var v = self; v.inset += a; return v }
}

/// A seal: a polygon of gently swelling sides (seven by default, the number of the week and the planets).
struct Seal: Shape {
    var sides = 7, swell: CGFloat = 0.12, turn: Double = -.pi / 2
    func path(in r: CGRect) -> Path {
        let c = CGPoint(x: r.midX, y: r.midY), rad = min(r.width, r.height) / 2
        let pts = (0..<sides).map { i -> CGPoint in
            let a = turn + Double(i) / Double(sides) * 2 * .pi
            return CGPoint(x: c.x + rad * cos(a), y: c.y + rad * sin(a))
        }
        var p = Path()
        p.move(to: pts[0])
        for i in 0..<sides {
            let a = pts[i], b = pts[(i + 1) % sides]
            let mid = CGPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2)
            let ctrl = CGPoint(x: mid.x + (mid.x - c.x) * swell, y: mid.y + (mid.y - c.y) * swell)
            p.addQuadCurve(to: b, control: ctrl)
        }
        p.closeSubpath()
        return p
    }
}

/// The lemniscate: the figure of eight, where inner and outer turn into each other. The sign of the infinite.
struct Lemniscate: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        for i in 0...240 {
            let pt = Lemniscate.point(Double(i) / 240, r)
            i == 0 ? p.move(to: pt) : p.addLine(to: pt)
        }
        p.closeSubpath()
        return p
    }
    static func point(_ u: Double, _ r: CGRect) -> CGPoint {
        let t = u * 2 * .pi, d = 1 + sin(t) * sin(t)
        return CGPoint(x: r.midX + r.width / 2 * cos(t) / d, y: r.midY + r.height * 1.25 * sin(t) * cos(t) / d)
    }
}

/// A light running the lemniscate: the app is gathering or listening.
struct Breathing: View {
    var color: Color = Ink.gold
    var size: CGSize = CGSize(width: 54, height: 22)
    var body: some View {
        TimelineView(.animation) { tl in
            let u = tl.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 2.6) / 2.6
            Canvas { ctx, sz in
                let r = CGRect(origin: .zero, size: sz).insetBy(dx: 2, dy: 2)
                ctx.stroke(Lemniscate().path(in: r), with: .color(color.opacity(0.22)), lineWidth: 1)
                for k in 0..<14 {
                    let pt = Lemniscate.point((u - Double(k) * 0.012 + 1).truncatingRemainder(dividingBy: 1), r)
                    let s = 3.2 - Double(k) * 0.2
                    ctx.fill(Path(ellipseIn: CGRect(x: pt.x - s / 2, y: pt.y - s / 2, width: s, height: s)), with: .color(color.opacity(1 - Double(k) / 14)))
                }
            }
        }
        .frame(width: size.width, height: size.height)
    }
}

extension View {
    /// A card: a translucent veil with a thin luminous edge.
    func veil(glow: Color? = nil) -> some View {
        self.padding(16)
            .background(Veil().fill(Color.white.opacity(0.055)))
            .background(Veil().fill(.ultraThinMaterial.opacity(0.35)))
            .overlay(Veil().strokeBorder(LinearGradient(colors: [(glow ?? Ink.gold).opacity(glow == nil ? 0.28 : 0.85), Ink.lilac.opacity(0.10), (glow ?? Ink.peach).opacity(glow == nil ? 0.18 : 0.6)],
                                                        startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: glow == nil ? 0.7 : 1.2))
            .shadow(color: (glow ?? .clear).opacity(0.45), radius: glow == nil ? 0 : 14)
    }
}

/// A face with its aura.
struct Aura: View {
    let profile: Profile?; let fid: UInt64; var size: CGFloat = 42
    var body: some View {
        ZStack {
            Circle().fill(RadialGradient(colors: [Ink.soul(fid).opacity(0.55), .clear], center: .center, startRadius: size * 0.3, endRadius: size * 0.85))
                .frame(width: size * 1.7, height: size * 1.7)
            AsyncImage(url: profile?.pfp.flatMap(URL.init(string:))) { img in img.resizable().scaledToFill() } placeholder: {
                Circle().fill(Ink.soul(fid).opacity(0.35)).overlay(Text(String(profile?.name.prefix(1) ?? "·")).font(.serif(size * 0.42)).foregroundStyle(Ink.parchment))
            }
            .frame(width: size, height: size)
            .clipShape(Circle())
            .overlay(Circle().strokeBorder(Ink.soul(fid).opacity(0.7), lineWidth: 0.8))
        }
        .frame(width: size, height: size)
    }
}

enum When {
    static func short(_ d: Date) -> String {
        let s = max(0, Date().timeIntervalSince(d))
        if s < 60 { return "now" }
        if s < 3600 { return "\(Int(s / 60))m" }
        if s < 86400 { return "\(Int(s / 3600))h" }
        if s < 7 * 86400 { return "\(Int(s / 86400))d" }
        return d.formatted(.dateTime.day().month(.abbreviated))
    }
}
