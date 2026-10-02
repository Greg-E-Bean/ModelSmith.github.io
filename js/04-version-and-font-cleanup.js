
    // ModelSmith version — shown in the header and logged for support.
    window.MODELSMITH_VERSION = 'v1.9';
    // Retire uploaded fonts cached by builds that predate the glyph-conversion
    // fixes. Their stored form is already broken, so no amount of corrected code
    // downstream can rescue them — they have to be re-read from the original file.
    // This runs at top level rather than inside the 3D module so it still happens
    // when that module can't start.
    (function retireOldFontCache() {
      try {
        const legacy = localStorage.getItem('modelsmith_fonts_v1');
        if (legacy) {
          const n = Object.keys(JSON.parse(legacy) || {}).length;
          localStorage.removeItem('modelsmith_fonts_v1');
          if (n) window.__fontsRetired = n;
        }
      } catch (e) { /* nothing to retire */ }
    })();
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed:', err));
      });
    }
    console.log('%cModelSmith ' + window.MODELSMITH_VERSION, 'color:#c2895f; font-weight:bold;');
  