/***************
 * node-unblocker: Web Proxy for evading firewalls and content filters,
 * similar to CGIProxy or PHProxy
 *
 *
 * This project is hosted on github:  https://github.com/nfriedly/nodeunblocker.com
 *
 * By Nathan Friedly - http://nfriedly.com
 * Released under the terms of the Affero GPL v3
 */

var url = require('url');
var querystring = require('querystring');
var express = require('express');
var Unblocker = require('unblocker');
var Transform = require('stream').Transform;
var youtube = require('unblocker/examples/youtube/youtube.js')

var app = express();

var google_analytics_id = process.env.GA_ID || null;

function addGa(html) {
    if (google_analytics_id) {
        var ga = [
            "<script async src=\"https://www.googletagmanager.com/gtag/js?id=" + google_analytics_id + "\"></script>",
            "<script>",
            "  window.dataLayer = window.dataLayer || [];",
            "  function gtag(){dataLayer.push(arguments);}",
            "  gtag('js', new Date());",
            "  gtag('config', '" + google_analytics_id + "');",
            "</script>"
            ].join("\n");
        html = html.replace("</body>", ga + "\n\n</body>");
    }
    return html;
}

function googleAnalyticsMiddleware(data) {
    if (data.contentType == 'text/html') {

        // https://nodejs.org/api/stream.html#stream_transform
        data.stream = data.stream.pipe(new Transform({
            decodeStrings: false,
            transform: function(chunk, encoding, next) {
                this.push(addGa(chunk.toString()));
                next();
            }
        }));
    }
}

var unblockerConfig = {
    prefix: '/proxy/',
    requestMiddleware: [
        youtube.processRequest
    ],
    responseMiddleware: [
        googleAnalyticsMiddleware
    ]
};

// Serve our updated unblocker-client script before unblocker handles it
app.get('/proxy/client/unblocker-client.js', function(req, res) {
    res.sendFile(__dirname + '/custom-client/unblocker-client.js');
});

var unblocker = new Unblocker(unblockerConfig);

// this line must appear before any express.static calls (or anything else that sends responses)
app.use(unblocker);

// serve up static files *after* the proxy is run
app.use('/', express.static(__dirname + '/public'));

function sanitizeUrl(site) {
    if (Array.isArray(site)) {
        site = site[0];
    }
    if (!site || typeof site !== 'string') {
        return null;
    }
    site = site.trim();
    if (!site) {
        return null;
    }

    // Strip any leading slashes, backslashes, or dots if not starting with http:// or https://
    if (!/^https?:\/\//i.test(site)) {
        site = site.replace(/^[\/\\.]+/, '');
        if (!site) {
            return null;
        }
    }

    var targetUrl;
    if (/^https?:\/\//i.test(site)) {
        targetUrl = site;
    } else if (site.indexOf('.') !== -1 && site.indexOf(' ') === -1 && !/^[a-zA-Z0-9+-.]+:/.test(site)) {
        targetUrl = 'https://' + site;
    } else {
        targetUrl = 'https://www.google.com/search?q=' + encodeURIComponent(site);
    }

    try {
        var parsed = new URL(targetUrl);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            return targetUrl;
        }
    } catch (e) {
        return 'https://www.google.com/search?q=' + encodeURIComponent(site);
    }

    return null;
}

// this is for users who's form actually submitted due to JS being disabled or whatever
app.get("/no-js", function(req, res) {
    var query = url.parse(req.url, true).query;
    var site = query ? query.url : null;
    var targetUrl = sanitizeUrl(site);

    if (!targetUrl) {
        return res.redirect('/');
    }

    res.redirect(unblockerConfig.prefix + targetUrl);
});

app.addGa = addGa;
app.googleAnalyticsMiddleware = googleAnalyticsMiddleware;

module.exports = app;

if (require.main === module) {
    const port = process.env.PORT || process.env.VCAP_APP_PORT || 8080;

    app.listen(port, function() {
        console.log(`node unblocker process listening at http://localhost:${port}/`);
    }).on("upgrade", unblocker.onUpgrade); // onUpgrade handles websockets
}
