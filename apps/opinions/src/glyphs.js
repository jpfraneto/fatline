// The bar's glyphs, drawn as the iOS app draws them (apps/ios/Fatline/FatlineApp.swift): the stream, the star, the pen.
// And the Farcaster arch, as on fatline.ink's LAUNCH button (apps/site/manual.js).

export const ARCH = '<svg viewBox="128.889 155.556 751.111 688.889" aria-hidden="true" focusable="false"><path fill="currentColor" d="M257.778 155.556h484.444v688.889h-71.111V528.889h-.697c-7.86-87.212-81.156-155.556-170.414-155.556s-162.554 68.344-170.414 155.556h-.697v315.556h-71.111z"/><path fill="currentColor" d="M128.889 253.333l28.889 97.778h24.444v395.556c-12.273 0-22.222 9.949-22.222 22.222v26.667h-4.444c-12.273 0-22.223 9.949-22.223 22.222v26.667h248.889v-26.667c0-12.273-9.949-22.222-22.222-22.222h-4.444v-26.667c0-12.273-9.95-22.222-22.223-22.222h-26.666V253.333zM675.556 746.667c-12.273 0-22.223 9.949-22.223 22.222v26.667h-4.444c-12.273 0-22.222 9.949-22.222 22.222v26.667h248.889v-26.667c0-12.273-9.95-22.222-22.223-22.222h-4.444v-26.667c0-12.273-9.949-22.222-22.222-22.222V351.111h24.444L880 253.333H702.222v493.334z"/></svg>';

// Three gently waving lines (StreamGlyph).
export const STREAM = '<svg viewBox="0 0 26 20" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M1 5c8.3-5 8.7 5 24 0"/><path d="M1 10c8.3-5 8.7 5 24 0"/><path d="M1 15c8.3-5 8.7 5 24 0"/></g></svg>';

// A star with three points around it (StarGlyph).
export const STAR = '<svg viewBox="0 0 26 20" aria-hidden="true" focusable="false"><g stroke="currentColor" stroke-width=".6"><path d="M13 10L3 4M13 10l10-4M13 10l2 8"/></g><g fill="currentColor"><circle cx="3" cy="4" r="2"/><circle cx="23" cy="6" r="2"/><circle cx="15" cy="18" r="2"/><circle cx="13" cy="10" r="3.5"/></g></svg>';

// A quill's long line, for Voices (only where a Voices contract is set).
export const VOICE = '<svg viewBox="0 0 26 20" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M3 5h20M3 10h20M3 15h12"/></g></svg>';

// Square and pencil (SF Symbol square.and.pencil), for the seal.
export const PEN = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/><path d="M17.6 2.9a2.1 2.1 0 0 1 3 3L12 14.5l-4 1 1-4z"/></g></svg>';

// Around: a drop and the rings it sends out.
export const RIPPLE = '<svg viewBox="0 0 26 20" aria-hidden="true" focusable="false"><circle cx="13" cy="10" r="2.2" fill="currentColor"/><g fill="none" stroke="currentColor" stroke-linecap="round"><ellipse cx="13" cy="10" rx="6.5" ry="4.6" stroke-width="1.2"/><ellipse cx="13" cy="10" rx="11.5" ry="8.4" stroke-width=".8" opacity=".6"/></g></svg>';

/** A span holding one of the glyphs above (our own markup, never data). */
export function glyph(markup, cls = 'glyph') {
  const s = document.createElement('span');
  s.className = cls;
  s.innerHTML = markup;
  return s;
}
