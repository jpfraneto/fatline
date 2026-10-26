import SwiftUI

struct Compose: View {
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    let parent: Cast?
    @State private var text = ""
    @State private var sending = false
    @State private var error: String?
    @FocusState private var focused: Bool

    private var bytes: Int { text.trimmingCharacters(in: .whitespacesAndNewlines).utf8.count }
    private var limit: Int { bytes > Farcaster.castMaxBytes ? Farcaster.longCastMaxBytes : Farcaster.castMaxBytes }

    var body: some View {
        ZStack {
            Lazure(net: store.net)
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Button { dismiss() } label: { Image(systemName: "xmark").font(.system(size: 15, weight: .light)).foregroundStyle(Ink.mist).padding(8) }
                    Spacer()
                    Source()
                }
                if let parent {
                    HStack(alignment: .top, spacing: 10) {
                        Aura(profile: store.profiles[parent.fid], fid: parent.fid, size: 24)
                        Text(parent.text).font(.serif(14)).foregroundStyle(Ink.mist).lineLimit(3)
                    }
                    .padding(.leading, 4)
                }
                ZStack(alignment: .topLeading) {
                    if text.isEmpty {
                        Text(parent == nil ? "what wants to be said?" : "answer")
                            .font(.serif(24, .light)).italic().foregroundStyle(Ink.faint).padding(.top, 8).padding(.leading, 5)
                    }
                    TextEditor(text: $text)
                        .font(.serif(24, .light)).foregroundStyle(Ink.parchment).scrollContentBackground(.hidden)
                        .focused($focused)
                }
                if let error { Text(error).font(.serif(13)).foregroundStyle(Ink.peach) }
                HStack(alignment: .center) {
                    ZStack {
                        Circle().stroke(Ink.faint.opacity(0.4), lineWidth: 2)
                        Circle().trim(from: 0, to: min(1, CGFloat(bytes) / CGFloat(limit)))
                            .stroke(bytes > limit ? Ink.carmine : Ink.pole(store.net), style: StrokeStyle(lineWidth: 2, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                        if bytes > Farcaster.castMaxBytes { Text("long").font(.serif(8)).foregroundStyle(Ink.mist) }
                    }
                    .frame(width: 30, height: 30)
                    Text("\(limit - bytes)").font(.serif(12)).foregroundStyle(Ink.faint).monospacedDigit()
                    Spacer()
                    if store.canCast {
                        Button(action: send) {
                            HStack(spacing: 10) {
                                if sending { Breathing(color: Ink.night, size: CGSize(width: 30, height: 12)) }
                                Inscription(sending ? "sending" : "cast", color: Ink.night, size: 13)
                            }
                            .padding(.horizontal, 26).padding(.vertical, 14)
                            .background(Veil(big: 20, small: 7).fill(LinearGradient(colors: [Ink.pole(store.net), Ink.peach], startPoint: .leading, endPoint: .trailing)))
                            .shadow(color: Ink.pole(store.net).opacity(0.6), radius: 12)
                        }
                        .disabled(sending || bytes == 0 || bytes > Farcaster.longCastMaxBytes)
                        .opacity(bytes == 0 ? 0.5 : 1)
                    } else {
                        Button { Task { await store.signIn() } } label: {
                            HStack(spacing: 8) {
                                if store.signingIn || store.signer?.state == "pending" { Breathing(color: Ink.night, size: CGSize(width: 30, height: 12)) }
                                Inscription(store.signer?.state == "pending" ? "approve in farcaster" : "give this phone a key", color: Ink.night, size: 11)
                            }
                            .padding(.horizontal, 20).padding(.vertical, 14)
                            .background(Veil(big: 20, small: 7).fill(Ink.peach))
                        }
                    }
                }
            }
            .padding(20)
        }
        .presentationBackground(.clear)
        .onAppear { focused = true }
    }

    private func send() {
        Haptic.medium()
        sending = true; error = nil
        Task {
            do {
                _ = try await store.cast(text.trimmingCharacters(in: .whitespacesAndNewlines), parent: parent?.ref)
                Haptic.success()
                dismiss()
            } catch {
                self.error = error.localizedDescription
                Haptic.fail()
                sending = false
            }
        }
    }
}
