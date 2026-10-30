// Bubbles: one per like or recast, separate from what you are writing. A spark leaves your finger and flies to the
// corner, a bubble opens there with a current running round its edge while the node takes it, it lights up when the
// node shows it, then it pops. The same as the web (energy.js, bubble()).
import SwiftUI

/// The bubbles, bottom right, above the bar. Newest at the bottom, nearest your thumb.
struct BubbleShelf: View {
    @Environment(Store.self) private var store
    var body: some View {
        VStack(alignment: .trailing, spacing: 8) {
            ForEach(store.bubbles) { b in
                BubbleView(bubble: b)
                    .transition(.asymmetric(insertion: .scale(scale: 0.5, anchor: .trailing).combined(with: .opacity),
                                            removal: .scale(scale: 0.2).combined(with: .opacity)))
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.trailing, 16).padding(.bottom, 92)
        .animation(.spring(duration: 0.4, bounce: 0.45), value: store.bubbles)
        .allowsHitTesting(!store.bubbles.isEmpty)
    }
}

struct BubbleView: View {
    @Environment(Store.self) private var store
    let bubble: Bubble

    var body: some View {
        let like = bubble.kind == .like
        let pole = Ink.pole(store.net)
        let tint = bubble.state == .failed ? Ink.carmine : like ? Ink.carmine : Ink.verdigris
        HStack(spacing: 10) {
            Image(systemName: like ? (bubble.undo ? "heart" : "heart.fill") : "arrow.2.squarepath")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(bubble.state == .done ? Ink.night : tint)
                .frame(width: 26, height: 26)
                .background(Circle().fill(bubble.state == .done ? AnyShapeStyle(pole) : AnyShapeStyle(tint.opacity(0.16))))
                .phaseAnimator(bubble.state == .busy ? [1, 1.18] : [1]) { v, s in v.scaleEffect(s) } animation: { _ in .easeInOut(duration: 0.45) }
            (Text(bubble.undo ? (like ? "Unliked" : "Recast removed") : (like ? "Liked" : "Recast")).fontWeight(.semibold).foregroundColor(Ink.parchment)
             + Text(" \(bubble.who)").foregroundColor(Ink.mist)
             + Text("  \(bubble.note)").foregroundColor(bubble.state == .done ? pole : bubble.state == .failed ? Ink.carmine : Ink.faint))
                .font(.serif(13)).lineLimit(bubble.state == .failed ? 3 : 1)
        }
        .padding(.leading, 8).padding(.trailing, 16).padding(.vertical, 8)
        .background(Capsule().fill(Ink.night.opacity(0.92)))
        .background(Capsule().fill(.ultraThinMaterial))
        .overlay { Edge(state: bubble.state, color: pole) }
        .shadow(color: pole.opacity(bubble.state == .done ? 0.55 : 0.25), radius: bubble.state == .done ? 16 : 10)
        .scaleEffect(bubble.state == .done ? 1.04 : 1)
        .animation(.spring(duration: 0.35, bounce: 0.6), value: bubble.state)
        .frame(maxWidth: 330, alignment: .trailing)
        .onTapGesture { withAnimation { store.bubbles.removeAll { $0.id == bubble.id } } }
    }
}

/// The bubble's edge: a thin ring, and while the node takes it, a current running round.
private struct Edge: View {
    let state: Bubble.State
    let color: Color
    var body: some View {
        switch state {
        case .busy:
            TimelineView(.animation) { tl in
                let a = tl.date.timeIntervalSinceReferenceDate * 400
                ZStack {
                    Capsule().strokeBorder(color.opacity(0.22), lineWidth: 1)
                    Capsule().strokeBorder(AngularGradient(colors: [.clear, .clear, .clear, color.opacity(0.5), Ink.parchment, color, .clear],
                                                           center: .center, angle: .degrees(a)), lineWidth: 1.8)
                }
            }
        case .done, .pending: Capsule().strokeBorder(color, lineWidth: 1.4)
        case .failed: Capsule().strokeBorder(Ink.carmine, lineWidth: 1.2)
        }
    }
}

/// The sparks: each flies in an arc from where the finger was to the bubbles' corner, then is gone.
struct SparkLayer: View {
    @Environment(Store.self) private var store
    var body: some View {
        GeometryReader { g in
            let to = CGPoint(x: g.size.width - 44, y: g.size.height - 130)
            ForEach(store.bubbles.filter { $0.from != nil }) { b in
                Spark(from: b.from!, to: to, color: Ink.pole(store.net))
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }
}

private struct Spark: View {
    let from: CGPoint, to: CGPoint, color: Color
    @State private var t: CGFloat = 0
    var body: some View {
        Circle().fill(Ink.parchment).frame(width: 9, height: 9)
            .shadow(color: color, radius: 3).shadow(color: color, radius: 9)
            .modifier(Arc(from: from, to: to, t: t))
            .onAppear { withAnimation(.timingCurve(0.3, 0.1, 0.3, 1, duration: 0.55)) { t = 1 } }
    }
}

/// A point along a curve that rises, then falls into the corner.
private struct Arc: ViewModifier, Animatable {
    let from: CGPoint, to: CGPoint
    var t: CGFloat
    var animatableData: CGFloat { get { t } set { t = newValue } }
    func body(content: Content) -> some View {
        let mid = CGPoint(x: (from.x + to.x) / 2, y: min(from.y, to.y) - 90)
        let u = 1 - t
        let p = CGPoint(x: u * u * from.x + 2 * u * t * mid.x + t * t * to.x, y: u * u * from.y + 2 * u * t * mid.y + t * t * to.y)
        return content.scaleEffect(1.3 - 0.8 * t).opacity(t < 0.97 ? 1 : 0).position(p)
    }
}
