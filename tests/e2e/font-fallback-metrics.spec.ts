/*
 * Compare the loaded local fallback against its webfont at 100px. Normal line height is
 * intentional: a fixed line height masks differences in ascent and descent overrides.
 * Local fonts vary by platform, so compare to the webfont rather than a generic font.
 */
import { expect, test } from '@playwright/test';

const SAMPLES = [
  'Hamburgefonstiv',
  'The quick brown fox jumps over the lazy dog',
  '0123456789 $1,234.56',
  'Choose your parts',
  'Synthetic demo estimates — not a quote',
];

const PAIRS = [
  {
    name: 'DM Sans',
    web: "'DM Sans', sans-serif",
    fallback: "'DM Sans Fallback', sans-serif",
  },
  {
    name: 'Space Grotesk',
    web: "'Space Grotesk', sans-serif",
    fallback: "'Space Grotesk Fallback', sans-serif",
  },
  {
    name: 'IBM Plex Mono',
    web: "'IBM Plex Mono', monospace",
    fallback: "'IBM Plex Mono Fallback', monospace",
  },
];

test('loaded fallback faces keep text metrics close to their webfonts', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);

  const measured = await page.evaluate(
    async ({ samples, pairs }) => {
      const el = document.createElement('span');
      el.style.cssText =
        'position:absolute;visibility:hidden;white-space:pre;font-size:100px;font-weight:400;line-height:normal';
      document.body.appendChild(el);
      const box = (family: string, text: string) => {
        el.textContent = text;
        el.style.fontFamily = family;
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height };
      };

      const out: {
        name: string;
        webLoaded: boolean;
        fallbackLoaded: boolean;
        fallbackWidthError: number;
        fallbackHeightError: number;
      }[] = [];

      for (const pair of pairs) {
        const webFaces = await document.fonts.load(`400 100px ${pair.web}`, samples.join(' '));
        const faces = await document.fonts.load(`400 100px ${pair.fallback}`, samples.join(' '));
        let fallbackWidthError = 0;
        let fallbackHeightError = 0;
        for (const text of samples) {
          const web = box(pair.web, text);
          const fb = box(pair.fallback, text);
          fallbackWidthError = Math.max(fallbackWidthError, Math.abs(fb.w - web.w) / web.w);
          fallbackHeightError = Math.max(fallbackHeightError, Math.abs(fb.h - web.h));
        }
        out.push({
          name: pair.name,
          webLoaded: webFaces.length > 0 && webFaces.every((face) => face.status === 'loaded'),
          fallbackLoaded: faces.length > 0 && faces.every((face) => face.status === 'loaded'),
          fallbackWidthError,
          fallbackHeightError,
        });
      }
      el.remove();
      return out;
    },
    { samples: SAMPLES, pairs: PAIRS },
  );

  for (const m of measured) {
    expect(m.webLoaded, `${m.name}: webfont face did not load`).toBe(true);
    expect(m.fallbackLoaded, `${m.name}: fallback font face did not load`).toBe(true);
    expect(m.fallbackWidthError, `${m.name}: fallback width differs by too much`).toBeLessThan(
      0.045,
    );
    expect(
      m.fallbackHeightError,
      `${m.name}: fallback line height differs by too much`,
    ).toBeLessThanOrEqual(5);
  }
});
