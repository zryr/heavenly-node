const { performance } = require('perf_hooks');

// Mock localStorage and window environment
function createMockWindow(settingsJson) {
  const store = {
    'heavenly_settings': settingsJson || '{"autoCloak":true,"useWidgetDock":false}'
  };

  const mockLocalStorage = {
    getItem: (key) => store[key] || null,
    setItem: (key, val) => { store[key] = String(val); }
  };

  const mockDoc = {
    readyState: 'complete',
    title: 'Test Title',
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => ({
      tagName: tag.toUpperCase(),
      style: {},
      setAttribute: () => {},
      appendChild: () => {},
      addEventListener: () => {}
    }),
    getElementsByTagName: () => [{ appendChild: () => {} }],
    addEventListener: () => {},
    body: {
      appendChild: () => {},
      querySelectorAll: () => []
    }
  };

  return {
    top: null,
    localStorage: mockLocalStorage,
    document: mockDoc,
    addEventListener: () => {},
    removeEventListener: () => {},
    location: { href: 'http://localhost/' }
  };
}

// Unoptimized pattern: repeated localStorage reads & JSON.parse
function unoptimizedInit(win) {
  // Cloak & Panic
  var saved1 = {};
  try {
    saved1 = JSON.parse(win.localStorage.getItem('heavenly_settings') || '{}');
  } catch (e) {}
  var settings1 = {
    autoCloak: saved1.autoCloak !== undefined ? saved1.autoCloak : true,
    persistentCloak: saved1.persistentCloak || false,
    selectedPreset: saved1.selectedPreset || 'classroom',
    customPresets: saved1.customPresets || {},
    panicKeyEnable: saved1.panicKeyEnable || false,
    panicKey: saved1.panicKey || '`',
    touchPanic: saved1.touchPanic || false,
    panicUrl: saved1.panicUrl || 'https://classroom.google.com',
    showScrollLock: saved1.showScrollLock !== undefined ? saved1.showScrollLock : true,
    showMagnifier: saved1.showMagnifier !== undefined ? saved1.showMagnifier : true,
    showNavSearch: saved1.showNavSearch !== undefined ? saved1.showNavSearch : true,
    showNavHome: saved1.showNavHome !== undefined ? saved1.showNavHome : true,
    useWidgetDock: saved1.useWidgetDock || false,
    dockPosition: saved1.dockPosition || 'bottom'
  };

  // Widgets
  var saved2 = {};
  try {
    saved2 = JSON.parse(win.localStorage.getItem('heavenly_settings') || '{}');
  } catch (e) {}
  var settings2 = saved2;
  var showScrollLock = settings2.showScrollLock !== undefined ? settings2.showScrollLock : true;

  return { settings1, settings2, showScrollLock };
}

// Optimized pattern: single load & pass object
function loadHeavenlySettings(win) {
  var saved = {};
  try {
    saved = JSON.parse(win.localStorage.getItem('heavenly_settings') || '{}');
  } catch (e) {}

  return {
    autoCloak: saved.autoCloak !== undefined ? saved.autoCloak : true,
    persistentCloak: saved.persistentCloak || false,
    selectedPreset: saved.selectedPreset || 'classroom',
    customPresets: saved.customPresets || {},
    panicKeyEnable: saved.panicKeyEnable || false,
    panicKey: saved.panicKey || '`',
    touchPanic: saved.touchPanic || false,
    panicUrl: saved.panicUrl || 'https://classroom.google.com',
    showScrollLock: saved.showScrollLock !== undefined ? saved.showScrollLock : true,
    showMagnifier: saved.showMagnifier !== undefined ? saved.showMagnifier : true,
    showNavSearch: saved.showNavSearch !== undefined ? saved.showNavSearch : true,
    showNavHome: saved.showNavHome !== undefined ? saved.showNavHome : true,
    useWidgetDock: saved.useWidgetDock || false,
    dockPosition: saved.dockPosition || 'bottom'
  };
}

function optimizedInit(win) {
  var settings = loadHeavenlySettings(win);
  var settings1 = settings;
  var settings2 = settings;
  var showScrollLock = settings.showScrollLock;

  return { settings1, settings2, showScrollLock };
}

const ITERATIONS = 200000;
const sampleSettings = JSON.stringify({
  autoCloak: true,
  persistentCloak: false,
  selectedPreset: 'khan',
  customPresets: { myPreset: { title: 'Custom', icon: 'http://icon.png' } },
  panicKeyEnable: true,
  panicKey: 'p',
  touchPanic: true,
  panicUrl: 'https://example.com',
  showScrollLock: false,
  showMagnifier: true,
  showNavSearch: true,
  showNavHome: false,
  useWidgetDock: true,
  dockPosition: 'top'
});

const win = createMockWindow(sampleSettings);
win.top = win;

// Warmup
for (let i = 0; i < 10000; i++) {
  unoptimizedInit(win);
  optimizedInit(win);
}

// Measure Unoptimized
const startUnopt = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  unoptimizedInit(win);
}
const endUnopt = performance.now();
const timeUnopt = endUnopt - startUnopt;

// Measure Optimized
const startOpt = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  optimizedInit(win);
}
const endOpt = performance.now();
const timeOpt = endOpt - startOpt;

const opsUnopt = (ITERATIONS / (timeUnopt / 1000)).toFixed(0);
const opsOpt = (ITERATIONS / (timeOpt / 1000)).toFixed(0);
const speedup = ((timeUnopt - timeOpt) / timeUnopt * 100).toFixed(2);

console.log(`--- BENCHMARK RESULTS ---`);
console.log(`Iterations: ${ITERATIONS}`);
console.log(`Unoptimized Time: ${timeUnopt.toFixed(2)} ms (${opsUnopt} ops/sec)`);
console.log(`Optimized Time:   ${timeOpt.toFixed(2)} ms (${opsOpt} ops/sec)`);
console.log(`Improvement:      ${speedup}% faster`);
