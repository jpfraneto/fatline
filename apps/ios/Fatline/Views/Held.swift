// New things never move what you are reading. A list shows what it showed; newer things wait behind a pill at the
// top and come in when you tap it or scroll back to the top yourself. At the top already, they come in at once.
// Older things (read further back) join at the bottom, where they move nothing. The same rule as the web (fresh.js).
import SwiftUI

struct Held<Item: Identifiable>: Equatable where Item.ID == String {
    private(set) var shown: [Item] = []
    private(set) var waiting = 0 // newer things behind the pill
    private var pending: [Item]?

    static func == (a: Held, b: Held) -> Bool { a.shown.map(\.id) == b.shown.map(\.id) && a.waiting == b.waiting }

    /// The list as it is now. `time`: when each item happened, to tell older from newer (nil: an order that is not
    /// time, like For you's picks; then anything new waits).
    mutating func offer(_ incoming: [Item], atTop: Bool, time: ((Item) -> UInt64)? = nil) {
        if atTop || shown.isEmpty { take(incoming); return }
        let known = Set(shown.map(\.id))
        let unseen = incoming.filter { !known.contains($0.id) }
        guard !unseen.isEmpty else { return }
        var older: [Item] = []
        if let time, let last = shown.map(time).min() { older = unseen.filter { time($0) < last } }
        shown += older
        let newer = unseen.count - older.count
        if newer > 0 { pending = incoming; waiting = newer }
    }

    /// Back at the top (or the pill tapped): everything waiting comes in.
    mutating func release() { if let p = pending { take(p) } }

    private mutating func take(_ items: [Item]) { shown = items; pending = nil; waiting = 0 }
}

/// The pill at the top: how many new things are waiting. Tapping it brings them in and goes to the top.
struct NewPill: View {
    @Environment(Store.self) private var store
    let count: Int
    let action: () -> Void
    var body: some View {
        Button { Haptic.light(); action() } label: {
            HStack(spacing: 8) {
                Image(systemName: "arrow.up").font(.system(size: 12, weight: .bold))
                Text("\(count) new").font(.serif(14, .semibold))
            }
            .foregroundStyle(Ink.night)
            .padding(.horizontal, 16).padding(.vertical, 9)
            .background(Capsule().fill(LinearGradient(colors: [Ink.pole(store.net), Ink.peach], startPoint: .leading, endPoint: .trailing)))
            .shadow(color: Ink.pole(store.net).opacity(0.6), radius: 10)
        }
        .buttonStyle(Press())
        .padding(.top, 6)
        .transition(.move(edge: .top).combined(with: .opacity))
    }
}

extension View {
    /// The pill over a scroll view, shown while something waits.
    func newPill(_ count: Int, action: @escaping () -> Void) -> some View {
        overlay(alignment: .top) { if count > 0 { NewPill(count: count, action: action) } }
            .animation(.spring(duration: 0.4), value: count > 0)
    }
}
