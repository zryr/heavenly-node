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

    it('should redirect to /proxy/ when url parameter is empty', function(done) {
        request(app)
            .get('/no-js?url=')
            .expect(302)
            .expect('Location', '/proxy/')
            .end(done);
    });

    it('should redirect to /proxy/undefined when url parameter is missing', function(done) {
        request(app)
            .get('/no-js')
            .expect(302)
            .expect('Location', '/proxy/undefined')
            .end(done);
    });
});
