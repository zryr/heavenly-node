var request = require('supertest');
var assert = require('assert');
var app = require('../app');

describe('GET /no-js', function() {
    it('should redirect to /proxy/<site> when url parameter is provided', function(done) {
        request(app)
            .get('/no-js?url=http://example.com')
            .expect(302)
            .expect('Location', '/proxy/http://example.com')
            .end(done);
    });

    it('should correctly handle URL encoded query parameters', function(done) {
        request(app)
            .get('/no-js?url=https%3A%2F%2Fexample.com%2Fpath%3Ffoo%3Dbar')
            .expect(302)
            .expect('Location', '/proxy/https://example.com/path?foo=bar')
            .end(done);
    });

    it('should redirect to / when url parameter is empty', function(done) {
        request(app)
            .get('/no-js?url=')
            .expect(302)
            .expect('Location', '/')
            .end(done);
    });

    it('should redirect to / when url parameter is missing', function(done) {
        request(app)
            .get('/no-js')
            .expect(302)
            .expect('Location', '/')
            .end(done);
    });

    it('should automatically prepend https:// for raw domains', function(done) {
        request(app)
            .get('/no-js?url=example.com')
            .expect(302)
            .expect('Location', '/proxy/https://example.com')
            .end(done);
    });

    it('should convert plain search queries into google search urls', function(done) {
        request(app)
            .get('/no-js?url=hello%20world')
            .expect(302)
            .expect('Location', '/proxy/https://www.google.com/search?q=hello%20world')
            .end(done);
    });

    it('should strip leading slashes and protocol relative URLs to prevent open redirect', function(done) {
        request(app)
            .get('/no-js?url=//evil.com')
            .expect(302)
            .expect('Location', '/proxy/https://evil.com')
            .end(done);
    });

    it('should strip leading backslashes to prevent bypasses', function(done) {
        request(app)
            .get('/no-js?url=/\\evil.com')
            .expect(302)
            .expect('Location', '/proxy/https://evil.com')
            .end(done);
    });

    it('should redirect javascript: pseudo-protocol queries safely to search', function(done) {
        request(app)
            .get('/no-js?url=javascript:alert(1)')
            .expect(302)
            .expect('Location', '/proxy/https://www.google.com/search?q=javascript%3Aalert(1)')
            .end(done);
    });
});
