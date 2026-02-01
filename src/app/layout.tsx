/* eslint-disable @next/next/no-page-custom-font */

import type { Metadata } from 'next';
import Script from 'next/script';

import './globals.css';
// Constellations global styles (kept in components so graph UI can share it).
// Importing here avoids CSS `@import` path resolution issues in Turbopack.
import '@/components/constellations/styles.css';

// Default MathJax config.
//
// IMPORTANT: We install a startup hook to merge any macros that are injected
// later at runtime (e.g. graph/paper-specific macro maps) into the *live* TeX
// parser macro table before MathJax typesets.
//
// Pages should add macros into `window.__ARXIGRAPH_PENDING_MATHJAX_MACROS`.
const DEFAULT_MATHJAX_CONFIG = `window.__ARXIGRAPH_PENDING_MATHJAX_MACROS = window.__ARXIGRAPH_PENDING_MATHJAX_MACROS || {};
window.MathJax = {
  // Explicitly load TeX extensions used heavily by SGA sources.
  // We load the MathJax v3 "ams" TeX package, which provides AMSmath/AMSsymbols
  // functionality (e.g. \operatorname).
  //
  // NOTE: MathJax's TeX package name is "ams" (not "amsmath"/"amssymb"), and
  // using non-existent package names can break MathJax startup entirely.
  loader: { load: ['[tex]/ams', '[tex]/newcommand'] },
  tex: {
    packages: { '[+]': ['ams', 'newcommand'] },
    inlineMath: [['$','$'], ['\\(','\\)']],
    displayMath: [['$$','$$'], ['\\[','\\]']],
    processEscapes: true,
    macros: {
      eps: '{\\varepsilon}',
    },
  },
  startup: {
    ready: () => {
      const MJ = window.MathJax;
      const pending = window.__ARXIGRAPH_PENDING_MATHJAX_MACROS || {};

      // Merge into config macros.
      if (MJ && MJ.config && MJ.config.tex) {
        MJ.config.tex.macros = Object.assign(MJ.config.tex.macros || {}, pending);
      }

      // Merge into live TeX parser macros (this is what actually fixes
      // "Undefined control sequence" in v3 after initialization).
      try {
        const doc = MJ && MJ.startup && MJ.startup.document;
        const tex = doc && doc.inputJax && doc.inputJax['tex'];
        const live = tex && tex.parseOptions && tex.parseOptions.options && tex.parseOptions.options.macros;
        if (live) Object.assign(live, pending);
      } catch (e) {}

      return MJ.startup.defaultReady();
    }
  }
};`;

export const metadata: Metadata = {
  title: 'SGA Graph',
  description: 'Visualize mathematical dependency graphs for SGA sources.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // NOTE: We set the theme variables inline as a last-resort override.
  // In some Turbopack dev-cache situations, the generated CSS chunk can lag
  // behind the source `globals.css` edits. Inline CSS variables ensure the
  // app uses the intended theme immediately.
  const THEME_VARS = {
    ['--background' as any]: '#121212',
    ['--foreground' as any]: '#e0e0e0',
    ['--surface1' as any]: '#1a1a1a',
    ['--surface2' as any]: '#242424',
    ['--primary-text' as any]: '#e0e0e0',
    ['--secondary-text' as any]: '#aaaaaa',
    ['--accent' as any]: '#ffdd57',
    ['--accent-hover' as any]: '#ffc800',
    ['--border-color' as any]: '#333333',
  };

  return (
    <html lang="en">
      <head>
        <meta name="color-scheme" content="dark" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=STIX+Two+Text:ital,wght@0,400;0,600;1,400&family=STIX+Two+Math&display=swap"
          rel="stylesheet"
        />

        {/* MathJax v3 (TeX + CHTML) */}
        <Script
          id="mathjax-config"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: DEFAULT_MATHJAX_CONFIG }}
        />
        <Script
          id="mathjax-src"
          strategy="beforeInteractive"
          src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js"
        />
      </head>
      <body className="antialiased" style={THEME_VARS as any}>
        {children}
      </body>
    </html>
  );
}
