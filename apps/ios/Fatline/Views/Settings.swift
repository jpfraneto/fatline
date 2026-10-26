import SwiftUI

struct SettingsView: View {
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var checking = false

    var body: some View {
        @Bindable var store = store
        ZStack {
            Lazure(net: store.net)
            ScrollView {
                VStack(spacing: 22) {
                    HStack {
                        Spacer()
                        Button { dismiss() } label: { Image(systemName: "xmark").font(.system(size: 15, weight: .light)).foregroundStyle(Ink.mist).padding(8) }
                    }
                    VStack(spacing: 12) {
                        NetSwitch()
                        HStack {
                            Text("Snapchain").foregroundStyle(store.net == .snapchain ? Ink.gold : Ink.faint)
                            Spacer()
                            Text("Hypersnap").foregroundStyle(store.net == .hypersnap ? Ink.lilac : Ink.faint)
                        }
                        .font(.serif(16)).frame(width: 240)
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Inscription("node", color: Ink.faint, size: 10)
                            Spacer()
                            if checking { Breathing(size: CGSize(width: 34, height: 14)) }
                        }
                        nodeRow(nil)
                        ForEach(store.net.nodes) { nodeRow($0) }
                    }
                    .veil()

                    VStack(alignment: .leading, spacing: 12) {
                        Toggle(isOn: $store.keepAwake) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Always on").font(.serif(16)).foregroundStyle(Ink.parchment)
                                Text("The screen stays lit while the stream is open.").font(.serif(12)).foregroundStyle(Ink.faint)
                            }
                        }
                        .tint(Ink.pole(store.net))
                    }
                    .veil()

                    VStack(alignment: .leading, spacing: 10) {
                        Inscription("key", color: Ink.faint, size: 10)
                        if let s = store.signer {
                            Text("\(s.state == "active" ? "Active" : "Waiting for approval") · fid \(s.fid.map(String.init) ?? "?")")
                                .font(.serif(15)).foregroundStyle(Ink.parchment)
                            Text(s.publicKey).font(.system(size: 11, design: .monospaced)).foregroundStyle(Ink.faint).textSelection(.enabled)
                            if s.state == "pending" {
                                Button("Open the Farcaster app") { if let l = s.deeplink, let u = URL(string: l) { UIApplication.shared.open(u) } }
                                    .font(.serif(14)).foregroundStyle(Ink.peach)
                            }
                            Button("Forget on this phone") { store.forgetKey() }.font(.serif(14)).foregroundStyle(Ink.carmine)
                        } else {
                            Button { Task { await store.signIn() } } label: {
                                Text(store.signingIn ? "…" : "Approve a key in the Farcaster app").font(.serif(15)).foregroundStyle(Ink.peach)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .veil()
                }
                .padding(20)
            }
        }
        .presentationBackground(.clear)
        .task { checking = true; await store.checkNodes(); checking = false }
    }

    private func nodeRow(_ n: Node?) -> some View {
        let pinned = store.pinned[store.net.rawValue]
        let selected = n == nil ? pinned == nil : pinned == n?.url
        let s = n.flatMap { store.statuses[$0.url] }
        return Button { Task { await store.pin(n?.url) } } label: {
            HStack(spacing: 12) {
                Seal(sides: 7).fill(selected ? AnyShapeStyle(Ink.pole(store.net)) : AnyShapeStyle(Color.clear))
                    .overlay(Seal(sides: 7).stroke(Ink.mist, lineWidth: 0.8)).frame(width: 14, height: 14)
                VStack(alignment: .leading, spacing: 2) {
                    if let n {
                        Text("\(n.label)\(n.own ? " · yours" : "")").font(.serif(15)).foregroundStyle(Ink.parchment)
                        Text(describe(s)).font(.serif(12)).foregroundStyle(s?.ok == true ? Ink.verdigris : Ink.faint)
                    } else {
                        Text("First in step").font(.serif(15)).foregroundStyle(Ink.parchment)
                        Text("Yours first; reading now: \(store.node?.label ?? "none")").font(.serif(12)).foregroundStyle(Ink.faint)
                    }
                }
                Spacer()
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func describe(_ s: NodeStatus?) -> String {
        guard let s else { return "…" }
        if let e = s.error { return "silent · \(e.prefix(40))" }
        let lag = s.blockDelay.map { $0 <= NodeStatus.healthyDelay ? "in step" : "\($0)s behind" } ?? ""
        return [lag, s.version.map { "v\($0)" }, s.latencyMs.map { "\($0) ms" }].compactMap { $0 }.joined(separator: " · ")
    }
}
