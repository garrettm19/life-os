# Screenshots

Every image here is an unretouched capture, cropped and quantized as described below, of the static web export (`npm run export:web`) running the built-in demo, the fictional person's six weeks. They show the browser preview, not an iPhone: Chromium has no SF Pro Rounded, so figures use the plain system font, and nothing here shows native behavior ([TESTING.md](../TESTING.md#what-browser-tests-cannot-prove)). No trading screen, money figure or body weight is shown.

| File                                | Screen                                                                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `today-light.png`, `today-dark.png` | Today, in the light and dark appearance, as the demo loads                                                                                        |
| `week.png`                          | Week                                                                                                                                              |
| `programs.png`                      | Programs                                                                                                                                          |
| `rotation.png`                      | Programs → Strength → Workout rotation                                                                                                            |
| `progress.png`                      | Progress, scrolled so the range toggle sits just below the header (the summary card above it, with the money and weight figures, is out of frame) |
| `progress-chart.png`                | The Consistency card on Progress, cropped to the full width of the screen                                                                         |
| `restore-preview.png`               | Settings → Backup and restore: a backup exported from the demo, then one more Done, then that backup chosen to restore                            |

## Taking them again

1. `npm run export:web`, then `node scripts/serve-preview.mjs` (it serves `dist/` at `http://127.0.0.1:8087`).
2. Open the page in Playwright's Chromium with a 390 × 844 pt viewport, device scale factor 2, touch and mobile on, and the light color scheme (dark for `today-dark.png`).
3. Install a fixed clock before the page loads, Monday, November 9, 2026, 9:00 local time (`page.clock.install({ time: new Date(2026, 10, 9, 9) })`), so the demo's dates match these images.
4. Tap **Explore demo** on the empty Today and wait for the DEMO tag. Take each screen as listed above from the tab bar, waiting about two seconds after each change so the tab and sheet animations settle. Take Today, Week, Programs, the rotation and Progress before changing anything.
5. Quantize each PNG to 256 colors and save it without metadata, keeping each file under about 150 KB.

Apart from the crop and the color quantization above, the images are never edited, combined or retouched. The optional sweep in `e2e/screenshots.spec.ts` captures every screen and sheet at four widths into the Git-ignored `screenshots/` folder, for layout review rather than for these docs.
