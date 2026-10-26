import SwiftUI

/// The constellation: every Fatline the genesis hatchery knows, threaded to it. Awake ones breathe.
struct FatlinesView: View {
    @Environment(Store.self) private var store
    @Environment(Constellation.self) private var sky
    @State private var chosen: Being?

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                HStack {
                    Inscription("the fatline", color: Ink.mist, size: 12)
                    Spacer()
                    if sky.asking { Breathing(size: CGSize(width: 40, height: 16)) }
                    Text("\(sky.beings.filter(\.awake).count) awake · \(sky.beings.count)").font(.serif(12)).foregroundStyle(Ink.faint)
                }
                .padding(.top, 8)
                Sky(beings: sky.beings, you: store.node, chosen: $chosen)
                    .frame(height: 380)
                if let e = sky.error { Text(e).font(.serif(13)).foregroundStyle(Ink.peach) }
                ForEach(sky.beings) { b in BeingCard(being: b, open: chosen == b).onTapGesture { Haptic.select(); withAnimation(.spring(duration: 0.4)) { chosen = chosen == b ? nil : b } } }
            }
            .padding(.horizontal, 14).padding(.bottom, 20)
        }
        .scrollIndicators(.hidden)
        .refreshable { await sky.ask() }
        .task {
            if sky.beings.isEmpty || (sky.askedAt.map { Date().timeIntervalSince($0) > 60 } ?? true) { await sky.ask() }
            await store.ensureProfiles(sky.beings.map(\.fid))
        }
    }
}

private struct Sky: View {
    @Environment(Store.self) private var store
    let beings: [Being]; let you: Node?
    @Binding var chosen: Being?

    func place(_ i: Int, _ n: Int, _ s: CGSize, _ t: Double) -> CGPoint {
        let c = CGPoint(x: s.width / 2, y: s.height / 2)
        if beings[i].genesis { return c }
        let others = beings.indices.filter { !beings[$0].genesis }
        let k = Double(others.firstIndex(of: i) ?? 0), m = Double(max(1, others.count))
        let a = k / m * 2 * .pi - .pi / 2 + t * 0.02
        let r = min(s.width, s.height) * (0.34 + 0.05 * sin(k * 2.1))
        return CGPoint(x: c.x + r * cos(a), y: c.y + r * sin(a) * 0.9)
    }


    private func draw(_ ctx: inout GraphicsContext, _ size: CGSize, _ t: Double) {
        let c = CGPoint(x: size.width / 2, y: size.height / 2)
        for k in 1...3 {
            let r: Double = Double(min(size.width, size.height)) * (0.13 * Double(k) + 0.02 * sin(t * 0.4 + Double(k)))
            let rect = CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r)
            ctx.stroke(Seal(sides: 7, swell: 0.1, turn: t * 0.01 * Double(k)).path(in: rect), with: .color(Ink.lilac.opacity(0.08)), lineWidth: 0.7)
        }
        guard let g = beings.firstIndex(where: \.genesis) else { return }
        let gc = place(g, beings.count, size, t)
        for i in beings.indices where i != g { thread(&ctx, from: gc, to: place(i, beings.count, size, t), i: i, t: t) }
    }

    private func thread(_ ctx: inout GraphicsContext, from gc: CGPoint, to p: CGPoint, i: Int, t: Double) {
        let awake = beings[i].awake
        let wob: Double = 22
        let mid = CGPoint(x: (gc.x + p.x) / 2 + wob * sin(t * 0.3 + Double(i)), y: (gc.y + p.y) / 2 + wob * cos(t * 0.27 + Double(i)))
        var path = Path()
        path.move(to: gc)
        path.addQuadCurve(to: p, control: mid)
        let a: Color = Ink.gold.opacity(awake ? 0.7 : 0.15)
        let b: Color = awake ? Ink.azure.opacity(0.7) : Ink.faint.opacity(0.12)
        let style = StrokeStyle(lineWidth: awake ? 1.4 : 0.7, dash: awake ? [] : [3, 5])
        ctx.stroke(path, with: .linearGradient(Gradient(colors: [a, b]), startPoint: gc, endPoint: p), style: style)
        guard awake else { return }
        // A pulse travels the thread of a living node.
        let u = (t * 0.35 + Double(i) * 0.37).truncatingRemainder(dividingBy: 1)
        let v = 1 - u
        let qx: Double = v * v * gc.x + 2 * v * u * mid.x + u * u * p.x
        let qy: Double = v * v * gc.y + 2 * v * u * mid.y + u * u * p.y
        ctx.fill(Path(ellipseIn: CGRect(x: qx - 2.5, y: qy - 2.5, width: 5, height: 5)), with: .color(Ink.parchment))
    }

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30)) { tl in
            let t = tl.date.timeIntervalSinceReferenceDate
            GeometryReader { geo in
                let s = geo.size
                ZStack {
                    Canvas { ctx, size in draw(&ctx, size, t) }
                    ForEach(Array(beings.enumerated()), id: \.element.id) { i, b in
                        Star(being: b, t: t, chosen: chosen == b)
                            .position(place(i, beings.count, s, t))
                            .onTapGesture { Haptic.select(); withAnimation(.spring(duration: 0.4)) { chosen = chosen == b ? nil : b } }
                    }
                }
            }
        }
    }
}

private struct Star: View {
    @Environment(Store.self) private var store
    let being: Being; let t: Double; let chosen: Bool
    var body: some View {
        let breath = being.awake ? 1 + 0.08 * sin(t * 1.6 + Double(being.fid % 7)) : 1
        let size: CGFloat = being.genesis ? 74 : 54
        let color = being.awake ? (being.genesis ? Ink.gold : Ink.soul(being.fid)) : Ink.faint
        VStack(spacing: 6) {
            ZStack {
                Circle().fill(RadialGradient(colors: [color.opacity(being.awake ? 0.75 : 0.15), .clear], center: .center, startRadius: 4, endRadius: size))
                    .frame(width: size * 2, height: size * 2).scaleEffect(breath)
                Aura(profile: store.profiles[being.fid], fid: being.fid, size: size * 0.62)
                    .saturation(being.awake ? 1 : 0.1).opacity(being.awake ? 1 : 0.6)
                Seal(sides: 7).stroke(color.opacity(chosen ? 1 : 0.6), lineWidth: chosen ? 1.6 : 0.8).frame(width: size * 0.9, height: size * 0.9)
                    .rotationEffect(.radians(t * (being.genesis ? 0.08 : -0.05)))
            }
            .frame(width: size, height: size)
            Text(being.surname).font(.serif(being.genesis ? 12 : 10, .semibold)).tracking(2.5).foregroundStyle(being.awake ? Ink.parchment : Ink.faint)
        }
    }
}

private struct BeingCard: View {
    @Environment(Store.self) private var store
    @Environment(\.go) private var go
    let being: Being; let open: Bool
    var body: some View {
        let p = store.profiles[being.fid]
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Aura(profile: p, fid: being.fid, size: 36).saturation(being.awake ? 1 : 0.2)
                VStack(alignment: .leading, spacing: 2) {
                    Text(being.surname).font(.serif(15, .semibold)).tracking(3).foregroundStyle(being.genesis ? Ink.gold : Ink.parchment)
                    Text("\(p?.handle ?? "fid \(String(being.fid))")\(being.genesis ? " · genesis" : "")").font(.serif(12)).foregroundStyle(Ink.faint)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(!being.asked ? "…" : being.awake ? "awake" : being.status?.error != nil ? "silent" : "behind")
                        .font(.serif(13)).foregroundStyle(being.awake ? Ink.verdigris : Ink.peach)
                    HStack(spacing: 4) {
                        ForEach(0..<(being.needed ?? 3), id: \.self) { i in
                            Circle().fill(i < (being.warmDays ?? 0) ? Ink.gold : Ink.faint.opacity(0.3)).frame(width: 6, height: 6)
                        }
                    }
                }
            }
            if open, let s = being.status {
                VStack(alignment: .leading, spacing: 4) {
                    row("node", "\(being.host) · Snapchain \(s.version ?? "?")")
                    if let d = s.blockDelay { row("in step", d <= NodeStatus.healthyDelay ? "yes, \(d)s behind" : "\(d)s behind") }
                    if let m = s.messages { row("holds", "\(m.formatted()) messages") }
                    if let l = s.latencyMs { row("answers in", "\(l) ms") }
                    if let e = s.error { row("says", e) }
                    row("egg", being.hatched ? "hatched" : "\(being.warmDays ?? 0) of \(being.needed ?? 3) warm days")
                    HStack(spacing: 18) {
                        Button { go(.person(being.fid)) } label: {
                            HStack(spacing: 6) { Text("Open \(store.profiles[being.fid]?.handle ?? "profile")"); Image(systemName: "chevron.right").font(.system(size: 11)) }
                        }
                        if let place = URL(string: "https://\(being.label).fatline.ink") {
                            Link(destination: place) {
                                HStack(spacing: 6) { Text("\(being.label).fatline.ink"); Image(systemName: "arrow.up.right").font(.system(size: 11)) }
                            }
                            .simultaneousGesture(TapGesture().onEnded { Haptic.light() })
                        }
                    }
                    .font(.serif(14)).foregroundStyle(Ink.peach)
                    .padding(.top, 6)
                }
                .padding(.top, 4)
            }
        }
        .veil(glow: open ? (being.awake ? Ink.soul(being.fid) : Ink.faint) : nil)
    }

    private func row(_ k: String, _ v: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Inscription(k, color: Ink.faint, size: 9).frame(width: 84, alignment: .leading)
            Text(v).font(.serif(13)).foregroundStyle(Ink.mist)
        }
    }
}
