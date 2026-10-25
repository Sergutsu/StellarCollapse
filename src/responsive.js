// Responsive hub layout — pure geometry, no Pixi/DOM.
//
// Three breakpoints keep text/buttons at readable size instead of
// uniformly shrinking a 1068px desktop surface into a phone:
//   wide    (>=1080)  three columns side by side
//   medium  (720-1079) center on top, the two bays side by side below
//   compact (<720)    everything stacked in one column
// In medium/compact (and on short wide screens) the column band becomes
// taller than the viewport: HubScene masks it and scrolls it (wheel +
// scrollbar), so panels never overlap — they scroll, as the owner asked.
export const HUB_BREAKPOINTS = Object.freeze({ wide: 1080, medium: 720 });
export function hubViewportMode(width) {
  const w = Number.isFinite(width) && width > 0 ? width : 1440;
  return w >= HUB_BREAKPOINTS.wide ? 'wide' : w >= HUB_BREAKPOINTS.medium ? 'medium' : 'compact';
}
export const hubNavHeight = (width) => (hubViewportMode(width) === 'compact' ? 92 : 56);

const SIDE_W = 276, GAP = 14;
/**
 * Rects (relative to the shell's left edge / band top) for the three hub
 * columns. `contentH` is the full scrollable height of the band.
 */
export function computeHubRects({ shellW = 1200, bandH = 600, activeTabId = '' } = {}) {
  const mode = hubViewportMode(shellW);
  const centerMinH = activeTabId === 'core' ? 660 : 520;
  if (mode === 'wide') {
    const h = Math.max(bandH, centerMinH);
    return { mode, contentH: h,
      left:   { x: 0, y: 0, w: SIDE_W, h },
      center: { x: SIDE_W + GAP, y: 0, w: Math.max(320, shellW - SIDE_W * 2 - GAP * 2), h },
      right:  { x: Math.max(SIDE_W + GAP + 320, shellW - SIDE_W), y: 0, w: SIDE_W, h } };
  }
  if (mode === 'medium') {
    const sideW = Math.floor((shellW - GAP) / 2);
    return { mode, contentH: 560 + GAP + 500,
      center: { x: 0, y: 0, w: shellW, h: 560 },
      left:   { x: 0, y: 560 + GAP, w: sideW, h: 500 },
      right:  { x: sideW + GAP, y: 560 + GAP, w: shellW - sideW - GAP, h: 500 } };
  }
  return { mode, contentH: 560 + GAP + 540 + GAP + 540,
    center: { x: 0, y: 0, w: shellW, h: 560 },
    left:   { x: 0, y: 560 + GAP, w: shellW, h: 540 },
    right:  { x: 0, y: 560 + GAP + 540 + GAP, w: shellW, h: 540 } };
}

/** True if two rects intersect (shared edges don't count). */
export function rectsOverlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
