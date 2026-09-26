const test = require("node:test");
const assert = require("node:assert/strict");
const { fixUrl } = require("../custom-client/unblocker-client.js");

test("fixUrl - handles null and undefined", () => {
  const config = { prefix: "/proxy/", url: "https://example.com" };
  const location = {
    pathname: "/proxy/https://example.com",
    search: "",
    hash: "",
    origin: "https://myproxy.com",
    hostname: "myproxy.com",
  };

  assert.equal(fixUrl(null, config, location), null);
  assert.equal(fixUrl(undefined, config, location), undefined);
});

test("fixUrl - handles already proxied URLs (root-relative and absolute)", () => {
  const config = { prefix: "/proxy/", url: "https://example.com" };
  const location = {
    pathname: "/proxy/https://example.com",
    search: "",
    hash: "",
    origin: "https://myproxy.com",
    hostname: "myproxy.com",
  };

  // Root-relative already proxied URL
  const proxiedRelative = "/proxy/https://example.com/page";
  assert.equal(fixUrl(proxiedRelative, config, location), proxiedRelative);

  // Absolute already proxied URL on the proxy host
  const proxiedAbsolute = "https://myproxy.com/proxy/https://example.com/page";
  assert.equal(fixUrl(proxiedAbsolute, config, location), proxiedAbsolute);
});

test("fixUrl - ignores non-http and non-https protocols", () => {
  const config = { prefix: "/proxy/", url: "https://example.com" };
  const location = {
    pathname: "/proxy/https://example.com",
    search: "",
    hash: "",
    origin: "https://myproxy.com",
    hostname: "myproxy.com",
  };

  assert.equal(
    fixUrl("data:text/html,Hello", config, location),
    "data:text/html,Hello"
  );
  assert.equal(fixUrl("about:blank", config, location), "about:blank");
  assert.equal(
    fixUrl("javascript:console.log('hi')", config, location),
    "javascript:console.log('hi')"
  );
});

test("fixUrl - proxies relative and absolute URLs when pathname matches prefix", () => {
  const config = { prefix: "/proxy/", url: "https://example.com" };
  const location = {
    pathname: "/proxy/https://example.com/path/file.html",
    search: "?query=1",
    hash: "#section",
    origin: "https://myproxy.com",
    hostname: "myproxy.com",
  };

  // Relative URL on target domain
  assert.equal(
    fixUrl("other.html", config, location),
    "/proxy/https://example.com/path/other.html"
  );

  // Root-relative URL on target domain
  assert.equal(
    fixUrl("/index.html", config, location),
    "/proxy/https://example.com/index.html"
  );

  // Absolute URL on external target domain
  assert.equal(
    fixUrl("https://otherdomain.com/api", config, location),
    "/proxy/https://otherdomain.com/api"
  );
});

test("fixUrl - falls back to config.url when location.pathname does not start with prefix", () => {
  const config = { prefix: "/proxy/", url: "https://youtube.com/watch?v=123" };
  const location = {
    pathname: "/some-other-path",
    search: "",
    hash: "",
    origin: "https://myproxy.com",
    hostname: "myproxy.com",
  };

  assert.equal(
    fixUrl("/watch?v=456", config, location),
    "/proxy/https://youtube.com/watch?v=456"
  );
});

test("fixUrl - handles tricky sites using proxy hostname for relative URLs", () => {
  const config = { prefix: "/proxy/", url: "https://tricky-site.com:8080/page" };
  const location = {
    pathname: "/proxy/https://tricky-site.com:8080/page",
    search: "",
    hash: "",
    origin: "https://myproxy.com",
    hostname: "myproxy.com",
  };

  // Tricky site constructing URL using window.location.hostname (proxy host)
  const trickyUrl = "https://myproxy.com/assets/style.css";
  assert.equal(
    fixUrl(trickyUrl, config, location),
    "/proxy/https://tricky-site.com:8080/assets/style.css"
  );
});
