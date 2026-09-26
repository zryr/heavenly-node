const { performance } = require('perf_hooks');

// Simple DOM Mock for querySelector vs querySelectorAll benchmarking
function createMockElement(id, tagName = 'DIV') {
  return {
    id: id || '',
    tagName: tagName.toUpperCase(),
    children: [],
    parentNode: null,
    remove: function () {
      if (this.parentNode) {
        const idx = this.parentNode.children.indexOf(this);
        if (idx !== -1) this.parentNode.children.splice(idx, 1);
        this.parentNode = null;
      }
    },
    appendChild: function (child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    }
  };
}

function createMockDocumentBody() {
  const body = createMockElement('', 'BODY');

  // Add 100 random elements
  for (let i = 0; i < 100; i++) {
    body.appendChild(createMockElement('el-' + i, 'DIV'));
  }

  // Add heavenly root elements among other elements
  const heavenlyIds = [
    'heavenly-scroll-lock-root',
    'heavenly-magnifier-root',
    'heavenly-nav-root',
    'heavenly-touch-panic-root',
    'heavenly-dock-root'
  ];

  heavenlyIds.forEach(id => {
    body.appendChild(createMockElement(id, 'DIV'));
  });

  // Query implementations for mock
  body.querySelector = function (selector) {
    const targetId = selector.startsWith('#') ? selector.slice(1) : selector;
    function search(node) {
      if (node.id === targetId) return node;
      for (let child of node.children) {
        const res = search(child);
        if (res) return res;
      }
      return null;
    }
    return search(this);
  };

  body.querySelectorAll = function (selectorStr) {
    const selectors = selectorStr.split(',').map(s => s.trim().startsWith('#') ? s.trim().slice(1) : s.trim());
    const results = [];
    function search(node) {
      if (selectors.includes(node.id)) results.push(node);
      for (let child of node.children) {
        search(child);
      }
    }
    search(this);
    return results;
  };

  body.cloneNode = function (deep) {
    const clone = createMockElement(this.id, this.tagName);
    clone.querySelector = this.querySelector;
    clone.querySelectorAll = this.querySelectorAll;
    function cloneChildren(src, dest) {
      for (let child of src.children) {
        const childClone = createMockElement(child.id, child.tagName);
        dest.appendChild(childClone);
        cloneChildren(child, childClone);
      }
    }
    cloneChildren(this, clone);
    return clone;
  };

  return body;
}

// Unoptimized implementation: repeated querySelector calls in a loop
function unoptimizedRootRemoval(clone) {
  var rootIds = ['heavenly-scroll-lock-root', 'heavenly-magnifier-root', 'heavenly-nav-root', 'heavenly-touch-panic-root', 'heavenly-dock-root'];
  for (var rIdx = 0; rIdx < rootIds.length; rIdx++) {
    var rootEl = clone.querySelector('#' + rootIds[rIdx]);
    if (rootEl) {
      if (rootEl.remove) rootEl.remove();
      else if (rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);
    }
  }
}

// Optimized implementation: single querySelectorAll call
function optimizedRootRemoval(clone) {
  var roots = clone.querySelectorAll('#heavenly-scroll-lock-root, #heavenly-magnifier-root, #heavenly-nav-root, #heavenly-touch-panic-root, #heavenly-dock-root');
  for (var rIdx = 0; rIdx < roots.length; rIdx++) {
    var rootEl = roots[rIdx];
    if (rootEl.remove) rootEl.remove();
    else if (rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);
  }
}

const docBody = createMockDocumentBody();
const ITERATIONS = 100000;

// Warmup
for (let i = 0; i < 5000; i++) {
  unoptimizedRootRemoval(docBody.cloneNode(true));
  optimizedRootRemoval(docBody.cloneNode(true));
}

// Benchmark Unoptimized
const startUnopt = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  const clone = docBody.cloneNode(true);
  unoptimizedRootRemoval(clone);
}
const timeUnopt = performance.now() - startUnopt;

// Benchmark Optimized
const startOpt = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  const clone = docBody.cloneNode(true);
  optimizedRootRemoval(clone);
}
const timeOpt = performance.now() - startOpt;

const opsUnopt = (ITERATIONS / (timeUnopt / 1000)).toFixed(0);
const opsOpt = (ITERATIONS / (timeOpt / 1000)).toFixed(0);
const speedup = ((timeUnopt - timeOpt) / timeUnopt * 100).toFixed(2);

console.log(`--- DOM ROOT REMOVAL BENCHMARK RESULTS ---`);
console.log(`Iterations: ${ITERATIONS}`);
console.log(`Unoptimized Time: ${timeUnopt.toFixed(2)} ms (${opsUnopt} ops/sec)`);
console.log(`Optimized Time:   ${timeOpt.toFixed(2)} ms (${opsOpt} ops/sec)`);
console.log(`Improvement:      ${speedup}% faster`);
