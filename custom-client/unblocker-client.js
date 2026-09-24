(function (global) {
  "use strict";

  // todo:
  // - postMessage
  // - open
  // - DOM Mutation Observer
  //   - href
  //   - src
  //   - srcset
  //   - style (this could get tricky...)
  //   - poster (on <video> elements)
  //   - perhaps some/all of this could be shared by the server-side url-rewriter
  // - split each part into separate files (?)
  // - wrap other JS and provide proxies to fix writes to window.location and document.cookie
  //   - will require updating contentTypes.html.includes(data.contentType) to include js
  //   - that, in turn will require decompressing js....
  // call() and apply() on `this || original_thing`
  // prevent a failure in one initializer from stopping subsequent initializers

  function fixUrl(urlStr, config, location) {
    if (urlStr === null || urlStr === undefined) {
      return urlStr;
    }
    urlStr = urlStr.toString();

    var currentRemoteHref;
    if (location.pathname.substr(0, config.prefix.length) === config.prefix) {
      currentRemoteHref =
        location.pathname.substr(config.prefix.length) +
        location.search +
        location.hash;
    } else {
      // in case sites (such as youtube) manage to bypass our history wrapper
      currentRemoteHref = config.url;
    }

    // check if it's already proxied (root-relative)
    if (urlStr.substr(0, config.prefix.length) === config.prefix) {
      return urlStr;
    }

    var url = new URL(urlStr, currentRemoteHref);

    // check if it's already proxied (absolute)
    if (
      url.origin === location.origin &&
      url.pathname.substr(0, config.prefix.length) === config.prefix
    ) {
      return urlStr;
    }

    // don't break data: urls, about:blank, etc
    // todo: do modify ws: and wss: protocols
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return urlStr;
    }

    // sometimes websites are tricky and use the current host or hostname + a relative url
    // check hostname (ignoring port)
    if (url.hostname === location.hostname) {
      var currentRemoteUrl = new URL(currentRemoteHref);
      // set host (including port)
      url.host = currentRemoteUrl.host;
      // also keep the remote site's current protocol
      url.protocol = currentRemoteUrl.protocol;
      // todo: handle websocket protocols
    }
    return config.prefix + url.href;
  }

  function initXMLHttpRequest(config, window) {
    if (!window.XMLHttpRequest) return;
    var _XMLHttpRequest = window.XMLHttpRequest;

    window.XMLHttpRequest = function (opts) {
      var xhr = new _XMLHttpRequest(opts);
      var _open = xhr.open;
      xhr.open = function () {
        var args = Array.prototype.slice.call(arguments);
        args[1] = fixUrl(args[1], config, window.location);
        return _open.apply(xhr, args);
      };
      return xhr;
    };
  }

  function initFetch(config, window) {
    if (!window.fetch) return;
    var _fetch = window.fetch;

    window.fetch = function (resource, init) {
      if (resource && typeof resource === "object" && resource.url) {
        var proxiedUrl = fixUrl(resource.url, config, window.location);
        var isRequest =
          (typeof Request !== "undefined" && resource instanceof Request) ||
          (resource.constructor && resource.constructor.name === "Request");
        if (isRequest) {
          resource = new Request(proxiedUrl, resource);
        } else {
          try {
            resource.url = proxiedUrl;
          } catch (e) {
            if (typeof Request !== "undefined") {
              resource = new Request(proxiedUrl, resource);
            }
          }
        }
      } else if (resource !== null && resource !== undefined) {
        resource = fixUrl(resource.toString(), config, window.location);
      }
      return _fetch(resource, init);
    };
  }

  // this prevents an initial request to the wrong (unproxied) URL
  // it also is important for <img> and <audio> elements that are only created in memory, and never added to the DOM
  function initCreateElement(config, window) {
    if (!window.document || !window.document.createElement) return;
    var _createElement = window.document.createElement;

    window.document.createElement = function (tagName, options) {
      if (tagName.toLowerCase() === "iframe") {
        initAppendBodyIframe(config, window);
      }
      var element = _createElement.call(window.document, tagName, options);
      Object.defineProperty(element, "src", {
        set: function (src) {
          delete element.src; // remove this setter so we don't get stuck in an infinite loop
          element.src = fixUrl(src, config, window.location);
        },
        configurable: true,
      });
      // todo: let a DOM mutation observer handle href attributes when they're added to the document
      Object.defineProperty(element, "href", {
        set: function (href) {
          delete element.href; // remove this setter so we don't get stuck in an infinite loop
          element.href = fixUrl(href, config, window.location);
        },
        configurable: true,
      });
      // todo: consider restoring the setter in case the client js changes the value later (does that happen?)
      return element;
    };
  }

  // js on some sites, such as youtube, uses an iframe to grab native APIs such as history, so we need to fix those also.
  // document.body isn't available when this script is first executed,
  // so we'll also try when createElement is called, but set a flag to ensure it only installs once
  function initAppendBodyIframe(config, window) {
    if (
      !window.document ||
      !window.document.body ||
      !window.document.body.appendChild ||
      window.document.body.unblockerIframeAppendListenerInstalled
    ) {
      return;
    }

    var _appendChild = window.document.body.appendChild;

    window.document.body.appendChild = function (element) {
      var ret = _appendChild.call(window.document.body, element);
      if (
        element.tagName &&
        element.tagName.toLowerCase() === "iframe" &&
        element.src === "about:blank" &&
        element.contentWindow
      ) {
        initForWindow(config, element.contentWindow);
      }
      return ret;
    };
    window.document.body.unblockerIframeAppendListenerInstalled = true;
  }

  function initWebSockets(config, window) {
    if (!window.WebSocket) return;
    var _WebSocket = window.WebSocket;
    var prefix = config.prefix;
    var winLoc = window.location;
    var proxyHost = winLoc.host;
    var isSecure = winLoc.protocol === "https:";
    var target = winLoc.pathname.substr(prefix.length);
    var targetURL = new URL(target);

    // ws:// or wss:// then at least one char for location,
    // then either the end or a path
    var reWsUrl = /^ws(s?):\/\/([^/]+)($|\/.*)/;

    window.WebSocket = function (url, protocols) {
      var parsedUrl = url.match(reWsUrl);
      if (parsedUrl) {
        var wsSecure = parsedUrl[1];
        // force downgrade if wss:// is called on insecure page
        // (in case the proxy only supports http)
        var wsProto = isSecure ? "ws" + wsSecure + "://" : "ws://";
        var wsHost = parsedUrl[2];
        // deal with "relative" js that uses the current url rather than a hard-coded one
        if (wsHost === winLoc.host || wsHost === winLoc.hostname) {
          // todo: handle situation where ws hostname === location.hostname but ports differ
          wsHost = targetURL.host;
        }
        var wsPath = parsedUrl[3];
        // prefix the websocket with the proxy server
        return new _WebSocket(
          wsProto +
            proxyHost +
            prefix +
            "http" +
            wsSecure +
            "://" +
            wsHost +
            wsPath
        );
      }
      // fallback in case the regex failed
      return new _WebSocket(url, protocols);
    };
  }

  // todo: figure out how youtube bypasses this
  // notes: look at bindHistoryStateFunctions_ - it looks like it checks the contentWindow.history of an iframe *fitst*, then it's __proto__, then the global history api
  //        - so, we need to inject this into iframes also
  function initPushState(config, window) {
    if (!window.history || !window.history.pushState) return;

    var _pushState = window.history.pushState;
    window.history.pushState = function (state, title, url) {
      if (url) {
        url = fixUrl(url, config, window.location);
        config.url = new URL(url, config.url);
        return _pushState.call(window.history, state, title, url);
      }
    };

    if (!window.history.replaceState) return;
    var _replaceState = window.history.replaceState;
    window.history.replaceState = function (state, title, url) {
      if (url) {
        url = fixUrl(url, config, window.location);
        config.url = new URL(url, config.url);
        return _replaceState.call(window.history, state, title, url);
      }
    };
  }

  function initHeavenlyWidgets(window) {
    try {
      if (window !== window.top) return; // Only show in main top window
      if (window.document && window.document.getElementById('heavenly-scroll-lock-root')) return;

      var scrollLockEnabled = false;

      // Intercept keydown during capture phase to prevent browser scrolling when lock is ON
      window.addEventListener('keydown', function (e) {
        if (!scrollLockEnabled) return;
        var target = e.target;
        var isInput = false;
        if (target) {
          var tagName = target.tagName ? target.tagName.toLowerCase() : '';
          if (tagName === 'input' || tagName === 'textarea' || target.isContentEditable) {
            isInput = true;
          }
        }
        if (isInput) return;

        var scrollKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar'];
        var scrollKeyCodes = [32, 33, 34, 35, 36, 37, 38, 39, 40];
        if (scrollKeys.indexOf(e.key) !== -1 || scrollKeyCodes.indexOf(e.keyCode) !== -1) {
          e.preventDefault();
        }
      }, true);

      // Shared Stylesheet for Heavenly Widgets
      var widgetCss = [
        '.heavenly-widget {',
        '  background: rgba(15, 23, 42, 0.88);',
        '  backdrop-filter: blur(12px);',
        '  -webkit-backdrop-filter: blur(12px);',
        '  border: 1px solid rgba(56, 189, 248, 0.3);',
        '  border-radius: 14px;',
        '  box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.4), 0 0 15px rgba(56, 189, 248, 0.2);',
        '  padding: 8px 12px;',
        '  display: flex;',
        '  align-items: center;',
        '  gap: 8px;',
        '  color: #f8fafc;',
        '  font-size: 13px;',
        '  font-weight: 500;',
        '  cursor: grab;',
        '  box-sizing: border-box;',
        '  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);',
        '  opacity: 1;',
        '  overflow: hidden;',
        '}',
        '.heavenly-widget:active { cursor: grabbing; }',
        '.heavenly-widget:hover {',
        '  border-color: rgba(56, 189, 248, 0.6);',
        '  box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.5), 0 0 20px rgba(56, 189, 248, 0.35);',
        '}',
        '/* Auto-minimized circle state */',
        '.heavenly-widget.minimized {',
        '  width: 38px !important;',
        '  height: 38px !important;',
        '  padding: 0 !important;',
        '  border-radius: 50% !important;',
        '  justify-content: center !important;',
        '  opacity: 0.45 !important;',
        '  background: rgba(15, 23, 42, 0.75) !important;',
        '  border-color: rgba(56, 189, 248, 0.4) !important;',
        '  cursor: pointer !important;',
        '}',
        '.heavenly-widget.minimized:hover {',
        '  opacity: 0.95 !important;',
        '  transform: scale(1.08);',
        '  box-shadow: 0 0 15px rgba(56, 189, 248, 0.6);',
        '}',
        '.heavenly-widget.minimized .widget-content { display: none !important; }',
        '.heavenly-widget.minimized .mini-icon { display: flex !important; }',
        '.mini-icon { display: none; align-items: center; justify-content: center; }',
        '.widget-content { display: flex; align-items: center; gap: 8px; }',
        '.drag-handle { display: flex; align-items: center; gap: 6px; white-space: nowrap; color: #e0f2fe; font-weight: 600; }',
        '.title-icon {',
        '  width: 16px; height: 16px; fill: none; stroke: #38bdf8; stroke-width: 2;',
        '  stroke-linecap: round; stroke-linejoin: round;',
        '  filter: drop-shadow(0 0 4px rgba(56, 189, 248, 0.6));',
        '}',
        '.btn-toggle, .btn-ctrl {',
        '  background: rgba(30, 41, 59, 0.8); border: 1px solid rgba(148, 163, 184, 0.3);',
        '  color: #94a3b8; padding: 5px 9px; border-radius: 8px; font-size: 12px; font-weight: 600;',
        '  cursor: pointer; outline: none; transition: all 0.2s ease;',
        '  display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;',
        '}',
        '.btn-toggle:hover, .btn-ctrl:hover { background: rgba(51, 65, 85, 0.9); color: #f8fafc; }',
        '.btn-toggle.active {',
        '  background: linear-gradient(135deg, #38bdf8 0%, #60a5fa 100%);',
        '  border: 1px solid transparent; color: #030712; box-shadow: 0 0 12px rgba(56, 189, 248, 0.5);',
        '}'
      ].join('\n');

      // Helper to make a container draggable and auto-minimize
      function attachWidgetBehaviors(container, widgetElement, storageKey, defaultTop, defaultRight) {
        var isMinimized = false;
        var inactivityTimer = null;

        // Restore position from localStorage
        try {
          var savedPos = localStorage.getItem(storageKey);
          if (savedPos) {
            var pos = JSON.parse(savedPos);
            if (typeof pos.left === 'number' && typeof pos.top === 'number') {
              var maxLeft = (window.innerWidth || 800) - 50;
              var maxTop = (window.innerHeight || 600) - 50;
              container.style.right = 'auto';
              container.style.bottom = 'auto';
              container.style.left = Math.max(0, Math.min(pos.left, maxLeft)) + 'px';
              container.style.top = Math.max(0, Math.min(pos.top, maxTop)) + 'px';
            }
          } else {
            container.style.top = defaultTop + 'px';
            container.style.right = defaultRight + 'px';
          }
        } catch (e) {}

        // Auto-minimize timer (10s)
        function resetInactivityTimer() {
          if (inactivityTimer) clearTimeout(inactivityTimer);
          if (!isMinimized) {
            inactivityTimer = setTimeout(function () {
              minimize();
            }, 10000);
          }
        }

        function minimize() {
          isMinimized = true;
          widgetElement.classList.add('minimized');
        }

        function expand() {
          isMinimized = false;
          widgetElement.classList.remove('minimized');
          resetInactivityTimer();
        }

        // Click on minimized widget expands it
        widgetElement.addEventListener('click', function (e) {
          if (isMinimized) {
            e.stopPropagation();
            expand();
          }
        });

        // Interaction listeners to reset timer
        ['mouseenter', 'mousemove', 'mousedown', 'touchstart'].forEach(function (evt) {
          widgetElement.addEventListener(evt, function () {
            if (!isMinimized) resetInactivityTimer();
          });
        });

        // Click-and-drag logic
        var isDragging = false;
        var startX = 0, startY = 0;
        var startLeft = 0, startTop = 0;

        var onMouseDown = function (e) {
          if (isMinimized) return; // Expand handled by click
          var target = e.target;
          if (target && (target.tagName === 'BUTTON' || target.closest('button') || target.tagName === 'INPUT')) {
            return;
          }
          isDragging = true;
          startX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
          startY = e.clientY || (e.touches && e.touches[0].clientY) || 0;

          var rect = container.getBoundingClientRect();
          startLeft = rect.left;
          startTop = rect.top;

          container.style.right = 'auto';
          container.style.bottom = 'auto';
          container.style.left = startLeft + 'px';
          container.style.top = startTop + 'px';

          window.addEventListener('mousemove', onMouseMove, true);
          window.addEventListener('mouseup', onMouseUp, true);
          window.addEventListener('touchmove', onMouseMove, true);
          window.addEventListener('touchend', onMouseUp, true);
        };

        var onMouseMove = function (e) {
          if (!isDragging) return;
          var currentX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
          var currentY = e.clientY || (e.touches && e.touches[0].clientY) || 0;
          var dx = currentX - startX;
          var dy = currentY - startY;

          var newLeft = startLeft + dx;
          var newTop = startTop + dy;

          var maxLeft = (window.innerWidth || 800) - container.offsetWidth;
          var maxTop = (window.innerHeight || 600) - container.offsetHeight;

          newLeft = Math.max(0, Math.min(newLeft, maxLeft));
          newTop = Math.max(0, Math.min(newTop, maxTop));

          container.style.left = newLeft + 'px';
          container.style.top = newTop + 'px';
        };

        var onMouseUp = function () {
          if (isDragging) {
            isDragging = false;
            // Save position to localStorage
            try {
              var rect = container.getBoundingClientRect();
              localStorage.setItem(storageKey, JSON.stringify({ left: rect.left, top: rect.top }));
            } catch (e) {}
          }
          window.removeEventListener('mousemove', onMouseMove, true);
          window.removeEventListener('mouseup', onMouseUp, true);
          window.removeEventListener('touchmove', onMouseMove, true);
          window.removeEventListener('touchend', onMouseUp, true);
        };

        widgetElement.addEventListener('mousedown', onMouseDown);
        widgetElement.addEventListener('touchstart', onMouseDown);

        resetInactivityTimer();
        return { minimize: minimize, expand: expand, resetTimer: resetInactivityTimer };
      }

      function injectUI() {
        if (!window.document || !window.document.body) return;
        if (window.document.getElementById('heavenly-scroll-lock-root')) return;

        // --- 1. SCROLL LOCK WIDGET ---
        var lockContainer = window.document.createElement('div');
        lockContainer.id = 'heavenly-scroll-lock-root';
        lockContainer.style.cssText = 'position:fixed;z-index:2147483646;user-select:none;-webkit-user-select:none;font-family:"Outfit",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';

        var lockShadow = lockContainer.attachShadow ? lockContainer.attachShadow({ mode: 'open' }) : lockContainer;

        var lockStyle = window.document.createElement('style');
        lockStyle.textContent = widgetCss;

        var lockWidget = window.document.createElement('div');
        lockWidget.className = 'heavenly-widget';
        lockWidget.innerHTML = [
          '<div class="mini-icon" title="Scroll Lock (Click to expand)">',
          '  <svg class="title-icon" viewBox="0 0 24 24"><path d="M12 3a9 9 0 0 0 0 18M3 12h18"></path><circle cx="12" cy="12" r="9"></circle></svg>',
          '</div>',
          '<div class="widget-content">',
          '  <div class="drag-handle" title="Click and drag to move">',
          '    <svg class="title-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"></circle><path d="M12 3a9 9 0 0 0 0 18"></path><path d="M3 12h18"></path></svg>',
          '    <span>Scroll Lock</span>',
          '  </div>',
          '  <button type="button" class="btn-toggle" id="toggle-btn"><span>🔓 OFF</span></button>',
          '</div>'
        ].join('\n');

        lockShadow.appendChild(lockStyle);
        lockShadow.appendChild(lockWidget);
        window.document.body.appendChild(lockContainer);

        var lockToggleBtn = lockShadow.querySelector('#toggle-btn');
        lockToggleBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          scrollLockEnabled = !scrollLockEnabled;
          if (scrollLockEnabled) {
            lockToggleBtn.classList.add('active');
            lockToggleBtn.innerHTML = '<span>🔒 ON</span>';
          } else {
            lockToggleBtn.classList.remove('active');
            lockToggleBtn.innerHTML = '<span>🔓 OFF</span>';
          }
        });

        attachWidgetBehaviors(lockContainer, lockWidget, 'heavenly_scroll_lock_pos', 20, 20);

        // --- 2. MAGNIFIER WIDGET & LENS FRAME ---
        var magContainer = window.document.createElement('div');
        magContainer.id = 'heavenly-magnifier-root';
        magContainer.style.cssText = 'position:fixed;z-index:2147483646;user-select:none;-webkit-user-select:none;font-family:"Outfit",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';

        var magShadow = magContainer.attachShadow ? magContainer.attachShadow({ mode: 'open' }) : magContainer;

        var magStyle = window.document.createElement('style');
        magStyle.textContent = widgetCss + [
          '.lens-frame {',
          '  position: fixed;',
          '  border: 2px solid #38bdf8;',
          '  border-radius: 16px;',
          '  box-shadow: 0 0 25px rgba(56, 189, 248, 0.4), 0 10px 30px rgba(0, 0, 0, 0.5);',
          '  background: rgba(15, 23, 42, 0.95);',
          '  overflow: hidden;',
          '  z-index: 2147483645;',
          '  display: flex;',
          '  flex-direction: column;',
          '}',
          '.lens-header {',
          '  height: 28px;',
          '  background: rgba(30, 41, 59, 0.95);',
          '  border-bottom: 1px solid rgba(56, 189, 248, 0.3);',
          '  display: flex;',
          '  align-items: center;',
          '  justify-content: space-between;',
          '  padding: 0 8px;',
          '  font-size: 11px;',
          '  font-weight: 600;',
          '  color: #e0f2fe;',
          '  cursor: grab;',
          '}',
          '.lens-header:active { cursor: grabbing; }',
          '.lens-view {',
          '  flex: 1;',
          '  position: relative;',
          '  overflow: hidden;',
          '  background: #ffffff;',
          '}',
          '.lens-mirror {',
          '  position: absolute;',
          '  transform-origin: 0 0;',
          '  pointer-events: none;',
          '}',
          '.btn-close-lens {',
          '  background: none; border: none; color: #94a3b8; font-size: 14px;',
          '  cursor: pointer; padding: 0 4px; line-height: 1;',
          '}',
          '.btn-close-lens:hover { color: #ef4444; }'
        ].join('\n');

        var magWidget = window.document.createElement('div');
        magWidget.className = 'heavenly-widget';
        magWidget.innerHTML = [
          '<div class="mini-icon" title="Magnifier (Click to expand)">',
          '  <svg class="title-icon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>',
          '</div>',
          '<div class="widget-content">',
          '  <div class="drag-handle" title="Click and drag to move">',
          '    <svg class="title-icon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>',
          '    <span>Magnifier</span>',
          '  </div>',
          '  <button type="button" class="btn-toggle" id="mag-toggle-btn"><span>🔍 OFF</span></button>',
          '  <button type="button" class="btn-ctrl" id="zoom-out-btn" title="Zoom Out">-</button>',
          '  <span id="zoom-label" style="font-size:11px;font-weight:700;color:#38bdf8;">2.0x</span>',
          '  <button type="button" class="btn-ctrl" id="zoom-in-btn" title="Zoom In">+</button>',
          '  <button type="button" class="btn-ctrl" id="size-btn" title="Lens Size">Size</button>',
          '</div>'
        ].join('\n');

        magShadow.appendChild(magStyle);
        magShadow.appendChild(magWidget);
        window.document.body.appendChild(magContainer);

        attachWidgetBehaviors(magContainer, magWidget, 'heavenly_magnifier_pos', 70, 20);

        // --- Magnifier Lens Frame Logic ---
        var magEnabled = false;
        var zoomLevel = 2.0;
        var lensSize = 220; // 160 (S), 220 (M), 300 (L)
        var lensPos = { left: Math.max(50, Math.floor((window.innerWidth || 800) / 2 - 110)), top: Math.max(50, Math.floor((window.innerHeight || 600) / 2 - 110)) };

        try {
          var savedLens = localStorage.getItem('heavenly_lens_pos');
          if (savedLens) {
            var lp = JSON.parse(savedLens);
            if (typeof lp.left === 'number') lensPos.left = lp.left;
            if (typeof lp.top === 'number') lensPos.top = lp.top;
            if (typeof lp.zoom === 'number') zoomLevel = lp.zoom;
            if (typeof lp.size === 'number') lensSize = lp.size;
          }
        } catch (e) {}

        var lensFrame = null;
        var mirrorNode = null;

        function updateMirrorPosition() {
          if (!lensFrame || !mirrorNode) return;
          var centerX = lensPos.left + lensSize / 2;
          var centerY = lensPos.top + lensSize / 2 + 14; // header offset
          var scrollX = window.scrollX || window.pageXOffset || 0;
          var scrollY = window.scrollY || window.pageYOffset || 0;

          var mirrorLeft = (lensSize / 2) - ((centerX + scrollX) * zoomLevel);
          var mirrorTop = ((lensSize - 28) / 2) - ((centerY + scrollY) * zoomLevel);

          mirrorNode.style.transform = 'scale(' + zoomLevel + ')';
          mirrorNode.style.left = mirrorLeft + 'px';
          mirrorNode.style.top = mirrorTop + 'px';
        }

        function createLensFrame() {
          if (lensFrame) return;

          lensFrame = window.document.createElement('div');
          lensFrame.className = 'lens-frame';
          lensFrame.style.width = lensSize + 'px';
          lensFrame.style.height = lensSize + 'px';
          lensFrame.style.left = lensPos.left + 'px';
          lensFrame.style.top = lensPos.top + 'px';

          lensFrame.innerHTML = [
            '<div class="lens-header" id="lens-header">',
            '  <span>🔍 Lens (' + zoomLevel.toFixed(1) + 'x)</span>',
            '  <button type="button" class="btn-close-lens" id="close-lens-btn">✕</button>',
            '</div>',
            '<div class="lens-view" id="lens-view"></div>'
          ].join('\n');

          magShadow.appendChild(lensFrame);

          var viewEl = lensFrame.querySelector('#lens-view');

          // Mirror clone of document body
          var clone = window.document.body.cloneNode(true);
          // Remove heavenly roots from clone to avoid infinite duplication
          var roots = clone.querySelectorAll('#heavenly-scroll-lock-root, #heavenly-magnifier-root');
          roots.forEach(function (r) { r.remove(); });

          mirrorNode = window.document.createElement('div');
          mirrorNode.className = 'lens-mirror';
          mirrorNode.style.width = Math.max(window.document.documentElement.scrollWidth, window.innerWidth) + 'px';
          mirrorNode.style.height = Math.max(window.document.documentElement.scrollHeight, window.innerHeight) + 'px';
          mirrorNode.appendChild(clone);
          viewEl.appendChild(mirrorNode);

          updateMirrorPosition();

          // Close button inside header
          lensFrame.querySelector('#close-lens-btn').addEventListener('click', function (e) {
            e.stopPropagation();
            toggleMagnifier(false);
          });

          // Draggable header for lens frame
          var headerEl = lensFrame.querySelector('#lens-header');
          var isDraggingLens = false;
          var startX = 0, startY = 0;
          var startLeft = 0, startTop = 0;

          headerEl.addEventListener('mousedown', function (e) {
            if (e.target.tagName === 'BUTTON') return;
            isDraggingLens = true;
            startX = e.clientX || 0;
            startY = e.clientY || 0;
            startLeft = lensPos.left;
            startTop = lensPos.top;

            var onMove = function (me) {
              if (!isDraggingLens) return;
              var dx = (me.clientX || 0) - startX;
              var dy = (me.clientY || 0) - startY;
              lensPos.left = Math.max(0, Math.min(startLeft + dx, window.innerWidth - lensSize));
              lensPos.top = Math.max(0, Math.min(startTop + dy, window.innerHeight - lensSize));
              lensFrame.style.left = lensPos.left + 'px';
              lensFrame.style.top = lensPos.top + 'px';
              updateMirrorPosition();
            };

            var onUp = function () {
              isDraggingLens = false;
              window.removeEventListener('mousemove', onMove, true);
              window.removeEventListener('mouseup', onUp, true);
              try {
                localStorage.setItem('heavenly_lens_pos', JSON.stringify({ left: lensPos.left, top: lensPos.top, zoom: zoomLevel, size: lensSize }));
              } catch (e) {}
            };

            window.addEventListener('mousemove', onMove, true);
            window.addEventListener('mouseup', onUp, true);
          });
        }

        function destroyLensFrame() {
          if (lensFrame) {
            lensFrame.remove();
            lensFrame = null;
            mirrorNode = null;
          }
        }

        function toggleMagnifier(enable) {
          magEnabled = enable !== undefined ? enable : !magEnabled;
          var btn = magShadow.querySelector('#mag-toggle-btn');
          if (magEnabled) {
            btn.classList.add('active');
            btn.innerHTML = '<span>🔍 ON</span>';
            createLensFrame();
          } else {
            btn.classList.remove('active');
            btn.innerHTML = '<span>🔍 OFF</span>';
            destroyLensFrame();
          }
        }

        magShadow.querySelector('#mag-toggle-btn').addEventListener('click', function (e) {
          e.stopPropagation();
          toggleMagnifier();
        });

        magShadow.querySelector('#zoom-in-btn').addEventListener('click', function (e) {
          e.stopPropagation();
          if (zoomLevel < 4.0) {
            zoomLevel = Math.round((zoomLevel + 0.5) * 10) / 10;
            magShadow.querySelector('#zoom-label').textContent = zoomLevel.toFixed(1) + 'x';
            if (lensFrame) {
              lensFrame.querySelector('#lens-header span').textContent = '🔍 Lens (' + zoomLevel.toFixed(1) + 'x)';
              updateMirrorPosition();
            }
          }
        });

        magShadow.querySelector('#zoom-out-btn').addEventListener('click', function (e) {
          e.stopPropagation();
          if (zoomLevel > 1.5) {
            zoomLevel = Math.round((zoomLevel - 0.5) * 10) / 10;
            magShadow.querySelector('#zoom-label').textContent = zoomLevel.toFixed(1) + 'x';
            if (lensFrame) {
              lensFrame.querySelector('#lens-header span').textContent = '🔍 Lens (' + zoomLevel.toFixed(1) + 'x)';
              updateMirrorPosition();
            }
          }
        });

        magShadow.querySelector('#size-btn').addEventListener('click', function (e) {
          e.stopPropagation();
          if (lensSize === 160) lensSize = 220;
          else if (lensSize === 220) lensSize = 300;
          else lensSize = 160;

          if (lensFrame) {
            lensFrame.style.width = lensSize + 'px';
            lensFrame.style.height = lensSize + 'px';
            updateMirrorPosition();
          }
        });

        // Sync mirror on page scroll
        window.addEventListener('scroll', function () {
          if (magEnabled) updateMirrorPosition();
        }, { passive: true });
      }

      if (window.document && (window.document.readyState === 'interactive' || window.document.readyState === 'complete')) {
        injectUI();
      } else if (window.document) {
        window.document.addEventListener('DOMContentLoaded', injectUI);
        window.addEventListener('load', injectUI);
      }
    } catch (err) {
      console.error('Error initializing Heavenly widgets:', err);
    }
  }

  function initForWindow(config, window) {
    console.log("begin unblocker client scripts", config, window);
    initXMLHttpRequest(config, window);
    initFetch(config, window);
    initCreateElement(config, window);
    initAppendBodyIframe(config, window);
    initWebSockets(config, window);
    initPushState(config, window);
    initHeavenlyWidgets(window);
    if (window === global) {
      // leave no trace
      delete global.unblockerInit;
    }
    console.log("unblocker client scripts initialized");
  }

  // either export things for testing or put the init method into the global scope to be called
  // with config by the next script tag in a browser
  /*globals module*/
  if (typeof module === "undefined") {
    global.unblockerInit = initForWindow;
  } else {
    module.exports = {
      initForWindow: initForWindow,
      fixUrl: fixUrl,
    };
  }
})(this); // window in a browser, global in node.js
