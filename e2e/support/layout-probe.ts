import type { Page } from '@playwright/test';

export type LayoutIssue = {
  kind: 'overflow' | 'overlap' | 'clipped' | 'target';
  text: string;
  detail: string;
};

/**
 * Finds content that leaves the screen horizontally, text cut off by a fixed-size box, visible text
 * or controls that sit on top of each other, and controls smaller than a touch target. Each
 * element is measured as it is actually visible: clipped to the scrollers around it, so content
 * scrolled under the header or the tab bar is not an overlap. Supplemental to looking at the
 * screenshots: it cannot judge hierarchy or clutter. Run it with no sheet open.
 */
export function probeLayout(page: Page): Promise<LayoutIssue[]> {
  return page.evaluate(() => {
    type Box = { left: number; top: number; right: number; bottom: number };
    type Kind = 'overflow' | 'overlap' | 'clipped' | 'target';
    const issues: { kind: Kind; text: string; detail: string }[] = [];
    const vw = window.innerWidth;
    const scrollsY = (s: CSSStyleDeclaration) => ['auto', 'scroll'].includes(s.overflowY);
    const scrollsX = (s: CSSStyleDeclaration) => ['auto', 'scroll'].includes(s.overflowX);
    /** The part of an element that can be seen, or null when none of it can. */
    const seen = (el: HTMLElement): Box | null => {
      const s = getComputedStyle(el);
      if (s.visibility === 'hidden' || s.display === 'none') return null;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      let box: Box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      for (let p = el.parentElement; p; p = p.parentElement) {
        const ps = getComputedStyle(p);
        if (Number(ps.opacity) === 0) return null;
        if (scrollsY(ps) || scrollsX(ps)) {
          const pr = p.getBoundingClientRect();
          box = {
            // Horizontal scrollers may hold content past the screen edge on purpose.
            left: scrollsX(ps) ? Math.max(box.left, pr.left) : box.left,
            right: scrollsX(ps) ? Math.min(box.right, pr.right) : box.right,
            top: scrollsY(ps) ? Math.max(box.top, pr.top) : box.top,
            bottom: scrollsY(ps) ? Math.min(box.bottom, pr.bottom) : box.bottom,
          };
        }
      }
      return box.bottom - box.top > 1 && box.right - box.left > 1 ? box : null;
    };
    const label = (el: HTMLElement) =>
      (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 60);
    const ownText = (el: HTMLElement) =>
      Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim().length > 0);
    const texts: { el: HTMLElement; box: Box }[] = [];
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
      if (!ownText(el)) continue;
      const box = seen(el);
      if (!box) continue;
      if (box.right > vw + 1 || box.left < -1)
        issues.push({
          kind: 'overflow',
          text: label(el),
          detail: `x ${Math.round(box.left)}–${Math.round(box.right)} of ${vw}`,
        });
      const s = getComputedStyle(el);
      // Truncation on purpose shows an ellipsis; anything else cut off is a defect.
      if (
        s.overflow === 'hidden' &&
        s.textOverflow !== 'ellipsis' &&
        (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 4)
      )
        issues.push({
          kind: 'clipped',
          text: label(el),
          detail: `${el.scrollWidth}×${el.scrollHeight} in ${el.clientWidth}×${el.clientHeight}`,
        });
      texts.push({ el, box });
    }
    for (let i = 0; i < texts.length; i++)
      for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i];
        const b = texts[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left);
        const h = Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top);
        if (w > 3 && h > 3)
          issues.push({
            kind: 'overlap',
            text: `${label(a.el)} ⟂ ${label(b.el)}`,
            detail: `${Math.round(w)}×${Math.round(h)}px`,
          });
      }
    // Touch targets: every fully visible control is at least 44 × 44 pt. Chart points are small
    // marks with a larger hit area (and the plot itself selects the nearest one), so they are
    // left out, as are controls only partly scrolled into view.
    const controls = document.body.querySelectorAll<HTMLElement>(
      '[role="button"],[role="link"],[role="radio"],[role="checkbox"],[role="switch"]',
    );
    for (const el of Array.from(controls)) {
      if (el.closest('[data-testid="chart"]') || el.closest('[aria-hidden="true"]')) continue;
      const r = el.getBoundingClientRect();
      const box = seen(el);
      if (!box || box.bottom - box.top < r.height - 1) continue;
      // The 28-day study and trading calendars are contiguous grids: each day is its whole column
      // (no gaps between targets) and 44 pt tall, but seven columns cannot each be 44 pt wide on
      // the narrowest phones. A day's height is checked; its width only for a usable minimum.
      const day = /^(study|trading)-day:/.test(el.getAttribute('data-testid') ?? '');
      if (day ? r.height < 43.5 || r.width < 32 : r.height < 43.5 || r.width < 43.5)
        issues.push({
          kind: 'target',
          text: label(el),
          detail: `${Math.round(r.width)}×${Math.round(r.height)}`,
        });
    }
    return issues;
  });
}

/**
 * Approximates larger Dynamic Type in the browser: every text element's size and line height are
 * multiplied. React Native Web ignores the system text size, so this is only a stand-in for the
 * device check. Each element is scaled from its own size once, so calling it again after more
 * text has appeared (a row opened) scales only what is new.
 */
export function scaleText(page: Page, factor: number): Promise<void> {
  return page.evaluate((f) => {
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
      const own = Array.from(el.childNodes).some(
        (n) => n.nodeType === 3 && n.textContent!.trim().length > 0,
      );
      if (!own || el.dataset.scaled) continue;
      el.dataset.scaled = 'true';
      const s = getComputedStyle(el);
      el.style.fontSize = `${parseFloat(s.fontSize) * f}px`;
      if (s.lineHeight !== 'normal') el.style.lineHeight = `${parseFloat(s.lineHeight) * f}px`;
    }
  }, factor);
}

/** Scrolls the tallest vertical scroller on screen (the page body or an open sheet) to `to`. */
export function scrollMain(page: Page, to: number): Promise<{ top: number; max: number }> {
  return page.evaluate((y) => {
    let main: HTMLElement | null = null;
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
      const s = getComputedStyle(el);
      if (
        (s.overflowY === 'auto' || s.overflowY === 'scroll') &&
        el.scrollHeight > el.clientHeight + 4
      )
        if (!main || el.scrollHeight > main.scrollHeight) main = el;
    }
    if (!main) return { top: 0, max: 0 };
    main.scrollTop = y;
    return { top: main.scrollTop, max: main.scrollHeight - main.clientHeight };
  }, to);
}

/**
 * Every issue on every screenful of the current page, up to `screens` screenfuls of `height`
 * points, read while scrolling down; the page is scrolled back to the top afterwards.
 */
export async function scanPage(page: Page, height: number, screens = 20): Promise<LayoutIssue[]> {
  const found: LayoutIssue[] = [];
  let { max } = await scrollMain(page, 0);
  for (let y = 0, i = 0; i < screens; i++, y += Math.round(height * 0.75)) {
    await scrollMain(page, y);
    found.push(...(await probeLayout(page)));
    if (y >= max) break;
    ({ max } = await scrollMain(page, y));
  }
  await scrollMain(page, 0);
  return found;
}
