// The energy thread. Act on a cast and a thread of light, in the color of the network you are on, runs from the
// button you touched to where you write (the panel that rises from the bottom). Like and recast glow where they are.
import SwiftUI

enum EnergyKind { case reply, quote }

struct EnergyRequest: Identifiable, Equatable {
    let id = UUID()
    let kind: EnergyKind
    let cast: Cast
    let from: CGPoint // where the finger was, in screen points
    static func == (a: EnergyRequest, b: EnergyRequest) -> Bool { a.id == b.id }
}

private struct EnergizeKey: EnvironmentKey { static let defaultValue: (EnergyKind, Cast, CGPoint) -> Void = { _, _, _ in } }
extension EnvironmentValues {
    var energize: (EnergyKind, Cast, CGPoint) -> Void { get { self[EnergizeKey.self] } set { self[EnergizeKey.self] = newValue } }
}

/// Reply, recast, quote, like: always in sight under the cast.
struct ActionRow: View {
    @Environment(Store.self) private var store
    @Environment(\.energize) private var energize
    let cast: Cast
    @State private var waiting: Set<String> = [] // sent, not yet read back
    @State private var flash: [String: Int] = [:]
    @State private var pressed: String?

    var body: some View {
        let liked = store.liked.contains(cast.id), recast = store.recast.contains(cast.id)
        HStack(spacing: 0) {
            item("reply", "arrowshape.turn.up.left", "Reply", Ink.faint) { p in Haptic.light(); energize(.reply, cast, p) }
            item("recast", "arrow.2.squarepath", "Recast", recast ? Ink.verdigris : Ink.faint, on: recast) { p in react(.recast, p) }
            item("quote", "quote.bubble", "Quote", Ink.faint) { p in Haptic.light(); energize(.quote, cast, p) }
            item("like", liked ? "heart.fill" : "heart", "Like", liked ? Ink.carmine : Ink.faint, on: liked) { p in react(.like, p) }
        }
    }

    private func react(_ kind: ReactionKind, _ from: CGPoint) {
        let k = kind == .like ? "like" : "recast"
        waiting.insert(k)
        Task {
            let ok = await store.react(kind, cast, from: from)
            waiting.remove(k)
            if ok { flash[k, default: 0] += 1; Haptic.soft() }
        }
    }

    private func item(_ key: String, _ symbol: String, _ label: String, _ color: Color, on: Bool = false, _ run: @escaping (CGPoint) -> Void) -> some View {
        let glow = waiting.contains(key)
        return HStack(spacing: 5) {
            Image(systemName: symbol).font(.system(size: 14))
                .symbolEffect(.bounce.up, value: on)
                .symbolEffect(.bounce, value: flash[key] ?? 0)
            Text(label).font(.serif(12))
        }
        .foregroundStyle(color)
        .shadow(color: glow ? Ink.pole(store.net) : .clear, radius: glow ? 7 : 0)
        .phaseAnimator(glow ? [0.55, 1] : [1]) { v, p in v.opacity(p) } animation: { _ in .easeInOut(duration: 0.5) }
        .frame(maxWidth: .infinity, minHeight: 32, alignment: key == "reply" ? .leading : key == "like" ? .trailing : .center)
        .contentShape(Rectangle())
        .scaleEffect(pressed == key ? 0.86 : 1)
        .onTapGesture(coordinateSpace: .global) { p in
            withAnimation(.spring(duration: 0.18, bounce: 0.5)) { pressed = key }
            Task { try? await Task.sleep(for: .milliseconds(140)); withAnimation(.spring(duration: 0.3, bounce: 0.5)) { pressed = nil } }
            run(p)
        }
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel(label)
    }
}

/// The thread: drawn on from the button to the panel, then a dash of light keeps flowing along it while it is open.
struct EnergyThread: View {
    let from: CGPoint, to: CGPoint, color: Color, sent: Bool
    @State private var drawn: CGFloat = 0

    private var curve: Path {
        var p = Path()
        p.move(to: from)
        let dy = to.y - from.y
        p.addCurve(to: to, control1: CGPoint(x: from.x + (to.x >= from.x ? 70 : -70), y: from.y + dy * 0.15),
                   control2: CGPoint(x: to.x, y: to.y - dy * 0.55))
        return p
    }

    var body: some View {
        TimelineView(.animation) { tl in
            let phase = tl.date.timeIntervalSinceReferenceDate * 70
            let pulse = 0.5 + 0.5 * sin(tl.date.timeIntervalSinceReferenceDate * 4)
            ZStack {
                curve.trim(from: 0, to: drawn).stroke(color.opacity(sent ? 0.7 : 0.35), style: StrokeStyle(lineWidth: sent ? 16 : 10, lineCap: .round)).blur(radius: 9)
                curve.trim(from: 0, to: drawn).stroke(color, style: StrokeStyle(lineWidth: 1.6, lineCap: .round)).shadow(color: color, radius: 4)
                curve.trim(from: 0, to: drawn).stroke(Ink.parchment.opacity(0.85), style: StrokeStyle(lineWidth: 2.2, lineCap: .round, dash: [5, 16], dashPhase: -phase))
                Circle().fill(color).frame(width: 7, height: 7).shadow(color: color, radius: 6).position(from)
                Circle().fill(Ink.parchment).frame(width: 8 + 4 * pulse, height: 8 + 4 * pulse).shadow(color: color, radius: 10)
                    .position(to).opacity(Double(drawn))
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .onAppear { withAnimation(.easeOut(duration: 0.5)) { drawn = 1 } }
    }
}

/// Where you write the reply or the quote. Sends from this phone to the node you are reading, then reads it back.
struct EnergyPanel: View {
    @Environment(Store.self) private var store
    let request: EnergyRequest
    let close: () -> Void
    let sent: () -> Void
    @State private var text = ""
    @State private var sending = false
    @State private var status: String?
    @State private var good = false
    @FocusState private var focused: Bool

    private var bytes: Int { text.trimmingCharacters(in: .whitespacesAndNewlines).utf8.count }
    private var quote: Bool { request.kind == .quote }
    private var ready: Bool { (quote || bytes > 0) && bytes <= Farcaster.longCastMaxBytes && !sending }

    var body: some View {
        let c = request.cast, p = store.profiles[c.fid]
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Inscription(quote ? "Quote" : "Reply to", color: Ink.pole(store.net), size: 10)
                if !quote { Text(p?.handle ?? "fid \(String(c.fid))").font(.serif(13)).foregroundStyle(Ink.mist).lineLimit(1) }
                Spacer()
                Button { close() } label: { Image(systemName: "xmark").font(.system(size: 13, weight: .light)).foregroundStyle(Ink.mist).padding(6) }
            }
            if quote {
                // A quote: what you write on top, their cast inside it, one card, as it will be seen.
                VStack(alignment: .leading, spacing: 0) {
                    editor.padding(.horizontal, 6)
                    QuotedCast(cast: c).padding(10)
                }
                .background(Veil(big: 16, small: 6).fill(Color.black.opacity(0.25)))
                .overlay(Veil(big: 16, small: 6).strokeBorder(Ink.pole(store.net).opacity(focused ? 0.55 : 0.2), lineWidth: 0.8))
            } else {
                // A reply: their cast above, a thread from their face down to yours, then what you write.
                VStack(alignment: .leading, spacing: 0) {
                    HStack(alignment: .top, spacing: 10) {
                        Aura(profile: p, fid: c.fid, size: 22)
                        Text(c.text.isEmpty ? "…" : c.rendered(store.names(for: c))).font(.serif(14)).foregroundStyle(Ink.mist).lineLimit(4)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.bottom, 16)
                    .background(alignment: .topLeading) {
                        Capsule().fill(Color.white.opacity(0.18)).frame(width: 1.5).padding(.top, 27).padding(.bottom, 2).padding(.leading, 10.25)
                    }
                    HStack(alignment: .top, spacing: 10) {
                        Aura(profile: store.profiles[store.me], fid: store.me, size: 22).padding(.top, 6)
                        editor
                    }
                }
            }
            if let status { Text(status).font(.serif(12)).foregroundStyle(good ? Ink.verdigris : Ink.peach) }
            HStack(spacing: 10) {
                if bytes > Farcaster.castMaxBytes - 40 {
                    Text("\(Farcaster.longCastMaxBytes - bytes)").font(.serif(12)).foregroundStyle(bytes > Farcaster.longCastMaxBytes ? Ink.carmine : Ink.faint).monospacedDigit()
                }
                Text("as \(store.profiles[store.me]?.handle ?? "fid \(String(store.me))") · \(store.net.label)").font(.serif(11)).foregroundStyle(Ink.faint).lineLimit(1)
                Spacer()
                if store.canCast {
                    Button(action: send) {
                        HStack(spacing: 8) {
                            if sending { Breathing(color: Ink.night, size: CGSize(width: 26, height: 10)) }
                            Inscription(quote ? "quote" : "reply", color: Ink.night, size: 12)
                        }
                        .padding(.horizontal, 20).padding(.vertical, 11)
                        .background(Veil(big: 16, small: 6).fill(LinearGradient(colors: [Ink.pole(store.net), Ink.peach], startPoint: .leading, endPoint: .trailing)))
                        .shadow(color: Ink.pole(store.net).opacity(0.6), radius: 10)
                    }
                    .buttonStyle(Press())
                    .disabled(!ready)
                    .opacity(ready ? 1 : 0.5)
                } else {
                    Button { Task { await store.signIn() } } label: {
                        Inscription(store.signer?.state == "pending" ? "approve in farcaster" : "give this phone a key", color: Ink.night, size: 10)
                            .padding(.horizontal, 14).padding(.vertical, 11)
                            .background(Veil(big: 16, small: 6).fill(Ink.peach))
                    }
                    .buttonStyle(Press())
                }
            }
        }
        .padding(16)
        .background(Veil().fill(Ink.night.opacity(0.78)))
        .background(Veil().fill(.ultraThinMaterial))
        .overlay(Veil().strokeBorder(LinearGradient(colors: [Ink.pole(store.net).opacity(0.9), Ink.lilac.opacity(0.15), Ink.peach.opacity(0.4)],
                                                    startPoint: .topLeading, endPoint: .bottomTrailing), lineWidth: 1))
        .shadow(color: Ink.pole(store.net).opacity(0.35), radius: 18)
        .padding(.horizontal, 10).padding(.bottom, 8)
        .task {
            // The thread draws on first; then the keyboard.
            try? await Task.sleep(for: .milliseconds(420))
            focused = true
        }
    }

    private var editor: some View {
        ZStack(alignment: .topLeading) {
            if text.isEmpty {
                Text(quote ? "Add your words (or nothing)" : "Your reply")
                    .font(.serif(19, .light)).italic().foregroundStyle(Ink.faint).padding(.top, 8).padding(.leading, 5)
            }
            TextEditor(text: $text)
                .font(.serif(19, .light)).foregroundStyle(Ink.parchment).scrollContentBackground(.hidden)
                .focused($focused)
                .disabled(sending)
        }
        .frame(minHeight: quote ? 60 : 70, maxHeight: 150)
    }

    private func send() {
        Haptic.medium()
        sending = true; status = "signing…"; good = false
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines), c = request.cast
        Task {
            do {
                let r = try await store.cast(t, parent: quote ? nil : c.ref, quote: quote ? c.ref : nil)
                good = r.confirmed
                status = r.confirmed ? "On the node · \(store.node?.label ?? "")" : "Sent; not showing yet."
                Haptic.success()
                sent()
                try? await Task.sleep(for: .milliseconds(1300))
                close()
            } catch {
                status = error.localizedDescription
                Haptic.fail()
                sending = false
            }
        }
    }
}

/// A cast inside what you write (a quote): framed, smaller, with who said it.
struct QuotedCast: View {
    @Environment(Store.self) private var store
    let cast: Cast
    var body: some View {
        let p = store.profiles[cast.fid]
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 7) {
                Aura(profile: p, fid: cast.fid, size: 18)
                Text(p?.name ?? "fid \(String(cast.fid))").font(.serif(13, .semibold)).foregroundStyle(Ink.parchment).lineLimit(1)
                if let h = p?.handle { Text(h).font(.serif(12)).foregroundStyle(Ink.faint).lineLimit(1) }
            }
            if !cast.text.isEmpty {
                Text(cast.rendered(store.names(for: cast))).font(.serif(14)).foregroundStyle(Ink.mist).lineLimit(4)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(11)
        .background(Veil(big: 14, small: 5).fill(Color.white.opacity(0.04)))
        .overlay(Veil(big: 14, small: 5).strokeBorder(Color.white.opacity(0.14), lineWidth: 0.7))
    }
}
