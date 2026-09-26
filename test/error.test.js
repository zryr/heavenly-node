var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

describe('index.html checkError security fix', function() {
    var errorElement;

    function createEnvironment(queryString, options) {
        options = options || {};
        errorElement = {
            textContent: '',
            innerText: '',
            style: { display: 'none' }
        };

        var context = {
            window: {
                location: {
                    search: queryString
                }
            },
            URLSearchParams: options.disableURLSearchParams ? undefined : global.URLSearchParams,
            decodeURIComponent: global.decodeURIComponent,
            $: function(id) {
                if (id === 'error') return errorElement;
                return null;
            }
        };

        var html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
        var scriptMatch = html.match(/function checkError\(\) \{[\s\S]*?\n    \}/);
        assert.ok(scriptMatch, 'checkError function should be present in index.html');

        var code = scriptMatch[0] + '\ncheckError();';
        vm.runInNewContext(code, context);
    }

    it('should display decoded error message when valid error parameter is present', function() {
        createEnvironment('?error=Invalid%20URL');
        assert.strictEqual(errorElement.textContent, 'Invalid URL');
        assert.strictEqual(errorElement.style.display, 'block');
    });

    it('should handle HTML tags as plain text without XSS risk', function() {
        var xssPayload = '%3Cscript%3Ealert(1)%3C%2Fscript%3E';
        createEnvironment('?error=' + xssPayload);
        assert.strictEqual(errorElement.textContent, '<script>alert(1)</script>');
        assert.strictEqual(errorElement.style.display, 'block');
    });

    it('should handle malformed URI percent-encoding gracefully without throwing error', function() {
        assert.doesNotThrow(function() {
            createEnvironment('?error=%FF%FE%100');
        });
    });

    it('should not display error container when no error query param is present', function() {
        createEnvironment('?foo=bar');
        assert.strictEqual(errorElement.style.display, 'none');
        assert.strictEqual(errorElement.textContent, '');
    });

    it('should fall back to manual parameter extraction when URLSearchParams is unavailable', function() {
        createEnvironment('?error=Fallback%20Error&other=1', { disableURLSearchParams: true });
        assert.strictEqual(errorElement.textContent, 'Fallback Error');
        assert.strictEqual(errorElement.style.display, 'block');
    });
});
