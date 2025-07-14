// Simple error capture that directly sends to extension
(function() {
  'use strict';
  
  // Prevent multiple injections
  if (window.__trapTrackerInjected) {
    // Capture script already injected, re-initializing...
    // Continue to re-initialize for refresh
  } else {
    window.__trapTrackerInjected = true;
  }
  
  // Capture script initialized
  
  // Helper to send errors
  function sendError(type, data) {
    const errorData = {
      ...data,
      type: type,
      url: window.location.href,
      pageUrl: window.location.href, // Add pageUrl for domain filtering
      timestamp: Date.now()
    };
    
    window.postMessage({
      source: 'trap-tracker',
      type: 'error-capture',
      data: errorData
    }, '*');
  }
  
  // Detect framework
  function detectFramework() {
    // Inertia.js
    if (window.Inertia || document.querySelector('[data-page]')) {
      return 'Inertia.js';
    }
    // Svelte
    if (window.__svelte || document.querySelector('[data-svelte]')) {
      return 'Svelte';
    }
    // Vue
    if (window.Vue || window.__VUE__) {
      return 'Vue.js';
    }
    // React
    if (window.React || window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
      return 'React';
    }
    // Laravel
    if (document.querySelector('meta[name="csrf-token"]')) {
      return 'Laravel';
    }
    return 'Unknown';
  }
  
  // 1. Window errors
  window.addEventListener('error', (event) => {
    sendError('javascript', {
      message: event.message,
      filename: event.filename,
      line: event.lineno,
      column: event.colno,
      stack: event.error?.stack
    });
  });
  
  // 2. Promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    sendError('promise', {
      reason: String(event.reason),
      stack: event.reason?.stack
    });
  });
  
  // 3. Console capture
  ['error', 'warn'].forEach(method => {
    const original = console[method];
    console[method] = function(...args) {
      sendError('console', {
        method: method,
        message: args.map(arg => {
          try {
            return typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
          } catch {
            return String(arg);
          }
        }).join(' ')
      });
      return original.apply(console, args);
    };
  });
  
  // 4. Network errors (enhanced)
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const startTime = performance.now();
    const [url, options = {}] = args;
    
    try {
      const response = await originalFetch.apply(this, args);
      const duration = performance.now() - startTime;
      
      if (!response.ok) {
        // Clone response to read body
        const clonedResponse = response.clone();
        let responseBody = null;
        
        try {
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            responseBody = await clonedResponse.json();
          } else {
            responseBody = await clonedResponse.text();
          }
        } catch (e) {
          responseBody = 'Could not parse response body';
        }
        
        sendError('network', {
          url: typeof url === 'string' ? url : url.toString(),
          method: options.method || 'GET',
          status: response.status,
          statusText: response.statusText,
          duration: Math.round(duration),
          headers: {
            request: options.headers || {},
            response: Object.fromEntries(response.headers.entries())
          },
          responseBody: responseBody,
          // Framework detection
          framework: detectFramework(),
          // Stack trace to see where the request originated
          stack: new Error().stack
        });
      }
      return response;
    } catch (error) {
      sendError('network_failure', {
        url: typeof url === 'string' ? url : url.toString(),
        method: options.method || 'GET',
        error: error.message,
        duration: Math.round(performance.now() - startTime),
        // Network failure details
        type: error.name,
        code: error.code,
        stack: error.stack
      });
      throw error;
    }
  };

  // 5. XHR errors
  const XHROpen = XMLHttpRequest.prototype.open;
  const XHRSend = XMLHttpRequest.prototype.send;
  
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._trapTracker = { method, url };
    return XHROpen.apply(this, [method, url, ...rest]);
  };
  
  XMLHttpRequest.prototype.send = function(data) {
    this.addEventListener('load', function() {
      if (this.status >= 400) {
        sendError('xhr', {
          url: this._trapTracker.url,
          status: this.status,
          statusText: this.statusText,
          method: this._trapTracker.method
        });
      }
    });
    
    this.addEventListener('error', function() {
      sendError('xhr_failure', {
        url: this._trapTracker.url,
        method: this._trapTracker.method,
        error: 'Network request failed'
      });
    });
    
    return XHRSend.apply(this, [data]);
  };

  // 6. Resource loading errors
  document.addEventListener('error', (event) => {
    if (event.target !== document && event.target.tagName) {
      const target = event.target;
      sendError('resource', {
        tagName: target.tagName,
        src: target.src || target.href,
        message: 'Failed to load resource',
        type: target.type || 'unknown',
        // Additional context
        id: target.id || null,
        className: target.className || null,
        dataset: target.dataset ? Object.assign({}, target.dataset) : {},
        attributes: {
          alt: target.alt,
          title: target.title,
          rel: target.rel
        },
        // Parent information
        parentElement: target.parentElement ? {
          tagName: target.parentElement.tagName,
          className: target.parentElement.className,
          id: target.parentElement.id
        } : null,
        // Page context
        pageTitle: document.title,
        referrer: document.referrer
      });
    }
  }, true);

  // Store if Laravel error already detected to avoid duplicates
  let laravelErrorDetected = false;
  
  // 7. Vite/Compiler Error Detection
  function detectCompilerErrors() {
    // Vite error overlay
    const viteErrorOverlay = document.querySelector('vite-error-overlay');
    if (viteErrorOverlay && viteErrorOverlay.shadowRoot) {
      const errorContent = viteErrorOverlay.shadowRoot.querySelector('.message-body');
      if (errorContent) {
        const errorText = errorContent.textContent || errorContent.innerText;
        sendError('compiler_error', {
          type: 'Vite Build Error',
          message: errorText,
          framework: 'Vite',
          source: 'error-overlay'
        });
      }
    }
    
    // Look for error messages in the DOM (Laravel/Inertia errors)
    const errorContainers = [
      // Pre elements that might contain errors
      ...document.querySelectorAll('pre'),
      // Laravel error pages
      document.querySelector('.exception-message'),
      document.querySelector('.error-message'),
      // Generic error containers
      document.querySelector('[data-error]'),
      document.querySelector('.error-container'),
      document.querySelector('#error-message')
    ].filter(Boolean);
    
    errorContainers.forEach(container => {
      if (container && container.textContent) {
        const errorText = container.textContent.trim();
        
        // Parse Svelte compiler errors
        if (errorText.includes('[plugin:vite-plugin-svelte]')) {
          const lines = errorText.split('\n');
          const pluginMatch = errorText.match(/\[plugin:(.*?)\]/);
          const fileMatch = errorText.match(/([\w\/\.\-]+\.svelte):(\d+):(\d+)/);
          const messageMatch = lines.find(line => line.includes('`') || line.includes('attempted to'));
          
          sendError('compiler_error', {
            type: 'Svelte Compiler Error',
            plugin: pluginMatch ? pluginMatch[1] : 'vite-plugin-svelte',
            file: fileMatch ? fileMatch[1] : 'unknown',
            line: fileMatch ? parseInt(fileMatch[2]) : null,
            column: fileMatch ? parseInt(fileMatch[3]) : null,
            message: messageMatch || errorText,
            fullError: errorText,
            framework: 'Svelte',
            source: 'dom-detection'
          });
        }
        // Laravel/PHP errors
        else if (errorText.includes('Exception') || errorText.includes('Error')) {
          // Clean up the message for ViewErrorBag
          let cleanMessage = errorText;
          
          if (errorText.includes('ViewErrorBag')) {
            // Extract just the essential info
            cleanMessage = 'Laravel ViewErrorBag detected (validation/error data passed to view)';
            
            // Try to extract any specific error messages
            const bagMatch = errorText.match(/#bags:\s*\[(.*?)\]/);
            if (bagMatch && bagMatch[1].trim()) {
              cleanMessage += ' - Bags: ' + bagMatch[1];
            }
          } else {
            // For other errors, clean up whitespace and limit length
            cleanMessage = errorText
              .replace(/\s+/g, ' ') // Replace multiple spaces/newlines with single space
              .replace(/[▼▲]/g, '') // Remove arrow symbols
              .trim()
              .substring(0, 200); // Limit length
          }
          
          sendError('server_error', {
            type: 'Server Error',
            message: cleanMessage,
            framework: detectFramework(),
            source: 'dom-detection'
          });
        }
      }
    });
  }
  
  // 8. DOM Mutation Observer for dynamic errors
  const observer = new MutationObserver((mutations) => {
    // Debounce to avoid too many checks
    clearTimeout(window.__trapTrackerDebounce);
    window.__trapTrackerDebounce = setTimeout(() => {
      detectCompilerErrors();
    }, 500);
  });
  
  // Start observing when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      detectCompilerErrors();
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });
    });
  } else {
    detectCompilerErrors();
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }
  
  // Also check periodically for Vite overlay
  setInterval(() => {
    const viteOverlay = document.querySelector('vite-error-overlay');
    if (viteOverlay && !viteOverlay.__trapTrackerProcessed) {
      viteOverlay.__trapTrackerProcessed = true;
      detectCompilerErrors();
    }
  }, 1000);
  
  // 9. Detect initial page load errors
  function detectPageLoadError() {
    // Check if current page is an error page
    const pageTitle = document.title.toLowerCase();
    const bodyText = document.body?.innerText || '';
    
    // Laravel Ignition Error Detection (Priority)
    // Check for ACTUAL Ignition error indicators
    const hasIgnition = document.querySelector('[data-v-inspector]') || 
                       document.querySelector('.bg-red-500.text-white') ||
                       document.querySelector('vite-error-overlay') ||
                       (bodyText && bodyText.includes('Ignition') && bodyText.includes('Exception'));
    
    // Also check if page title contains error keywords
    const isErrorPage = pageTitle.includes('exception') || 
                       pageTitle.includes('error') ||
                       pageTitle.includes('whoops') ||
                       pageTitle.includes('500');
    
    if (hasIgnition && isErrorPage) {
      // Laravel Ignition error page detected
      
      // Extract exception information from various possible locations
      let exceptionClass = 'Laravel Exception';
      let errorMessage = '';
      let errorFile = '';
      let errorLine = '';
      
      // Try to find exception class (like ErrorException)
      const possibleExceptionElements = [
        document.querySelector('h1'),
        document.querySelector('.text-2xl'),
        document.querySelector('.font-semibold'),
        ...document.querySelectorAll('*')
      ].filter(el => el && el.textContent && el.textContent.includes('Exception'));
      
      if (possibleExceptionElements.length > 0) {
        exceptionClass = possibleExceptionElements[0].textContent.trim();
      }
      
      // Find error message (like "Undefined variable $produks")
      const messagePatterns = [
        /Undefined variable\s+\$?\w+/,
        /Undefined array key\s+["']?\w+["']?/,
        /Call to undefined\s+\w+/,
        /Class\s+[\w\\]+\s+not found/,
        /syntax error[^<]*/i,
        /Attempt to read property\s+["']?\w+["']?\s+on\s+\w+/
      ];
      
      for (const pattern of messagePatterns) {
        const match = bodyText.match(pattern);
        if (match) {
          errorMessage = match[0].trim();
          break;
        }
      }
      
      // If no specific message found, try generic extraction
      if (!errorMessage) {
        const possibleMessages = document.querySelectorAll('.text-gray-700, .text-gray-600, .text-sm');
        for (const el of possibleMessages) {
          if (el.textContent && el.textContent.length > 10 && el.textContent.length < 200) {
            errorMessage = el.textContent.trim();
            break;
          }
        }
      }
      
      // Extract file path (Windows or Unix format)
      const filePattern = /([A-Z]:\\[^:\s]+\.php):\s*(\d+)|(\/.+\.php):\s*(\d+)/;
      const fileMatch = bodyText.match(filePattern);
      if (fileMatch) {
        errorFile = fileMatch[0].replace(/\s+/g, '');
      }
      
      // Extract the problematic code line
      const codeElement = document.querySelector('.bg-red-500.text-white');
      if (codeElement) {
        errorLine = codeElement.textContent.trim();
      }
      
      // Clean up the exception class to remove extra text
      if (exceptionClass.includes('Exception')) {
        const exceptionMatch = exceptionClass.match(/(\w+Exception)/);
        if (exceptionMatch) {
          exceptionClass = exceptionMatch[1];
        }
      }
      
      let errorDetails = {
        type: 'laravel_exception',
        status: 500,
        exceptionClass: exceptionClass,
        message: errorMessage || 'Laravel Error',
        file: errorFile,
        errorLine: errorLine ? errorLine.substring(0, 100) : '', // Limit length
        url: window.location.href.split('#')[0], // Remove #stack fragment
        pageTitle: document.title,
        framework: 'Laravel',
        source: 'ignition-error-page'
      };
      
      // Try to get stack trace
      const stackElements = document.querySelectorAll('.hover\\:bg-gray-100, .cursor-pointer');
      if (stackElements.length > 0) {
        errorDetails.stackFrames = Array.from(stackElements).slice(0, 5).map(el => {
          const text = el.textContent || '';
          return { 
            file: text.includes('.php') ? text : '', 
            method: ''
          };
        }).filter(frame => frame.file);
      }
      
      sendError('laravel_exception', errorDetails);
      laravelErrorDetected = true; // Mark as detected to avoid duplicates
      return; // Exit early if Laravel error detected
    }
    
    // Common patterns for error pages (skip if Laravel already detected)
    if (!laravelErrorDetected && (
        pageTitle.includes('500') || 
        pageTitle.includes('internal server error') ||
        bodyText.includes('500 Internal Server Error') ||
        bodyText.includes('500 Server Error') ||
        pageTitle.includes('errorexception') ||
        bodyText.includes('ErrorException'))) {
      
      // Look for error details in the page
      let errorMessage = '500 Internal Server Error';
      
      // Try to extract more specific error message
      const h1 = document.querySelector('h1');
      if (h1 && h1.textContent) {
        errorMessage = h1.textContent.trim();
      }
      
      // Check for Laravel/Symfony error pages
      const exceptionMessage = document.querySelector('.exception-message, .exception_message');
      if (exceptionMessage) {
        errorMessage = exceptionMessage.textContent.trim();
      }
      
      sendError('server_error', {
        type: 'Page Load Error',
        status: 500,
        message: errorMessage,
        url: window.location.href,
        pageTitle: document.title,
        framework: detectFramework(),
        source: 'page-load'
      });
    }
    
    // Also check for other HTTP error pages (404, 403, etc)
    const errorPatterns = [
      { pattern: /404/, status: 404, message: '404 Not Found' },
      { pattern: /403/, status: 403, message: '403 Forbidden' },
      { pattern: /401/, status: 401, message: '401 Unauthorized' },
      { pattern: /502/, status: 502, message: '502 Bad Gateway' },
      { pattern: /503/, status: 503, message: '503 Service Unavailable' }
    ];
    
    for (const error of errorPatterns) {
      if (error.pattern.test(pageTitle) || error.pattern.test(bodyText)) {
        sendError('server_error', {
          type: 'Page Load Error',
          status: error.status,
          message: error.message,
          url: window.location.href,
          pageTitle: document.title,
          framework: detectFramework(),
          source: 'page-load'
        });
        break;
      }
    }
  }
  
  // Run page load error detection on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      // Add delay for Ignition to fully render
      setTimeout(detectPageLoadError, 500);
    });
  } else {
    // If DOM already loaded, still wait a bit for dynamic content
    setTimeout(detectPageLoadError, 500);
  }
  
  // Listen for refresh event from extension
  window.addEventListener('traptracker-refresh', () => {
    // Refresh event received, re-detecting errors...
    
    // Re-detect all types of errors
    detectCompilerErrors();
    detectPageLoadError();
    
    // Check for any console errors that might have been logged
    if (window.__trapTrackerConsoleErrors && window.__trapTrackerConsoleErrors.length > 0) {
      // Re-sending stored console errors
      window.__trapTrackerConsoleErrors.forEach(error => {
        sendError('console', error);
      });
    }
    
    // Force check for Vite overlay
    const viteOverlay = document.querySelector('vite-error-overlay');
    if (viteOverlay) {
      viteOverlay.__trapTrackerProcessed = false;
      detectCompilerErrors();
    }
    
    // Check for Laravel/Ignition errors
    const ignitionContainer = document.querySelector('.container.mx-auto');
    if (ignitionContainer && ignitionContainer.textContent.includes('Exception')) {
      detectCompilerErrors();
    }
    
    // Actively scan DOM for error indicators
    const errorSelectors = [
      'vite-error-overlay',
      '.error-overlay',
      '.exception-message',
      '.exception_message',
      '[class*="error"]:not(script)',
      '[class*="exception"]',
      'pre:has-text("Error")',
      'pre:has-text("Exception")',
      '.stack-trace',
      '#laravel-error',
      '.ignition-container'
    ];
    
    errorSelectors.forEach(selector => {
      try {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          // Found elements matching selector
          elements.forEach(el => {
            if (el.textContent && el.textContent.length > 10) {
              // Extract error info
              const errorText = el.textContent.substring(0, 500);
              if (errorText.match(/error|exception|failed|cannot|undefined/i)) {
                sendError('dom_error', {
                  message: errorText.substring(0, 200),
                  selector: selector,
                  fullText: errorText
                });
              }
            }
          });
        }
      } catch (e) {
        // Invalid selector, skip
      }
    });
    
    // If no errors found, send a status message
    // Refresh scan complete
  });
  
  // Store console errors for refresh
  if (!window.__trapTrackerConsoleErrors) {
    window.__trapTrackerConsoleErrors = [];
  }
  
  // Override console methods to store errors
  const originalError = console.error;
  console.error = function(...args) {
    window.__trapTrackerConsoleErrors.push({
      message: args.map(arg => String(arg)).join(' '),
      stack: new Error().stack,
      method: 'error',
      url: window.location.href,
      framework: detectFramework()
    });
    
    // Keep only last 50 errors
    if (window.__trapTrackerConsoleErrors.length > 50) {
      window.__trapTrackerConsoleErrors.shift();
    }
    
    originalError.apply(console, args);
  };
})();