import SwiftUI

/// Around: everything that happened around you, newest first, as it happens. Its number is ∞, never anything else.
struct AroundView: View {
    @Environment(Store.self) private var store
    @Environment(\.scenePhase) private var phase
    let visible: Bool
    @State private var atTop = true
    @State private var held = Held<AroundItem>()

    struct AroundGroup: Identifiable { let items: [AroundItem]; var id: String { items[0].key }; var first: AroundItem { items[0] } }

    /// Likes (or recasts) of the same cast, one right after another, share a line.
    static func groups(_ items: [AroundItem]) -> [AroundGroup] {
        var out: [[AroundItem]] = []
        for e in items {
            if let last = out.last?.first, e.kind == .like || e.kind == .recast, last.kind == e.kind, last.target == e.target {
                out[out.count - 1].append(e)
            } else { out.append([e]) }
        }
        return out.map(AroundGroup.init)
    }

    var body: some View {
        let model = store.around
        ScrollViewReader { reader in
            ScrollView {
                LazyVStack(spacing: 12) {
                    header.id("top")
                    if model.items.isEmpty && model.failed == nil {
                        VStack(spacing: 14) { Breathing(size: CGSize(width: 90, height: 34)); Inscription("listening") }.padding(.top, 80)
                    }
                    ForEach(AroundView.groups(held.shown)) { g in
                        row(g, glow: model.fresh.contains(g.id))
                            .transition(.asymmetric(insertion: .scale(scale: 0.94).combined(with: .opacity), removal: .opacity))
                    }
                    tail
                }
                .padding(.horizontal, 14).padding(.bottom, 20)
                .animation(.spring(duration: 0.5, bounce: 0.2), value: held.shown.first?.key)
            }
            .scrollIndicators(.hidden)
            .refreshable { Haptic.light(); await model.refresh(store) }
            .onScrollGeometryChange(for: Bool.self) { $0.contentOffset.y < 60 } action: { _, top in
                atTop = top
                if top { held.release() }
            }
            // New things never move what you are reading: they wait behind the pill. Older ones join at the bottom.
            .onChange(of: model.items.map(\.key), initial: true) { held.offer(model.items, atTop: atTop, time: { $0.at }) }
            .newPill(held.waiting) {
                held.release()
                withAnimation(.spring(duration: 0.6)) { reader.scrollTo("top", anchor: .top) }
            }
            .onChange(of: store.retap) { _, t in
                if t.tab == .around { withAnimation(.spring(duration: 0.6)) { reader.scrollTo("top", anchor: .top) } }
            }
        }
        // New things arrive at the top on their own while you look.
        .task(id: visible && phase == .active) {
            guard visible && phase == .active else { return }
            if !model.loaded && !model.busy { await model.refresh(store) }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(AroundModel.liveSeconds))
                if Task.isCancelled { break }
                await model.poll(store)
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center) {
                HStack(spacing: 8) {
                    Text("∞").font(.serif(24)).foregroundStyle(Ink.pole(store.net)).shadow(color: Ink.pole(store.net), radius: 6)
                    Text(store.canCast || store.me == Store.ownerFid ? "Around you" : "Around \(store.profiles[store.me]?.handle ?? "fid \(String(store.me))")")
                        .font(.serif(26, .light)).foregroundStyle(Ink.parchment)
                }
                Spacer()
                if store.around.busy { Breathing(color: Ink.pole(store.net), size: CGSize(width: 34, height: 14)) }
            }
            Source()
        }
        .padding(.top, 8).padding(.bottom, 4)
    }

    @ViewBuilder private func row(_ g: AroundGroup, glow: Bool) -> some View {
        let e = g.first
        switch e.kind {
        case .reply, .mention:
            if let c = e.cast {
                CastCard(cast: c, glow: glow, verb: e.kind == .reply ? "replied" : "said your name", yours: e.kind == .reply ? e.yours : nil)
            }
        default:
            AroundLine(group: g.items, glow: glow)
        }
    }

    @ViewBuilder private var tail: some View {
        let model = store.around
        VStack(spacing: 10) {
            if let f = model.failed {
                Text(f).font(.serif(13)).foregroundStyle(Ink.peach).multilineTextAlignment(.center)
                Button { Haptic.light(); Task { await model.again(store) } } label: { Text("Again").font(.serif(14, .semibold)).foregroundStyle(Ink.pole(store.net)) }
            } else if model.ended {
                Text("✦").foregroundStyle(Ink.gold)
                Text("Where it began.").font(.serif(13)).foregroundStyle(Ink.faint)
            } else if !model.items.isEmpty {
                Text("∞").font(.serif(22)).foregroundStyle(Ink.faint)
            }
        }
        .frame(maxWidth: .infinity).padding(.vertical, 24)
        // Scrolling past the end reads further back; again if the end is still in sight.
        .task(id: "\(model.items.count)-\(model.failed == nil)-\(model.busy)") {
            guard !model.items.isEmpty, !model.busy, !model.ended, model.failed == nil else { return }
            await model.more(store)
        }
    }
}

/// A like, a recast or a follow: one line. Several of the same cast in a row share it.
struct AroundLine: View {
    @Environment(Store.self) private var store
    @Environment(\.go) private var go
    let group: [AroundItem]
    var glow = false

    var body: some View {
        let e = group[0]
        let name = store.profiles[e.fid]?.name ?? "fid \(String(e.fid))"
        let verb = e.kind == .like ? "liked" : e.kind == .recast ? "recast" : "began following you"
        HStack(alignment: .center, spacing: 12) {
            Faces(fids: Array(group.prefix(5).map(\.fid)), size: 30)
                .overlay(alignment: .bottomLeading) { mark(e.kind).offset(x: -4, y: 5) }
            VStack(alignment: .leading, spacing: 3) {
                (Text(name).fontWeight(.semibold).foregroundColor(Ink.parchment)
                 + Text(group.count > 1 ? " and others" : "").foregroundColor(Ink.parchment)
                 + Text(" \(verb)").foregroundColor(Ink.mist))
                    .font(.serif(14)).lineLimit(2)
                if let y = e.yours {
                    Text(y.text.isEmpty ? "your cast" : y.rendered(store.names(for: y))).font(.serif(12)).foregroundStyle(Ink.faint).lineLimit(1)
                }
            }
            Spacer(minLength: 4)
            if e.kind == .follow { FollowBack(fid: e.fid) }
            Text(When.short(e.date)).font(.serif(12)).foregroundStyle(Ink.faint)
        }
        .padding(.horizontal, 14).padding(.vertical, 11)
        .background(Veil(big: 20, small: 7).fill(Color.white.opacity(0.04)))
        .overlay(Veil(big: 20, small: 7).strokeBorder((glow ? Ink.pole(store.net) : Ink.gold).opacity(glow ? 0.8 : 0.14), lineWidth: glow ? 1.1 : 0.6))
        .shadow(color: glow ? Ink.pole(store.net).opacity(0.4) : .clear, radius: 10)
        .contentShape(Rectangle())
        .onTapGesture { if let y = e.yours { go(.thread(y)) } else { go(.person(e.fid)) } }
    }

    private func mark(_ k: AroundItem.Kind) -> some View {
        let (sym, color): (String, Color) = k == .like ? ("heart.fill", Ink.carmine) : k == .recast ? ("arrow.2.squarepath", Ink.verdigris) : ("plus", Ink.pole(store.net))
        return Image(systemName: sym).font(.system(size: 8, weight: .bold)).foregroundStyle(Ink.night)
            .frame(width: 16, height: 16).background(Circle().fill(color)).overlay(Circle().strokeBorder(Ink.night, lineWidth: 1.2))
    }
}

/// Faces, overlapping a little, each its own way to that person.
struct Faces: View {
    @Environment(Store.self) private var store
    @Environment(\.go) private var go
    let fids: [UInt64]
    var size: CGFloat = 22
    var body: some View {
        HStack(spacing: -size * 0.32) {
            ForEach(Array(fids.enumerated()), id: \.offset) { i, f in
                Aura(profile: store.profiles[f], fid: f, size: size)
                    .overlay(Circle().strokeBorder(Ink.night.opacity(0.8), lineWidth: 1.2))
                    .zIndex(Double(fids.count - i))
                    .onTapGesture { go(.person(f)) }
            }
        }
    }
}

struct FollowBack: View {
    @Environment(Store.self) private var store
    let fid: UInt64
    var body: some View {
        let on = store.follows(fid)
        Button { Task { await store.toggleFollow(fid) } } label: {
            Text(on ? "Following" : "Follow back").font(.serif(12, .semibold))
                .foregroundStyle(on ? Ink.mist : Ink.night)
                .padding(.horizontal, 11).padding(.vertical, 6)
                .background(Capsule().fill(on ? AnyShapeStyle(Color.white.opacity(0.07)) : AnyShapeStyle(Ink.pole(store.net))))
        }
        .buttonStyle(Press())
        .animation(.spring(duration: 0.3), value: on)
    }
}

/// Why a cast is in For you, in words and faces.
struct Reasons: View {
    @Environment(Store.self) private var store
    let why: [Why]
    let author: UInt64

    private func handle(_ f: UInt64) -> String { store.profiles[f]?.username.map { "@\($0)" } ?? store.profiles[f]?.name ?? "someone" }

    var body: some View {
        let faces = Array(why.flatMap(\.fids).reduce(into: [UInt64]()) { if !$0.contains($1) { $0.append($1) } }.prefix(5))
        let words: [String] = why.map { w in
            switch w.kind {
            case .liked: return "\(handle(w.fids.first ?? 0))\(w.fids.count > 1 ? " and others" : "") liked this"
            case .recast: return "recast by \(handle(w.fids.first ?? 0))\(w.fids.count > 1 ? " and others" : "")"
            case .question: return "asks a question"
            case .near: return "\(handle(author)) has been around you"
            case .new: return "new to you"
            }
        }
        HStack(spacing: 8) {
            if !faces.isEmpty { Faces(fids: faces, size: 18) }
            Text(words.joined(separator: " · ")).font(.serif(12)).foregroundStyle(Ink.mist).lineLimit(2)
        }
    }
}

/// The cast of yours a reply answers: one faint line above the reply, the way a thread reads.
struct YoursLine: View {
    @Environment(Store.self) private var store
    @Environment(\.go) private var go
    let cast: Cast
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: "arrowshape.turn.up.left").font(.system(size: 10)).foregroundStyle(Ink.pole(store.net))
            Text("to your cast").font(.serif(12)).foregroundStyle(Ink.faint)
            Text(cast.text.isEmpty ? "" : "“\(cast.rendered(store.names(for: cast)).replacingOccurrences(of: "\n", with: " "))”")
                .font(.serif(12)).italic().foregroundStyle(Ink.faint).lineLimit(1)
        }
        .contentShape(Rectangle())
        .onTapGesture { go(.thread(cast)) }
    }
}

/// The Around glyph: a drop with two ripple rings.
struct DropGlyph: View {
    var body: some View {
        Canvas { ctx, s in
            let cx = s.width / 2, base = s.height * 0.78
            for (k, w) in [(0, 0.95), (1, 0.62)] {
                let rw = s.width * w, rh = s.height * (k == 0 ? 0.36 : 0.22)
                ctx.stroke(Path(ellipseIn: CGRect(x: cx - rw / 2, y: base - rh / 2, width: rw, height: rh)), with: .foreground, lineWidth: k == 0 ? 0.7 : 1)
            }
            var d = Path()
            let top = CGPoint(x: cx, y: 0.5), r = s.height * 0.2, c = CGPoint(x: cx, y: s.height * 0.5)
            d.move(to: top)
            d.addQuadCurve(to: CGPoint(x: c.x + r, y: c.y), control: CGPoint(x: c.x + r * 0.9, y: c.y - r * 1.1))
            d.addArc(center: c, radius: r, startAngle: .degrees(0), endAngle: .degrees(180), clockwise: false)
            d.addQuadCurve(to: top, control: CGPoint(x: c.x - r * 0.9, y: c.y - r * 1.1))
            ctx.fill(d, with: .foreground)
        }
    }
}
