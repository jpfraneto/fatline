import SwiftUI

@main
struct FatlineApp: App {
    @State private var store = Store()
    @State private var constellation = Constellation()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            Root()
                .environment(store)
                .environment(constellation)
                .preferredColorScheme(.dark)
                .onOpenURL { _ in Task { await store.pollSigner() } } // fatline://signed-in, back from the Farcaster app
                .onChange(of: phase, initial: true) { _, p in
                    switch p {
                    case .active: Task { await store.wake() }
                    case .background: store.sleep()
                    default: break
                    }
                }
        }
    }
}

enum Tab: Hashable { case feed, fatlines, me }

/// Where a tap can take you, inside any tab.
enum Route: Hashable { case thread(Cast), person(UInt64) }

private struct GoKey: EnvironmentKey { static let defaultValue: (Route) -> Void = { _ in } }
extension EnvironmentValues { var go: (Route) -> Void { get { self[GoKey.self] } set { self[GoKey.self] = newValue } } }

/// A navigation stack that keeps the native swipe back and draws on the lazure.
struct Stack<Content: View>: View {
    @Environment(Store.self) private var store
    let tab: Tab
    @ViewBuilder let content: () -> Content
    @State private var path: [Route] = []
    var body: some View {
        NavigationStack(path: $path) {
            content()
                .toolbar(.hidden, for: .navigationBar)
                .containerBackground(.clear, for: .navigation)
                .navigationDestination(for: Route.self) { r in
                    Group {
                        switch r {
                        case .thread(let c): Thread(root: c)
                        case .person(let f): PersonView(fid: f)
                        }
                    }
                    .toolbar(.hidden, for: .navigationBar)
                    .containerBackground(.clear, for: .navigation)
                }
        }
        .environment(\.go) { r in Haptic.soft(); path.append(r) }
        .onChange(of: store.retap) { _, t in if t.tab == tab, !path.isEmpty { path.removeAll() } }
        .onAppear { // launch argument "-person <fid>" opens a profile (for screenshots)
            if tab == .feed, let f = UInt64(UserDefaults.standard.string(forKey: "person") ?? "") { path = [.person(f)] }
        }
    }
}

struct Root: View {
    @Environment(Store.self) private var store
    @State private var tab: Tab = ["fatlines": .fatlines, "self": .me][UserDefaults.standard.string(forKey: "tab") ?? ""] ?? .feed
    @State private var speaking = false
    @State private var settings = false

    var body: some View {
        ZStack(alignment: .bottom) {
            Lazure(net: store.net)
            ZStack {
                Stack(tab: .feed) { FeedView(settings: $settings) }.opacity(tab == .feed ? 1 : 0).allowsHitTesting(tab == .feed)
                Stack(tab: .fatlines) { FatlinesView() }.opacity(tab == .fatlines ? 1 : 0).allowsHitTesting(tab == .fatlines)
                Stack(tab: .me) { PersonView(fid: nil, settings: $settings) }.opacity(tab == .me ? 1 : 0).allowsHitTesting(tab == .me)
            }
            .safeAreaPadding(.bottom, 76)
            Bar(tab: $tab, write: { Haptic.medium(); speaking = true })
            if let t = store.toast { Toast(text: t).onTapGesture { store.toast = nil } }
        }
        .sheet(isPresented: $speaking) { Compose(parent: nil) }
        .sheet(isPresented: $settings) { SettingsView() }
        .onChange(of: store.toast) { _, t in
            guard t != nil else { return }
            Task { try? await Task.sleep(for: .seconds(4)); store.toast = nil }
        }
    }
}

private struct Toast: View {
    let text: String
    var body: some View {
        Text(text).font(.serif(14)).foregroundStyle(Ink.parchment).multilineTextAlignment(.center)
            .padding(.horizontal, 18).padding(.vertical, 12)
            .background(Veil().fill(Ink.indigo.opacity(0.92)))
            .overlay(Veil().strokeBorder(Ink.gold.opacity(0.4), lineWidth: 0.7))
            .padding(.horizontal, 24).padding(.bottom, 96)
            .transition(.opacity.combined(with: .move(edge: .bottom)))
    }
}

/// The bar: Feed, Fatlines, you (your own face), and on the far right the pen.
private struct Bar: View {
    @Environment(Store.self) private var store
    @Binding var tab: Tab
    let write: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 0) {
            item(.feed, "Feed") { StreamGlyph() }
            item(.fatlines, "Fatlines") { StarGlyph() }
            Button { select(.me) } label: {
                ZStack {
                    Circle().stroke(tab == .me ? Ink.pole(store.net) : .clear, lineWidth: 1.6).frame(width: 40, height: 40)
                    Aura(profile: store.profiles[store.me], fid: store.me, size: 32)
                        .saturation(tab == .me ? 1 : 0.6).opacity(tab == .me ? 1 : 0.75)
                }
                .frame(maxWidth: .infinity, minHeight: 46)
                .scaleEffect(tab == .me ? 1.06 : 1)
            }
            Button(action: write) {
                ZStack {
                    Seal().fill(LinearGradient(colors: [Ink.pole(store.net), Ink.peach], startPoint: .topLeading, endPoint: .bottomTrailing))
                    Seal().stroke(Ink.parchment.opacity(0.7), lineWidth: 0.8).padding(3)
                    Image(systemName: "square.and.pencil").font(.system(size: 22, weight: .semibold)).foregroundStyle(Ink.night).offset(x: 1, y: -1)
                }
                .frame(width: 58, height: 58)
                .shadow(color: Ink.pole(store.net).opacity(0.65), radius: 12)
            }
            .buttonStyle(Press())
            .padding(.leading, 6).padding(.trailing, 4)
            .accessibilityLabel("Write a cast")
        }
        .padding(.horizontal, 8).padding(.vertical, 8)
        .background(
            Veil(big: 30, small: 12).fill(Ink.night.opacity(0.55))
                .background(Veil(big: 30, small: 12).fill(.ultraThinMaterial))
                .overlay(Veil(big: 30, small: 12).strokeBorder(Ink.gold.opacity(0.18), lineWidth: 0.7))
        )
        .padding(.horizontal, 14)
        .animation(.spring(duration: 0.35, bounce: 0.4), value: tab)
    }

    private func select(_ t: Tab) {
        Haptic.select()
        if tab == t { store.retap = Retap(tab: t, n: store.retap.n + 1) } // tap again: back to the top
        tab = t
    }

    private func item<G: View>(_ t: Tab, _ name: String, @ViewBuilder glyph: () -> G) -> some View {
        Button { select(t) } label: {
            VStack(spacing: 5) {
                glyph().frame(width: 26, height: 20).foregroundStyle(tab == t ? Ink.pole(store.net) : Ink.faint)
                    .scaleEffect(tab == t ? 1.12 : 1)
                Inscription(name, color: tab == t ? Ink.parchment : Ink.faint, size: 9)
            }
            .frame(maxWidth: .infinity, minHeight: 46)
        }
    }
}

/// Buttons that give under the finger.
struct Press: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.scaleEffect(configuration.isPressed ? 0.88 : 1).animation(.spring(duration: 0.25, bounce: 0.5), value: configuration.isPressed)
    }
}

enum Haptic {
    static func select() { UISelectionFeedbackGenerator().selectionChanged() }
    static func soft() { UIImpactFeedbackGenerator(style: .soft).impactOccurred() }
    static func light() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func medium() { UIImpactFeedbackGenerator(style: .medium).impactOccurred() }
    static func heavy() { UIImpactFeedbackGenerator(style: .rigid).impactOccurred(intensity: 0.9) }
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func fail() { UINotificationFeedbackGenerator().notificationOccurred(.error) }
}

/// The native swipe back, kept even though the bar above is hidden.
extension UINavigationController: @retroactive UIGestureRecognizerDelegate {
    override open func viewDidLoad() {
        super.viewDidLoad()
        interactivePopGestureRecognizer?.delegate = self
    }
    public func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool { viewControllers.count > 1 }
}
private struct StreamGlyph: View {
    var body: some View {
        Canvas { ctx, s in
            for k in 0..<3 {
                var p = Path(); let y = s.height * (0.25 + 0.25 * Double(k))
                p.move(to: CGPoint(x: 0, y: y))
                p.addCurve(to: CGPoint(x: s.width, y: y), control1: CGPoint(x: s.width * 0.33, y: y - 5), control2: CGPoint(x: s.width * 0.66, y: y + 5))
                ctx.stroke(p, with: .foreground, lineWidth: 1.3)
            }
        }
    }
}
private struct StarGlyph: View {
    var body: some View {
        Canvas { ctx, s in
            let c = CGPoint(x: s.width / 2, y: s.height / 2)
            let pts = [CGPoint(x: 3, y: 4), CGPoint(x: s.width - 3, y: 6), CGPoint(x: s.width / 2 + 2, y: s.height - 2)]
            for p in pts {
                var l = Path(); l.move(to: c); l.addLine(to: p); ctx.stroke(l, with: .foreground, style: StrokeStyle(lineWidth: 0.6))
                ctx.fill(Path(ellipseIn: CGRect(x: p.x - 2, y: p.y - 2, width: 4, height: 4)), with: .foreground)
            }
            ctx.fill(Path(ellipseIn: CGRect(x: c.x - 3.5, y: c.y - 3.5, width: 7, height: 7)), with: .foreground)
        }
    }
}
private struct SelfGlyph: View {
    var body: some View {
        ZStack { Circle().stroke(lineWidth: 1.3).frame(width: 18, height: 18); Circle().frame(width: 4, height: 4) }
    }
}
