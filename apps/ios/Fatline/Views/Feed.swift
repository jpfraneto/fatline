import SwiftUI

/// Where the feed comes from, always said: network, node, whose node, how far behind.
struct Source: View {
    @Environment(Store.self) private var store
    var body: some View {
        HStack(spacing: 8) {
            Circle().fill(store.live ? Ink.pole(store.net) : Ink.faint).frame(width: 6, height: 6)
                .shadow(color: Ink.pole(store.net), radius: store.live ? 4 : 0)
            if let n = store.node {
                let s = store.statuses[n.url]
                Text("\(store.net.label) · \(n.label)\(n.own ? "" : " · not yours")\(s.map { $0.ok ? "" : " · \($0.blockDelay ?? 0)s behind" } ?? "")")
            } else {
                Text("\(store.net.label) · no node answers")
            }
        }
        .font(.serif(12)).foregroundStyle(Ink.mist).lineLimit(1)
    }
}

struct FeedView: View {
    @Environment(Store.self) private var store
    @Environment(\.go) private var go
    @Binding var settings: Bool
    @State private var atTop = true
    @State private var latestHeld = Held<Cast>()
    @State private var picksHeld = Held<Pick>()
    /// The landing is For you; Latest is everyone you follow, newest first.
    @AppStorage("feedMode") private var mode = "foryou"
    private var forYou: Bool { mode == "foryou" }

    var body: some View {
        ScrollViewReader { reader in
            ScrollView {
                LazyVStack(spacing: 14) {
                    header.id("top")
                    if forYou { picks } else { latest }
                }
                .padding(.horizontal, 14)
                .padding(.bottom, 20)
                .animation(.spring(duration: 0.5, bounce: 0.25), value: forYou ? picksHeld.shown.first?.id : latestHeld.shown.first?.id)
            }
            .scrollIndicators(.hidden)
            .refreshable {
                Haptic.light()
                if forYou { await store.forYou.build(store) } else { store.gather() }
            }
            .onScrollGeometryChange(for: Bool.self) { $0.contentOffset.y < 60 } action: { _, top in
                atTop = top
                if top { latestHeld.release(); picksHeld.release() }
            }
            // New casts never move what you are reading: they wait behind the pill.
            .onChange(of: store.feed.map(\.id), initial: true) { latestHeld.offer(store.feed, atTop: atTop, time: { $0.timestamp }) }
            .onChange(of: store.forYou.picks.map(\.id), initial: true) { picksHeld.offer(store.forYou.picks, atTop: atTop) }
            .newPill(forYou ? picksHeld.waiting : latestHeld.waiting) {
                latestHeld.release(); picksHeld.release()
                withAnimation(.spring(duration: 0.6)) { reader.scrollTo("top", anchor: .top) }
            }
            .onChange(of: store.retap) { _, t in
                if t.tab == .feed { withAnimation(.spring(duration: 0.6)) { reader.scrollTo("top", anchor: .top) } }
            }
        }
    }

    @ViewBuilder private var latest: some View {
        if store.feed.isEmpty {
            VStack(spacing: 14) { Breathing(size: CGSize(width: 90, height: 34)); Inscription("gathering") }.padding(.top, 80)
        }
        ForEach(latestHeld.shown) { c in
            CastCard(cast: c, glow: store.fresh.contains(c.id))
                .transition(.asymmetric(insertion: .scale(scale: 0.92).combined(with: .opacity), removal: .opacity))
        }
    }

    @ViewBuilder private var picks: some View {
        let m = store.forYou
        if m.picks.isEmpty {
            VStack(spacing: 14) {
                if let f = m.failed, !m.building {
                    Text(f).font(.serif(13)).foregroundStyle(Ink.peach).multilineTextAlignment(.center)
                    Button { Task { await m.build(store) } } label: { Text("Again").font(.serif(14, .semibold)).foregroundStyle(Ink.pole(store.net)) }
                } else if !m.building && m.builtAt != nil {
                    Text("Nothing new in the last day and a half.").font(.serif(13)).foregroundStyle(Ink.faint)
                } else {
                    Breathing(size: CGSize(width: 90, height: 34)); Inscription("gathering")
                }
            }
            .padding(.top, 80)
        }
        ForEach(picksHeld.shown) { p in
            CastCard(cast: p.cast, why: p.why)
                .transition(.opacity)
        }
        if !m.picks.isEmpty {
            Button { Haptic.select(); withAnimation(.spring(duration: 0.4)) { mode = "latest" } } label: {
                Text("Everything, newest first").font(.serif(13)).foregroundStyle(Ink.faint)
            }
            .padding(.vertical, 18)
        }
    }

    private func modeButton(_ m: String, _ title: String) -> some View {
        Button {
            guard mode != m else { return }
            Haptic.select()
            withAnimation(.spring(duration: 0.4)) { mode = m }
            if m == "foryou", store.forYou.stale(store) { Task { await store.forYou.build(store) } }
        } label: {
            Text(title).font(.serif(mode == m ? 26 : 16, .light)).foregroundStyle(mode == m ? Ink.parchment : Ink.faint)
        }
        .buttonStyle(.plain)
    }

    private var header: some View {
        let p = Planet.today
        return VStack(spacing: 10) {
            HStack(alignment: .center) {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text(p.glyph).font(.serif(22)).foregroundStyle(p.color).shadow(color: p.color, radius: 6)
                    modeButton("foryou", "For you")
                    modeButton("latest", "Latest")
                }
                Spacer()
                Button { Haptic.select(); settings = true } label: { NetSwitch(compact: true) }.buttonStyle(Press())
            }
            HStack {
                Source()
                Spacer()
                if forYou && store.forYou.building {
                    Breathing(color: Ink.pole(store.net), size: CGSize(width: 34, height: 14))
                } else if !forYou, let g = store.gathering {
                    HStack(spacing: 6) { Breathing(color: Ink.pole(store.net), size: CGSize(width: 34, height: 14)); Text("\(g.done)/\(g.total)") }
                        .font(.serif(11)).foregroundStyle(Ink.faint)
                }
            }
        }
        .padding(.top, 8).padding(.bottom, 4)
    }
}

/// The network switch as a lemniscate: the warm loop is Snapchain, the cool loop Hypersnap. Touch a loop to cross.
struct NetSwitch: View {
    @Environment(Store.self) private var store
    var compact = false
    var body: some View {
        let w: CGFloat = compact ? 64 : 220, h: CGFloat = compact ? 24 : 70
        ZStack {
            Lemniscate().stroke(LinearGradient(colors: [Ink.gold, Ink.carmine, Ink.lilac, Ink.azure], startPoint: .leading, endPoint: .trailing).opacity(0.7), lineWidth: compact ? 1.1 : 1.6)
            Circle().fill(Ink.pole(store.net)).frame(width: compact ? 7 : 14).shadow(color: Ink.pole(store.net), radius: 6)
                .offset(x: (store.net == .snapchain ? -1 : 1) * w * 0.36)
                .animation(.spring(duration: 0.8, bounce: 0.3), value: store.net)
            if !compact {
                HStack {
                    Button { cross(.snapchain) } label: { Color.clear.contentShape(Rectangle()) }
                    Button { cross(.hypersnap) } label: { Color.clear.contentShape(Rectangle()) }
                }
            }
        }
        .frame(width: w, height: h)
    }
    private func cross(_ n: Net) {
        guard n != store.net else { return }
        Haptic.heavy()
        Task { await store.switchTo(n) }
    }
}

struct CastCard: View {
    @Environment(Store.self) private var store
    @Environment(\.go) private var go
    let cast: Cast
    var glow = false
    var big = false
    var tappable = true
    var verb: String? = nil // "replied", "said your name": shown after the name (Around)
    var yours: Cast? = nil // the cast of yours this answers: one faint line
    var why: [Why]? = nil // why it is here (For you)
    @State private var replying = false
    @State private var burst = 0

    var body: some View {
        let p = store.profiles[cast.fid]
        let liked = store.liked.contains(cast.id)
        VStack(alignment: .leading, spacing: 10) {
            if let why, !why.isEmpty { Reasons(why: why, author: cast.fid) }
            Button { go(.person(cast.fid)) } label: {
                HStack(spacing: 12) {
                    Aura(profile: p, fid: cast.fid, size: big ? 50 : 40)
                    VStack(alignment: .leading, spacing: 1) {
                        HStack(spacing: 5) {
                            Text(p?.name ?? "fid \(String(cast.fid))").font(.serif(big ? 18 : 16, .semibold)).foregroundStyle(Ink.parchment).lineLimit(1)
                            if let verb { Text(verb).font(.serif(14)).foregroundStyle(Ink.mist).lineLimit(1).layoutPriority(1) }
                        }
                        Text(p?.handle ?? "").font(.serif(12)).foregroundStyle(Ink.faint).lineLimit(1)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(When.short(cast.date)).font(.serif(12)).foregroundStyle(Ink.faint)
                        if let ch = cast.parentUrl.flatMap(channelName) { Text("/\(ch)").font(.serif(11)).foregroundStyle(Ink.faint).lineLimit(1) }
                    }
                }
            }
            .buttonStyle(.plain)
            // A reply in Around: which cast of yours it answers, above its words (a quote sits below, framed).
            if let yours { YoursLine(cast: yours) }
            if !cast.text.isEmpty {
                Text(.init(cast.rendered(store.names(for: cast))))
                    .font(.serif(big ? 19 : 16.5)).foregroundStyle(Ink.parchment).lineSpacing(3)
                    .tint(Ink.peach)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            ForEach(Array(cast.embeds.enumerated()), id: \.offset) { _, e in EmbedView(embed: e) }
            ActionRow(cast: cast)
        }
        .veil(glow: glow ? Ink.pole(store.net) : nil)
        .overlay { HeartBurst(trigger: burst) }
        .contentShape(Veil())
        .onTapGesture(count: 2) {
            burst += 1
            if !liked { Task { await store.react(.like, cast) } } else { Haptic.light() }
        }
        .onTapGesture { if tappable { go(.thread(cast)) } }
        .contextMenu {
            Button { replying = true } label: { Label("Reply", systemImage: "arrowshape.turn.up.left") }
            Button { UIPasteboard.general.string = cast.text; Haptic.success() } label: { Label("Copy text", systemImage: "doc.on.doc") }
            if let link { ShareLink(item: link) { Label("Share", systemImage: "square.and.arrow.up") } }
            Button { go(.person(cast.fid)) } label: { Label(p?.handle ?? "Profile", systemImage: "person.crop.circle") }
        }
        .sheet(isPresented: $replying) { Compose(parent: cast) }
        .task { await store.ensureProfiles([cast.fid] + cast.mentions) }
    }

    private var link: URL? {
        guard let u = store.profiles[cast.fid]?.username else { return nil }
        return URL(string: "https://farcaster.xyz/\(u)/\(cast.id.prefix(10))")
    }

    private func channelName(_ url: String) -> String? {
        url.split(separator: "/").last.map(String.init).flatMap { $0.count < 30 && !$0.contains(":") ? $0 : nil }
    }
}

/// A heart that blooms and rises where you double-tapped.
private struct HeartBurst: View {
    let trigger: Int
    @State private var shown = false
    var body: some View {
        Image(systemName: "heart.fill")
            .font(.system(size: 76))
            .foregroundStyle(LinearGradient(colors: [Ink.peach, Ink.carmine], startPoint: .top, endPoint: .bottom))
            .shadow(color: Ink.carmine.opacity(0.8), radius: 18)
            .scaleEffect(shown ? 1.15 : 0.3)
            .offset(y: shown ? -20 : 10)
            .opacity(shown ? 1 : 0)
            .allowsHitTesting(false)
            .onChange(of: trigger) {
                withAnimation(.spring(duration: 0.35, bounce: 0.55)) { shown = true }
                Task {
                    try? await Task.sleep(for: .milliseconds(550))
                    withAnimation(.easeOut(duration: 0.35)) { shown = false }
                }
            }
    }
}

struct EmbedView: View {
    @Environment(Store.self) private var store
    @Environment(\.go) private var go
    let embed: Embed
    @State private var quoted: Cast?

    var body: some View {
        switch embed {
        case .url(let u) where embed.isImage:
            AsyncImage(url: URL(string: u)) { img in img.resizable().scaledToFit() } placeholder: {
                Veil(big: 18, small: 6).fill(Color.white.opacity(0.04)).frame(height: 180).overlay(Breathing(color: Ink.faint))
            }
            .frame(maxWidth: .infinity, maxHeight: 380)
            .clipShape(Veil(big: 18, small: 6))
        case .url(let u):
            if let url = URL(string: u) {
                Link(destination: url) {
                    HStack(spacing: 8) {
                        Image(systemName: "link").font(.system(size: 11))
                        Text(url.host() ?? u).font(.serif(13)).lineLimit(1)
                    }
                    .foregroundStyle(Ink.peach)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(Veil(big: 14, small: 5).fill(Color.white.opacity(0.05)))
                }
                .simultaneousGesture(TapGesture().onEnded { Haptic.light() })
            }
        case .cast(let ref):
            VStack(alignment: .leading, spacing: 6) {
                if let q = quoted {
                    HStack(spacing: 8) {
                        Aura(profile: store.profiles[q.fid], fid: q.fid, size: 20)
                        Text(store.profiles[q.fid]?.name ?? "fid \(String(q.fid))").font(.serif(13, .semibold)).foregroundStyle(Ink.mist)
                    }
                    Text(q.text).font(.serif(14)).foregroundStyle(Ink.mist).lineLimit(5)
                } else {
                    Breathing(color: Ink.faint, size: CGSize(width: 34, height: 14))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .overlay(Veil(big: 16, small: 6).strokeBorder(Ink.lilac.opacity(0.3), lineWidth: 0.7))
            .contentShape(Rectangle())
            .onTapGesture { if let q = quoted { go(.thread(q)) } }
            .task {
                quoted = try? await store.hub?.cast(ref)
                if let q = quoted { await store.ensureProfiles([q.fid]) }
            }
        }
    }
}

/// The back chevron used on pushed pages (the swipe from the left edge works too).
struct Back: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        Button { Haptic.light(); dismiss() } label: {
            Image(systemName: "chevron.left").font(.system(size: 18, weight: .medium)).foregroundStyle(Ink.parchment)
                .frame(width: 40, height: 40).background(Circle().fill(Color.white.opacity(0.06)))
        }
        .buttonStyle(Press())
    }
}

struct Thread: View {
    @Environment(Store.self) private var store
    @Environment(\.go) private var go
    let root: Cast
    @State private var parent: Cast?
    @State private var replies: [Cast] = []
    @State private var loading = true
    @State private var counts: (likes: Int, recasts: Int)?

    var body: some View {
        ZStack {
            Lazure(net: store.net)
            ScrollView {
                VStack(spacing: 14) {
                    HStack { Back(); Spacer(); Source() }
                    if let parent {
                        CastCard(cast: parent).opacity(0.75)
                        Rectangle().fill(LinearGradient(colors: [Ink.faint, .clear], startPoint: .top, endPoint: .bottom)).frame(width: 1, height: 18)
                    }
                    CastCard(cast: root, big: true, tappable: false)
                    if let counts {
                        HStack(spacing: 18) { Text("\(counts.likes) hearts"); Text("\(counts.recasts) recasts") }
                            .font(.serif(12)).foregroundStyle(Ink.faint)
                    }
                    if loading { Breathing().padding(20) }
                    ForEach(replies) { r in CastCard(cast: r).padding(.leading, 18) }
                }
                .padding(.horizontal, 14).padding(.bottom, 90)
            }
            .scrollIndicators(.hidden)
        }
        .task {
            guard let hub = store.hub else { return }
            async let r = (try? hub.replies(root.ref)) ?? []
            async let l = hub.reactionCount(root.ref, kind: .like)
            async let rc = hub.reactionCount(root.ref, kind: .recast)
            if let p = root.parent { parent = try? await hub.cast(p) }
            replies = await r
            counts = (await l, await rc)
            loading = false
            await store.ensureProfiles(replies.map(\.fid) + [parent?.fid].compactMap { $0 })
        }
    }
}
