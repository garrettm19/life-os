import type { PropsWithChildren } from 'react';
import { ScrollViewStyleReset } from 'expo-router/html';
import { themeCss, tokens } from '../ui/theme';

/**
 * The web page around the app (static export and browser preview only; iOS never uses it). Its
 * head defines the color tokens for light and dark as CSS variables, so the prerendered page is the
 * same for everyone and the browser picks the appearance from `prefers-color-scheme` before any
 * script runs: no flash and no hydration mismatch.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <meta name="color-scheme" content="light dark" />
        <meta
          name="theme-color"
          media="(prefers-color-scheme: light)"
          content={tokens.light.canvas}
        />
        <meta
          name="theme-color"
          media="(prefers-color-scheme: dark)"
          content={tokens.dark.canvas}
        />
        <ScrollViewStyleReset />
        <style id="life-os-theme" dangerouslySetInnerHTML={{ __html: themeCss() }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
