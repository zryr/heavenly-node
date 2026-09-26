const test = require('node:test');
const assert = require('node:assert/strict');
const { addGa } = require('../app.js');

test('addGa - injects Google Analytics snippet when gaId is provided as argument', () => {
    const originalHtml = '<html><head><title>Test</title></head><body><h1>Hello World</h1></body></html>';
    const gaId = 'UA-12345678-1';

    const result = addGa(originalHtml, gaId);

    assert.ok(result.includes(`_gaq.push(['_setAccount', '${gaId}']);`));
    assert.ok(result.includes("var _gaq = []; // overwrite the existing one, if any"));
    assert.ok(result.includes("</body>"));
    assert.ok(result.indexOf(`_gaq.push(['_setAccount', '${gaId}']);`) < result.indexOf('</body>'));
});

test('addGa - uses process.env.GA_ID when gaId parameter is not explicitly provided', () => {
    const envGaId = 'UA-87654321-9';
    const prevEnv = process.env.GA_ID;
    process.env.GA_ID = envGaId;

    try {
        const originalHtml = '<html><body><p>Test</p></body></html>';
        const result = addGa(originalHtml);

        assert.ok(result.includes(`_gaq.push(['_setAccount', '${envGaId}']);`));
    } finally {
        if (prevEnv !== undefined) {
            process.env.GA_ID = prevEnv;
        } else {
            delete process.env.GA_ID;
        }
    }
});

test('addGa - returns original HTML unmodified when no GA ID is provided or in process.env', () => {
    const prevEnv = process.env.GA_ID;
    delete process.env.GA_ID;

    try {
        const originalHtml = '<html><body><p>No Analytics Here</p></body></html>';
        const result = addGa(originalHtml, null);

        assert.strictEqual(result, originalHtml);
    } finally {
        if (prevEnv !== undefined) {
            process.env.GA_ID = prevEnv;
        }
    }
});

test('addGa - returns HTML unchanged if </body> tag is missing', () => {
    const originalHtml = '<html><head><title>No Body Tag</title></head><div>No body tag</div></html>';
    const gaId = 'UA-12345678-1';

    const result = addGa(originalHtml, gaId);

    assert.strictEqual(result, originalHtml);
});

test('addGa - supports custom GA ID formats', () => {
    const customGaId = 'G-XYZ123456';
    const originalHtml = '<body><p>App</p></body>';

    const result = addGa(originalHtml, customGaId);

    assert.ok(result.includes(`_gaq.push(['_setAccount', '${customGaId}']);`));
});
