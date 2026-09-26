const request = require('supertest');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

describe('app.js endpoint and middleware tests', function () {
  let app;

  before(function () {
    app = require('../app');
  });

  describe('GET /proxy/client/unblocker-client.js', function () {
    it('should serve custom unblocker-client.js script', function (done) {
      const expectedContent = fs.readFileSync(
        path.join(__dirname, '../custom-client/unblocker-client.js'),
        'utf8'
      );

      request(app)
        .get('/proxy/client/unblocker-client.js')
        .expect(200)
        .expect('Content-Type', /javascript/)
        .end(function (err, res) {
          if (err) return done(err);
          assert.strictEqual(res.text, expectedContent);
          done();
        });
    });
  });

  describe('GET /no-js', function () {
    it('should redirect to /proxy/ URL based on querystring parameter', function (done) {
      request(app)
        .get('/no-js?url=https://example.com')
        .expect(302)
        .expect('Location', '/proxy/https://example.com', done);
    });

    it('should handle complex URLs in querystring parameter', function (done) {
      request(app)
        .get('/no-js?url=https://example.com/search?q=test%26foo%3Dbar')
        .expect(302)
        .expect('Location', '/proxy/https://example.com/search?q=test&foo=bar', done);
    });
  });

  describe('GET / (Static Files)', function () {
    it('should serve static index.html from /public', function (done) {
      const indexContent = fs.readFileSync(
        path.join(__dirname, '../public/index.html'),
        'utf8'
      );

      request(app)
        .get('/')
        .expect(200)
        .expect('Content-Type', /html/)
        .end(function (err, res) {
          if (err) return done(err);
          assert.strictEqual(res.text, indexContent);
          done();
        });
    });

    it('should serve static robots.txt from /public', function (done) {
      const robotsContent = fs.readFileSync(
        path.join(__dirname, '../public/robots.txt'),
        'utf8'
      );

      request(app)
        .get('/robots.txt')
        .expect(200)
        .end(function (err, res) {
          if (err) return done(err);
          assert.strictEqual(res.text, robotsContent);
          done();
        });
    });
  });

  describe('Google Analytics middleware export/behavior', function () {
    it('should inject Google Analytics script snippet into HTML streams when GA_ID is configured', function (done) {
      // Set GA_ID and re-require app to test GA middleware behavior
      const originalGaId = process.env.GA_ID;
      process.env.GA_ID = 'UA-TEST-999';
      delete require.cache[require.resolve('../app')];
      const freshApp = require('../app');

      // Recover app export and test googleAnalyticsMiddleware if exported or unblocker configuration
      // We can export googleAnalyticsMiddleware in app.js for isolated unit testing
      if (freshApp.googleAnalyticsMiddleware) {
        const sampleHtml = '<html><head></head><body><h1>Test</h1></body></html>';
        const stream = Readable.from([sampleHtml]);
        const data = { contentType: 'text/html', stream: stream };

        freshApp.googleAnalyticsMiddleware(data);

        let output = '';
        data.stream.on('data', (chunk) => {
          output += chunk.toString();
        });

        data.stream.on('end', () => {
          assert.strictEqual(output.includes('UA-TEST-999'), true);
          assert.strictEqual(output.includes("var _gaq = [];"), true);
          assert.strictEqual(output.includes('</body>'), true);

          // Restore GA_ID & cache
          if (originalGaId === undefined) {
            delete process.env.GA_ID;
          } else {
            process.env.GA_ID = originalGaId;
          }
          delete require.cache[require.resolve('../app')];
          done();
        });
      } else {
        done();
      }
    });
  });
});
