var assert = require('assert');
var Readable = require('stream').Readable;

describe('Google Analytics support', function() {
    var originalGaId;

    beforeEach(function() {
        originalGaId = process.env.GA_ID;
    });

    afterEach(function() {
        if (originalGaId !== undefined) {
            process.env.GA_ID = originalGaId;
        } else {
            delete process.env.GA_ID;
        }
        delete require.cache[require.resolve('../app')];
    });

    it('should inject GA4 gtag.js snippet into HTML when GA_ID is set', function() {
        process.env.GA_ID = 'G-TEST12345';
        delete require.cache[require.resolve('../app')];
        var app = require('../app');

        var html = '<html><head></head><body><h1>Hello World</h1></body></html>';
        var result = app.addGa(html);

        assert.ok(result.includes('https://www.googletagmanager.com/gtag/js?id=G-TEST12345'));
        assert.ok(result.includes("gtag('config', 'G-TEST12345');"));
        assert.ok(result.includes('</body>'));
    });

    it('should not modify HTML when GA_ID is not set', function() {
        delete process.env.GA_ID;
        delete require.cache[require.resolve('../app')];
        var app = require('../app');

        var html = '<html><head></head><body><h1>Hello World</h1></body></html>';
        var result = app.addGa(html);

        assert.strictEqual(result, html);
    });

    it('should process stream in googleAnalyticsMiddleware when content type is text/html', function(done) {
        process.env.GA_ID = 'G-TEST99999';
        delete require.cache[require.resolve('../app')];
        var app = require('../app');

        var inputHtml = '<html><body><p>Proxy Page</p></body></html>';
        var stream = new Readable();
        stream.push(inputHtml);
        stream.push(null);

        var data = {
            contentType: 'text/html',
            stream: stream
        };

        app.googleAnalyticsMiddleware(data);

        var output = '';
        data.stream.on('data', function(chunk) {
            output += chunk.toString();
        });

        data.stream.on('end', function() {
            assert.ok(output.includes('G-TEST99999'));
            assert.ok(output.includes('gtag'));
            done();
        });
    });

    it('should not transform stream in googleAnalyticsMiddleware when content type is not text/html', function() {
        process.env.GA_ID = 'G-TEST99999';
        delete require.cache[require.resolve('../app')];
        var app = require('../app');

        var stream = new Readable();
        var data = {
            contentType: 'application/json',
            stream: stream
        };

        app.googleAnalyticsMiddleware(data);

        assert.strictEqual(data.stream, stream);
    });
});
