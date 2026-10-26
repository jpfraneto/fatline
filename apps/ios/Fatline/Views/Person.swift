import SwiftUI

/// A person: you (fid nil) or anyone you tap on.
struct PersonView: View {
    @Environment(Store.self) private var store
    @Environment(Constellation.self) private var constellation
    let fid: UInt64?
    var settings: Binding<Bool>? = nil
    @State private var casts: [Cast] = []
    @State private var followers: Int?
    @State private var following: Int?
    @State private var loading = true

    private var who: UInt64 { fid ?? store.me }
    private var isMe: Bool { who == store.me }

    var body: some View {
        let p = store.profiles[who]
        ScrollViewReader { reader in
            ScrollView {
                VStack(spacing: 18) {
                    HStack {
                        if fid != nil { Back() }
                        Spacer()
                        if let settings {
                            Button { Haptic.select(); settings.wrappedValue = true } label: {
                                Image(systemName: "gearshape").font(.system(size: 17, weight: .light)).foregroundStyle(Ink.mist)
                                    .frame(width: 40, height: 40).background(Circle().fill(Color.white.opacity(0.06)))
                            }
                            .buttonStyle(Press())
                        }
                    }
                    .id("top")
                    ZStack {
                        Seal(sides: 7, swell: 0.18).stroke(LinearGradient(colors: [Ink.gold, Ink.lilac], startPoint: .top, endPoint: .bottom), lineWidth: 0.8)
                            .frame(width: 170, height: 170)
                        Seal(sides: 7, swell: 0.18, turn: .pi / 2).stroke(Ink.peach.opacity(0.35), lineWidth: 0.6).frame(width: 150, height: 150)
                        Aura(profile: p, fid: who, size: 100)
                    }
                    VStack(spacing: 4) {
                        Text(p?.name ?? "…").font(.serif(30, .light)).foregroundStyle(Ink.parchment)
                        Text("\(p?.handle ?? "") · fid \(String(who))").font(.serif(13)).foregroundStyle(Ink.faint)
                    }
                    if let bio = p?.bio, !bio.isEmpty {
                        Text(bio).font(.serif(15)).italic().foregroundStyle(Ink.mist).multilineTextAlignment(.center).padding(.horizontal, 20)
                    }
                    HStack(spacing: 34) {
                        count(isMe ? store.follows.count : following, "following")
                        count(followers, "followers")
                    }
                    if !isMe { followButton }
                    if let b = constellation.beings.first(where: { $0.fid == who }) { FatlineCard(being: b, mine: isMe) }
                    if isMe { key }
                    if loading && casts.isEmpty { Breathing().padding(20) }
                    ForEach(casts) { c in CastCard(cast: c) }
                }
                .padding(.horizontal, 14).padding(.bottom, 20)
            }
            .scrollIndicators(.hidden)
            .refreshable { Haptic.light(); await load() }
            .onChange(of: store.retap) { _, t in
                if t.tab == .me, fid == nil { withAnimation(.spring(duration: 0.6)) { reader.scrollTo("top", anchor: .top) } }
            }
        }
        .background { if fid != nil { Lazure(net: store.net) } }
        .task(id: "\(who)-\(store.node?.url ?? "")") { await load() }
    }

    private func load() async {
        guard let hub = store.hub else { return }
        await store.ensureProfiles([who])
        casts = (try? await hub.casts(fid: who, pageSize: 40)) ?? casts
        loading = false
        if constellation.beings.isEmpty { await constellation.ask() }
        if !isMe { following = try? await hub.following(fid: who).count }
        followers = try? await hub.followers(fid: who)
    }

    private var followButton: some View {
        let on = store.follows(who)
        return Button { Task { await store.toggleFollow(who) } } label: {
            Text(on ? "Following" : "Follow").font(.serif(15, .semibold))
                .foregroundStyle(on ? Ink.parchment : Ink.night)
                .padding(.horizontal, 30).padding(.vertical, 11)
                .background(Veil(big: 18, small: 6).fill(on ? AnyShapeStyle(Color.white.opacity(0.08)) : AnyShapeStyle(LinearGradient(colors: [Ink.pole(store.net), Ink.peach], startPoint: .leading, endPoint: .trailing))))
                .overlay(Veil(big: 18, small: 6).strokeBorder(Ink.mist.opacity(on ? 0.4 : 0), lineWidth: 0.7))
        }
        .buttonStyle(Press())
        .disabled(!store.canCast)
        .animation(.spring(duration: 0.35), value: on)
    }

    private func count(_ n: Int?, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(n.map { "\($0)" } ?? "·").font(.serif(20, .light)).foregroundStyle(Ink.parchment).monospacedDigit()
                .contentTransition(.numericText())
            Inscription(label, color: Ink.faint, size: 9)
        }
        .animation(.default, value: n)
    }

    @ViewBuilder private var key: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Inscription("this phone's key", color: Ink.faint, size: 10)
                Spacer()
                if store.canCast {
                    Text("active").font(.serif(12)).foregroundStyle(Ink.verdigris)
                } else if store.signer?.state == "pending" {
                    Text("waiting for approval").font(.serif(12)).foregroundStyle(Ink.peach)
                }
            }
            if let s = store.signer {
                Text(s.publicKey.prefix(10) + "…" + s.publicKey.suffix(6)).font(.system(size: 12, design: .monospaced)).foregroundStyle(Ink.mist)
            } else {
                Button { Haptic.medium(); Task { await store.signIn() } } label: {
                    Text("Approve one in the Farcaster app").font(.serif(14)).foregroundStyle(Ink.peach)
                }
            }
        }
        .veil()
    }
}

/// A Fatline's egg, as the genesis hatchery sees it.
struct FatlineCard: View {
    let being: Being; let mine: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Inscription(mine ? "your fatline" : "fatline", color: Ink.faint, size: 10)
                Spacer()
                Text(being.surname).font(.serif(15, .semibold)).tracking(3).foregroundStyle(Ink.gold)
            }
            HStack(spacing: 10) {
                ForEach(0..<(being.needed ?? 3), id: \.self) { i in
                    Seal(sides: 7).fill(i < (being.warmDays ?? 0) ? AnyShapeStyle(Ink.gold) : AnyShapeStyle(Ink.faint.opacity(0.25)))
                        .frame(width: 16, height: 16).shadow(color: i < (being.warmDays ?? 0) ? Ink.gold : .clear, radius: 5)
                }
                Text(being.hatched ? "hatched" : "\(being.warmDays ?? 0) of \(being.needed ?? 3) warm days").font(.serif(13)).foregroundStyle(Ink.mist)
                Spacer()
                Text(being.awake ? "awake" : being.asked ? "asleep" : "…").font(.serif(12)).foregroundStyle(being.awake ? Ink.verdigris : Ink.faint)
            }
        }
        .veil()
    }
}
