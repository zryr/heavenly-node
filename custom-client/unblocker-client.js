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

  function loadHeavenlySettings(window) {
    var saved = {};
    try {
      saved = JSON.parse((window.localStorage || localStorage).getItem('heavenly_settings') || '{}');
    } catch (e) {}

    return {
      autoCloak: saved.autoCloak !== undefined ? saved.autoCloak : true,
      persistentCloak: saved.persistentCloak || false,
      selectedPreset: saved.selectedPreset || 'classroom',
      customPresets: saved.customPresets || {},
      panicKeyEnable: saved.panicKeyEnable || false,
      panicKey: saved.panicKey || '`',
      touchPanic: saved.touchPanic || false,
      panicUrl: saved.panicUrl || 'https://classroom.google.com',
      showScrollLock: saved.showScrollLock !== undefined ? saved.showScrollLock : true,
      showMagnifier: saved.showMagnifier !== undefined ? saved.showMagnifier : true,
      showNavSearch: saved.showNavSearch !== undefined ? saved.showNavSearch : true,
      showNavHome: saved.showNavHome !== undefined ? saved.showNavHome : true,
      useWidgetDock: saved.useWidgetDock || false,
      dockPosition: saved.dockPosition || 'bottom'
    };
  }

  function initHeavenlyCloakAndPanic(window, settings) {
    try {
      if (window !== window.top) return;

      var DEFAULT_PRESETS = {
        classroom: { title: "Google Classroom", icon: "https://ssl.gstatic.com/classroom/favicon.png" },
        drive: { title: "My Drive - Google Drive", icon: "https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_32dp.png" },
        canvas: { title: "Dashboard", icon: "https://du1ux2871uqvu.cloudfront.net/dist/images/favicon-e10d657a73.ico" },
        khan: { title: "Dashboard | Khan Academy", icon: "https://www.khanacademy.org/favicon.ico" }
      };

      if (!settings) {
        settings = loadHeavenlySettings(window);
      }
      var originalTitle = window.document.title;
      var originalFavicon = null;

      var favEl = window.document.querySelector("link[rel*='icon']");
      if (favEl) originalFavicon = favEl.href;

      function getPresetData() {
        var allPresets = Object.assign({}, DEFAULT_PRESETS, settings.customPresets);
        return allPresets[settings.selectedPreset] || DEFAULT_PRESETS.classroom;
      }

      function applyCloak(isCloaked) {
        if (!window.document) return;
        var preset = getPresetData();
        if (isCloaked) {
          if (!originalTitle) originalTitle = window.document.title;
          window.document.title = preset.title;

          var link = window.document.querySelector("link[rel*='icon']") || window.document.createElement('link');
          link.type = 'image/x-icon';
          link.rel = 'shortcut icon';
          link.href = preset.icon;
          window.document.getElementsByTagName('head')[0].appendChild(link);
        } else {
          if (originalTitle) window.document.title = originalTitle;
          if (originalFavicon) {
            var link2 = window.document.querySelector("link[rel*='icon']");
            if (link2) link2.href = originalFavicon;
          }
        }
      }

      // 1. Persistent Cloak
      if (settings.persistentCloak) {
        applyCloak(true);
      } else if (settings.autoCloak) {
        // 2. Auto Tab Cloak on tab blur/switch
        window.addEventListener('visibilitychange', function () {
          if (window.document.hidden) {
            applyCloak(true);
          } else {
            applyCloak(false);
          }
        });
      }

      // 3. Panic Key Shortcut
      if (settings.panicKeyEnable && settings.panicKey) {
        window.addEventListener('keydown', function (e) {
          if (e.key === settings.panicKey || e.code === settings.panicKey) {
            window.location.href = settings.panicUrl || 'https://classroom.google.com';
          }
        }, true);
      }

      // 4. Touch Panic Overlay Button
      if (settings.touchPanic) {
        function injectPanicOverlay() {
          if (!window.document || !window.document.body) return;
          if (window.document.getElementById('heavenly-touch-panic-root')) return;

          var pContainer = window.document.createElement('div');
          pContainer.id = 'heavenly-touch-panic-root';
          pContainer.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:2147483647;user-select:none;-webkit-user-select:none;font-family:"Outfit",sans-serif;';

          // Restore position from localStorage
          try {
            var savedPanicPos = localStorage.getItem('heavenly_panic_pos');
            if (savedPanicPos) {
              var pos = JSON.parse(savedPanicPos);
              if (typeof pos.left === 'number' && typeof pos.top === 'number') {
                pContainer.style.bottom = 'auto';
                pContainer.style.left = pos.left + 'px';
                pContainer.style.top = pos.top + 'px';
              }
            }
          } catch (e) {}

          var pShadow = pContainer.attachShadow ? pContainer.attachShadow({ mode: 'open' }) : pContainer;

          var pStyle = window.document.createElement('style');
          pStyle.textContent = [
            '.panic-wrapper { position: relative; display: inline-flex; align-items: center; justify-content: center; }',
            '.panic-btn {',
            '  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);',
            '  color: #ffffff; border: none; border-radius: 20px; font-weight: 700; font-size: 13px;',
            '  cursor: pointer; box-shadow: 0 0 15px rgba(239, 68, 68, 0.6); padding: 10px 16px;',
            '  display: flex; align-items: center; gap: 6px; white-space: nowrap;',
            '  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); outline: none;',
            '}',
            '.panic-btn.minimized {',
            '  width: 42px; height: 42px; padding: 0; border-radius: 50%; justify-content: center;',
            '  opacity: 0.85; font-size: 18px;',
            '}',
            '.panic-btn.dragging { cursor: grabbing; box-shadow: 0 0 25px rgba(239, 68, 68, 0.9); }',
            '.progress-svg { position: absolute; inset: -4px; width: calc(100% + 8px); height: calc(100% + 8px); pointer-events: none; opacity: 0; transition: opacity 0.2s; }',
            '.progress-svg.active { opacity: 1; }',
            '.progress-circle { fill: none; stroke: #38bdf8; stroke-width: 3; stroke-linecap: round; transform: rotate(-90deg); transform-origin: 50% 50%; }'
          ].join('\n');

          var wrapper = window.document.createElement('div');
          wrapper.className = 'panic-wrapper';
          wrapper.innerHTML = [
            '<svg class="progress-svg" id="prog-svg" viewBox="0 0 50 50">',
            '  <circle class="progress-circle" id="prog-circle" cx="25" cy="25" r="22" stroke-dasharray="138" stroke-dashoffset="138"></circle>',
            '</svg>',
            '<button type="button" class="panic-btn" id="p-btn">',
            '  <span>🚨</span><span class="btn-label">PANIC</span>',
            '</button>'
          ].join('\n');

          pShadow.appendChild(pStyle);
          pShadow.appendChild(wrapper);
          window.document.body.appendChild(pContainer);

          var btn = pShadow.querySelector('#p-btn');
          var progSvg = pShadow.querySelector('#prog-svg');
          var progCircle = pShadow.querySelector('#prog-circle');

          var isMinimized = false;
          var autoMinTimer = setTimeout(function () {
            isMinimized = true;
            btn.classList.add('minimized');
            btn.querySelector('.btn-label').style.display = 'none';
          }, 10000);

          // Long-press drag variables
          var holdTimer = null;
          var holdAnimFrame = null;
          var startTime = 0;
          var HOLD_DURATION = 1500; // 1.5 seconds
          var canDrag = false;
          var isDragging = false;
          var startX = 0, startY = 0;
          var startLeft = 0, startTop = 0;

          function triggerPanic() {
            window.location.href = settings.panicUrl || 'https://classroom.google.com';
          }

          function cancelHold() {
            if (holdTimer) clearTimeout(holdTimer);
            if (holdAnimFrame) cancelAnimationFrame(holdAnimFrame);
            holdTimer = null;
            holdAnimFrame = null;
            progSvg.classList.remove('active');
            progCircle.style.strokeDashoffset = '138';
          }

          function updateProgress() {
            var elapsed = Date.now() - startTime;
            var progress = Math.min(1, elapsed / HOLD_DURATION);
            var offset = 138 * (1 - progress);
            progCircle.style.strokeDashoffset = offset.toString();

            if (progress < 1) {
              holdAnimFrame = requestAnimationFrame(updateProgress);
            } else {
              canDrag = true;
              btn.classList.add('dragging');
              progSvg.classList.remove('active');
            }
          }

          var onDown = function (e) {
            canDrag = false;
            isDragging = false;
            startX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
            startY = e.clientY || (e.touches && e.touches[0].clientY) || 0;

            var rect = pContainer.getBoundingClientRect();
            startLeft = rect.left;
            startTop = rect.top;

            startTime = Date.now();
            progSvg.classList.add('active');
            updateProgress();

            window.addEventListener('mousemove', onMove, true);
            window.addEventListener('mouseup', onUp, true);
            window.addEventListener('touchmove', onMove, true);
            window.addEventListener('touchend', onUp, true);
          };

          var onMove = function (e) {
            var currentX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
            var currentY = e.clientY || (e.touches && e.touches[0].clientY) || 0;
            var dx = currentX - startX;
            var dy = currentY - startY;

            if (!canDrag) {
              if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
                cancelHold();
              }
              return;
            }

            isDragging = true;
            pContainer.style.bottom = 'auto';
            pContainer.style.right = 'auto';

            var newLeft = startLeft + dx;
            var newTop = startTop + dy;

            var maxLeft = (window.innerWidth || 800) - pContainer.offsetWidth;
            var maxTop = (window.innerHeight || 600) - pContainer.offsetHeight;

            pContainer.style.left = Math.max(0, Math.min(newLeft, maxLeft)) + 'px';
            pContainer.style.top = Math.max(0, Math.min(newTop, maxTop)) + 'px';
          };

          var onUp = function () {
            cancelHold();
            window.removeEventListener('mousemove', onMove, true);
            window.removeEventListener('mouseup', onUp, true);
            window.removeEventListener('touchmove', onMove, true);
            window.removeEventListener('touchend', onUp, true);

            if (canDrag && isDragging) {
              btn.classList.remove('dragging');
              try {
                var rect = pContainer.getBoundingClientRect();
                localStorage.setItem('heavenly_panic_pos', JSON.stringify({ left: rect.left, top: rect.top }));
              } catch (e) {}
            } else if (!isDragging) {
              // Tap/click triggers panic directly regardless of minimized circle state
              triggerPanic();
            }
          };

          btn.addEventListener('mousedown', onDown);
          btn.addEventListener('touchstart', onDown);
        }

        if (window.document && (window.document.readyState === 'interactive' || window.document.readyState === 'complete')) {
          injectPanicOverlay();
        } else if (window.document) {
          window.document.addEventListener('DOMContentLoaded', injectPanicOverlay);
        }
      }

    } catch (e) {
      console.error('Error initializing Heavenly Cloak & Panic:', e);
    }
  }

  function initHeavenlyWidgets(window, settings) {
    try {
      if (window !== window.top) return; // Only show in main top window

      if (!settings) {
        settings = loadHeavenlySettings(window);
      }

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
        '}',
        '.nav-input {',
        '  background: rgba(30, 41, 59, 0.85); border: 1px solid rgba(148, 163, 184, 0.35);',
        '  color: #f8fafc; padding: 6px 12px; border-radius: 10px; font-size: 12px; font-weight: 500;',
        '  outline: none; width: 150px; transition: border-color 0.2s, width 0.2s, box-shadow 0.2s;',
        '  font-family: inherit;',
        '}',
        '.nav-input::placeholder { color: #94a3b8; }',
        '.nav-input:focus {',
        '  border-color: #38bdf8; width: 190px; background: rgba(15, 23, 42, 0.95);',
        '  box-shadow: 0 0 10px rgba(56, 189, 248, 0.3);',
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

        var showScrollLock = settings.showScrollLock !== undefined ? settings.showScrollLock : true;
        var showMagnifier = settings.showMagnifier !== undefined ? settings.showMagnifier : true;
        var showNavSearch = settings.showNavSearch !== undefined ? settings.showNavSearch : true;
        var showNavHome = settings.showNavHome !== undefined ? settings.showNavHome : true;
        var useWidgetDock = settings.useWidgetDock || false;
        var dockPosition = settings.dockPosition || 'bottom';

        // --- COLLAPSIBLE WIDGET DOCK BAR MODE ---
        if (useWidgetDock) {
          // Remove floating widgets if present when dock is active
          ['heavenly-scroll-lock-root', 'heavenly-magnifier-root', 'heavenly-nav-root'].forEach(function (id) {
            var el = window.document.getElementById(id);
            if (el) el.remove();
          });

          if (window.document.getElementById('heavenly-dock-root')) return;
          var dockContainer = window.document.createElement('div');
          dockContainer.id = 'heavenly-dock-root';
          dockContainer.style.cssText = 'position:fixed;z-index:2147483646;user-select:none;-webkit-user-select:none;font-family:"Outfit",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';

          var dockShadow = dockContainer.attachShadow ? dockContainer.attachShadow({ mode: 'open' }) : dockContainer;

          var dockCss = widgetCss + [
            '.dock-wrapper {',
            '  position: fixed; display: flex; align-items: center; justify-content: center;',
            '  transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1); pointer-events: auto;',
            '}',
            '.dock-bar {',
            '  background: rgba(15, 23, 42, 0.92); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);',
            '  border: 1px solid rgba(56, 189, 248, 0.35); border-radius: 20px;',
            '  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6), 0 0 20px rgba(56, 189, 248, 0.25);',
            '  padding: 10px 16px; display: flex; align-items: center; gap: 12px; color: #f8fafc;',
            '}',
            '.pull-tab {',
            '  background: linear-gradient(135deg, rgba(56, 189, 248, 0.9) 0%, rgba(59, 130, 246, 0.9) 100%);',
            '  color: #030712; border: 1px solid rgba(255, 255, 255, 0.4); border-radius: 50%;',
            '  width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;',
            '  cursor: pointer; box-shadow: 0 0 15px rgba(56, 189, 248, 0.6); outline: none;',
            '  font-size: 14px; font-weight: 700; transition: transform 0.3s ease, box-shadow 0.3s ease; flex-shrink: 0;',
            '}',
            '.pull-tab:hover { transform: scale(1.12); box-shadow: 0 0 22px rgba(56, 189, 248, 0.9); }',
            '/* Dock Positions */',
            '.dock-bottom { bottom: 12px; left: 50%; transform: translateX(-50%); flex-direction: column; }',
            '.dock-bottom.collapsed { transform: translate(-50%, calc(100% - 16px)); }',
            '.dock-bottom .pull-tab { margin-bottom: 6px; }',
            '.dock-top { top: 12px; left: 50%; transform: translateX(-50%); flex-direction: column-reverse; }',
            '.dock-top.collapsed { transform: translate(-50%, calc(-100% + 16px)); }',
            '.dock-top .pull-tab { margin-top: 6px; }',
            '.dock-left { left: 12px; top: 50%; transform: translateY(-50%); flex-direction: row-reverse; }',
            '.dock-left .dock-bar { flex-direction: column; }',
            '.dock-left.collapsed { transform: translate(calc(-100% + 16px), -50%); }',
            '.dock-left .pull-tab { margin-left: 6px; }',
            '.dock-right { right: 12px; top: 50%; transform: translateY(-50%); flex-direction: row; }',
            '.dock-right .dock-bar { flex-direction: column; }',
            '.dock-right.collapsed { transform: translate(calc(100% - 16px), -50%); }',
            '.dock-right .pull-tab { margin-right: 6px; }',
            '.dock-item { display: flex; align-items: center; gap: 8px; }',
            '.dock-divider { width: 1px; height: 24px; background: rgba(148, 163, 184, 0.2); }',
            '.dock-left .dock-divider, .dock-right .dock-divider { width: 24px; height: 1px; }'
          ].join('\n');

          var dockStyle = window.document.createElement('style');
          dockStyle.textContent = dockCss;

          var arrowSymbol = '▲';
          if (dockPosition === 'bottom') arrowSymbol = '▼';
          else if (dockPosition === 'top') arrowSymbol = '▲';
          else if (dockPosition === 'left') arrowSymbol = '◄';
          else if (dockPosition === 'right') arrowSymbol = '►';

          var wrapper = window.document.createElement('div');
          wrapper.className = 'dock-wrapper dock-' + dockPosition;

          var pullBtn = window.document.createElement('button');
          pullBtn.type = 'button';
          pullBtn.className = 'pull-tab';
          pullBtn.title = 'Toggle Dock Bar';
          pullBtn.innerHTML = '<span>' + arrowSymbol + '</span>';

          var dockBar = window.document.createElement('div');
          dockBar.className = 'dock-bar';

          var items = [];

          if (showNavHome) {
            items.push('<button type="button" class="btn-ctrl" id="dock-home-btn" title="Go Home">🏠 Home</button>');
          }

          if (showNavSearch) {
            items.push('<div class="dock-item"><input type="text" class="nav-input" id="dock-search-input" placeholder="Search or URL..." /><button type="button" class="btn-ctrl" id="dock-go-btn">Go</button></div>');
          }

          if (showScrollLock) {
            items.push('<div class="dock-item"><span style="font-size:12px;font-weight:600;color:#e0f2fe;">Scroll Lock</span><button type="button" class="btn-toggle" id="dock-scroll-btn"><span>🔓 OFF</span></button></div>');
          }

          if (showMagnifier) {
            items.push('<div class="dock-item"><button type="button" class="btn-toggle" id="dock-mag-btn"><span>🔍 Mag OFF</span></button><button type="button" class="btn-ctrl" id="dock-zoom-out">-</button><span id="dock-zoom-label" style="font-size:11px;font-weight:700;color:#38bdf8;">2.0x</span><button type="button" class="btn-ctrl" id="dock-zoom-in">+</button></div>');
          }

          dockBar.innerHTML = items.join('<div class="dock-divider"></div>');

          wrapper.appendChild(pullBtn);
          wrapper.appendChild(dockBar);
          dockShadow.appendChild(dockStyle);
          dockShadow.appendChild(wrapper);

          var targetParent = window.document.body || window.document.documentElement;
          if (targetParent) targetParent.appendChild(dockContainer);

          var isCollapsed = false;
          pullBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            isCollapsed = !isCollapsed;
            if (isCollapsed) {
              wrapper.classList.add('collapsed');
              pullBtn.querySelector('span').style.transform = 'rotate(180deg)';
            } else {
              wrapper.classList.remove('collapsed');
              pullBtn.querySelector('span').style.transform = 'rotate(0deg)';
            }
          });

          // Wire up Home button
          if (showNavHome) {
            var homeBtn = dockBar.querySelector('#dock-home-btn');
            if (homeBtn) homeBtn.addEventListener('click', function (e) {
              e.stopPropagation();
              window.location.href = 'https://heavenly-node.vercel.app/';
            });
          }

          // Wire up Search
          if (showNavSearch) {
            var goBtn = dockBar.querySelector('#dock-go-btn');
            var searchInput = dockBar.querySelector('#dock-search-input');
            var handleNav = function () {
              if (!searchInput) return;
              var val = searchInput.value.trim();
              if (!val) return;
              if (val.substr(0, 4) !== "http") {
                if (val.includes('.') && !val.includes(' ')) {
                  val = "https://" + val;
                } else {
                  val = "https://google.com/search?q=" + encodeURIComponent(val);
                }
              }
              window.location.href = window.location.protocol + '//' + window.location.host + '/proxy/' + val;
            };
            if (goBtn) goBtn.addEventListener('click', function (e) { e.stopPropagation(); handleNav(); });
            if (searchInput) searchInput.addEventListener('keydown', function (e) {
              e.stopPropagation();
              if (e.key === 'Enter') handleNav();
            });
          }

          // Wire up Scroll Lock
          if (showScrollLock) {
            var scrollBtn = dockBar.querySelector('#dock-scroll-btn');
            if (scrollBtn) scrollBtn.addEventListener('click', function (e) {
              e.stopPropagation();
              scrollLockEnabled = !scrollLockEnabled;
              if (scrollLockEnabled) {
                scrollBtn.classList.add('active');
                scrollBtn.innerHTML = '<span>🔒 ON</span>';
              } else {
                scrollBtn.classList.remove('active');
                scrollBtn.innerHTML = '<span>🔓 OFF</span>';
              }
            });
          }

          // Wire up Magnifier
          if (showMagnifier) {
            var magBtn = dockBar.querySelector('#dock-mag-btn');
            var zoomInBtn = dockBar.querySelector('#dock-zoom-in');
            var zoomOutBtn = dockBar.querySelector('#dock-zoom-out');
            var zoomLabel = dockBar.querySelector('#dock-zoom-label');

            if (magBtn) magBtn.addEventListener('click', function (e) {
              e.stopPropagation();
              toggleMagnifier();
              if (magEnabled) {
                magBtn.classList.add('active');
                magBtn.innerHTML = '<span>🔍 Mag ON</span>';
              } else {
                magBtn.classList.remove('active');
                magBtn.innerHTML = '<span>🔍 Mag OFF</span>';
              }
            });

            if (zoomInBtn) zoomInBtn.addEventListener('click', function (e) {
              e.stopPropagation();
              if (zoomLevel < 4.0) {
                zoomLevel = Math.round((zoomLevel + 0.5) * 10) / 10;
                if (zoomLabel) zoomLabel.textContent = zoomLevel.toFixed(1) + 'x';
                if (lensFrame) {
                  lensFrame.querySelector('#lens-header span').textContent = '🔍 Lens (' + zoomLevel.toFixed(1) + 'x)';
                  updateMirrorPosition();
                }
              }
            });

            if (zoomOutBtn) zoomOutBtn.addEventListener('click', function (e) {
              e.stopPropagation();
              if (zoomLevel > 1.5) {
                zoomLevel = Math.round((zoomLevel - 0.5) * 10) / 10;
                if (zoomLabel) zoomLabel.textContent = zoomLevel.toFixed(1) + 'x';
                if (lensFrame) {
                  lensFrame.querySelector('#lens-header span').textContent = '🔍 Lens (' + zoomLevel.toFixed(1) + 'x)';
                  updateMirrorPosition();
                }
              }
            });
          }

          return;
        }

        // Remove dock bar if active mode switched to floating
        var existingDock = window.document.getElementById('heavenly-dock-root');
        if (existingDock) existingDock.remove();

        if (window.document.getElementById('heavenly-scroll-lock-root') || window.document.getElementById('heavenly-nav-root')) return;

        // --- 1. SCROLL LOCK WIDGET ---
        if (showScrollLock) {
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
        }

        // --- 2. MAGNIFIER WIDGET & LENS FRAME ---
        if (showMagnifier) {
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
        }

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
          var rootIds = ['heavenly-scroll-lock-root', 'heavenly-magnifier-root', 'heavenly-nav-root', 'heavenly-touch-panic-root', 'heavenly-dock-root'];
          for (var rIdx = 0; rIdx < rootIds.length; rIdx++) {
            var rootEl = clone.querySelector('#' + rootIds[rIdx]);
            if (rootEl) {
              if (rootEl.remove) rootEl.remove();
              else if (rootEl.parentNode) rootEl.parentNode.removeChild(rootEl);
            }
          }

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

        // --- 3. NAVIGATION WIDGET (Search Bar & Home Button) ---
        if (showNavSearch || showNavHome) {
          var navContainer = window.document.createElement('div');
          navContainer.id = 'heavenly-nav-root';
          navContainer.style.cssText = 'position:fixed;z-index:2147483646;user-select:none;-webkit-user-select:none;font-family:"Outfit",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';

          var navShadow = navContainer.attachShadow ? navContainer.attachShadow({ mode: 'open' }) : navContainer;

          var navStyle = window.document.createElement('style');
          navStyle.textContent = widgetCss + [
            '.nav-input {',
            '  background: rgba(30, 41, 59, 0.8); border: 1px solid rgba(148, 163, 184, 0.3);',
            '  color: #f8fafc; padding: 5px 10px; border-radius: 8px; font-size: 12px; font-weight: 500;',
            '  outline: none; width: 140px; transition: border-color 0.2s, width 0.2s;',
            '}',
            '.nav-input:focus { border-color: #38bdf8; width: 180px; background: rgba(15, 23, 42, 0.95); }'
          ].join('\n');

          var navWidget = window.document.createElement('div');
          navWidget.className = 'heavenly-widget';

          var navHtml = ['<div class="mini-icon" title="Navigation (Click to expand)"><svg class="title-icon" viewBox="0 0 24 24"><path d="M3 12h18M12 3l9 9-9 9"></path></svg></div>', '<div class="widget-content">'];
          navHtml.push('<div class="drag-handle" title="Click and drag to move"><svg class="title-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon></svg></div>');

          if (showNavSearch) {
            navHtml.push('<input type="text" class="nav-input" id="nav-search-input" placeholder="Search or URL..." />');
            navHtml.push('<button type="button" class="btn-ctrl" id="nav-go-btn">Go</button>');
          }

          if (showNavHome) {
            navHtml.push('<button type="button" class="btn-ctrl" id="nav-home-btn" title="Go to Homepage">🏠 Home</button>');
          }

          navHtml.push('</div>');
          navWidget.innerHTML = navHtml.join('\n');

          navShadow.appendChild(navStyle);
          navShadow.appendChild(navWidget);
          var targetParent = window.document.body || window.document.documentElement;
          if (targetParent) targetParent.appendChild(navContainer);

          function handleNavigate() {
            var input = navWidget.querySelector('#nav-search-input') || (navShadow.querySelector ? navShadow.querySelector('#nav-search-input') : null);
            if (!input) return;
            var val = input.value.trim();
            if (!val) return;

            if (val.substr(0, 4) !== "http") {
              if (val.includes('.') && !val.includes(' ')) {
                val = "https://" + val;
              } else {
                val = "https://google.com/search?q=" + encodeURIComponent(val);
              }
            }
            window.location.href = window.location.protocol + '//' + window.location.host + '/proxy/' + val;
          }

          if (showNavSearch) {
            var goBtn = navWidget.querySelector('#nav-go-btn') || (navShadow.querySelector ? navShadow.querySelector('#nav-go-btn') : null);
            var searchInput = navWidget.querySelector('#nav-search-input') || (navShadow.querySelector ? navShadow.querySelector('#nav-search-input') : null);

            if (goBtn) goBtn.addEventListener('click', function (e) { e.stopPropagation(); handleNavigate(); });
            if (searchInput) searchInput.addEventListener('keydown', function (e) {
              e.stopPropagation();
              if (e.key === 'Enter') handleNavigate();
            });
          }

          if (showNavHome) {
            var homeBtn = navWidget.querySelector('#nav-home-btn') || (navShadow.querySelector ? navShadow.querySelector('#nav-home-btn') : null);
            if (homeBtn) homeBtn.addEventListener('click', function (e) {
              e.stopPropagation();
              window.location.href = 'https://heavenly-node.vercel.app/';
            });
          }

          attachWidgetBehaviors(navContainer, navWidget, 'heavenly_nav_pos', 120, 20);
        }
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
    var settings = loadHeavenlySettings(window);
    initHeavenlyCloakAndPanic(window, settings);
    initHeavenlyWidgets(window, settings);
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
