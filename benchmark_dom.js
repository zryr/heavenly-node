const { performance } = require('perf_hooks');

// Simple DOM Mock for benchmarking cloneNode + root removal
function createMockElement(id, tagName = 'DIV') {
  const children = [];
  return {
    id: id || '',
    tagName: tagName,
    children: children,
    parentNode: null,
    appendChild: function(child) {
      child.parentNode = this;
      children.push(child);
    },
    removeChild: function(child) {
      const idx = children.indexOf(child);
      if (idx !== -1) {
        children.splice(idx, 1);
        child.parentNode = null;
      }
    },
    remove: function() {
      if (this.parentNode) {
        this.parentNode.removeChild(this);
      }
    },
    cloneNode: function(deep) {
      const clone = createMockElement(this.id, this.tagName);
      if (deep) {
        for (let i = 0; i < children.length; i++) {
          clone.appendChild(children[i].cloneNode(true));
        }
      }
      return clone;
    },
    querySelector: function(selector) {
      // simple mock querySelector for #id
      if (selector.startsWith('#')) {
        const targetId = selector.slice(1);
        return findById(this, targetId);
      }
      return null;
    },
    querySelectorAll: function(selector) {
      // simple mock querySelectorAll for comma separated IDs
      const ids = selector.split(',').map(s => s.trim().replace('#', ''));
      const results = [];
      findAllByIds(this, ids, results);
      return results;
    }
  };
}

function findById(node, id) {
  if (node.id === id) return node;
  for (let i = 0; i < node.children.length; i++) {
    const found = findById(node.children[i], id);
    if (found) return found;
  }
  return null;
}

function findAllByIds(node, ids, results) {
  if (ids.indexOf(node.id) !== -1) {
    results.push(node);
  }
  for (let i = 0; i < node.children.length; i++) {
    findAllByIds(node.children[i], ids, results);
  }
}

// Build mock document body
function buildMockBody(numDummyChildren) {
  const body = createMockElement('body', 'BODY');
  body.appendChild(createMockElement('content1'));
  body.appendChild(createMockElement('heavenly-scroll-lock-root'));
  body.appendChild(createMockElement('content2'));
  body.appendChild(createMockElement('heavenly-magnifier-root'));
  body.appendChild(createMockElement('heavenly-nav-root'));
  body.appendChild(createMockElement('content3'));
  body.appendChild(createMockElement('heavenly-touch-panic-root'));
  body.appendChild(createMockElement('heavenly-dock-root'));

  for (let i = 0; i < numDummyChildren; i++) {
    const dummy = createMockElement('dummy-' + i);
    dummy.appendChild(createMockElement('subdummy-' + i));
    body.appendChild(dummy);
  }
  return body;
}

const mockBody = buildMockBody(500);
const rootIds = ['heavenly-scroll-lock-root', 'heavenly-magnifier-root', 'heavenly-nav-root', 'heavenly-touch-panic-root', 'heavenly-dock-root'];

// Method 1: Current loop iterating backward over clone.children
function methodCurrent(body) {
  var clone = body.cloneNode(true);
  for (var rIdx = clone.children.length - 1; rIdx >= 0; rIdx--) {
    var childEl = clone.children[rIdx];
    if (childEl && rootIds.indexOf(childEl.id) !== -1) {
      if (childEl.remove) childEl.remove();
      else if (childEl.parentNode) childEl.parentNode.removeChild(childEl);
    }
  }
  return clone;
}

// Method 2: querySelector for each known root ID
function methodQuerySelectorPerId(body) {
  var clone = body.cloneNode(true);
  for (var i = 0; i < rootIds.length; i++) {
    var el = clone.querySelector('#' + rootIds[i]);
    if (el) {
      if (el.remove) el.remove();
      else if (el.parentNode) el.parentNode.removeChild(el);
    }
  }
  return clone;
}

const ITERATIONS = 10000;

// Warmup
for (let i = 0; i < 1000; i++) {
  methodCurrent(mockBody);
  methodQuerySelectorPerId(mockBody);
}

const startUnopt = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  methodCurrent(mockBody);
}
const endUnopt = performance.now();
const timeUnopt = endUnopt - startUnopt;

const startOpt = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  methodQuerySelectorPerId(mockBody);
}
const endOpt = performance.now();
const timeOpt = endOpt - startOpt;

console.log(`--- DOM CLEANUP BENCHMARK RESULTS ---`);
console.log(`Iterations: ${ITERATIONS}`);
console.log(`Current (Loop all children):     ${timeUnopt.toFixed(2)} ms`);
console.log(`Optimized (querySelector per ID): ${timeOpt.toFixed(2)} ms`);
console.log(`Improvement:                      ${(((timeUnopt - timeOpt) / timeUnopt) * 100).toFixed(2)}% faster`);
