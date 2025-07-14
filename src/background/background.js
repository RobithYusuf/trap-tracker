class ErrorAggregator {
  constructor() {
    this.errors = new Map();
    this.settings = {
      enabled: true,
      captureConsole: true,
      captureNetwork: true,
      filterNoise: true,
      aiProvider: 'chatgpt',
      autoClearMode: 'never',
      domainFilterMode: 'all',
      whitelistDomains: [],
      blacklistDomains: [],
      smartFilters: {
        filter403External: true,
        filterMediaStreaming: true,
        filterDuplicates: true
      }
    };
    this.autoClearIntervals = new Map();
    this.recentErrors = new Map(); // For duplicate detection
    this.initializeListeners();
    this.loadSettings();
  }
  
  initializeListeners() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('Background received message:', message.type, message);
      
      if (message.type === 'error_captured') {
        const tabId = sender.tab?.id;
        console.log('Error captured from tab:', tabId, message.error);
        if (tabId) {
          this.addError(tabId, message.error);
          this.notifyDevTools(tabId, message.error);
          sendResponse({ status: 'received' });
        } else {
          console.error('No tab ID found in sender:', sender);
          sendResponse({ status: 'error', message: 'No tab ID' });
        }
        return true;
      } else if (message.type === 'get_tab_errors') {
        const tabId = message.tabId || sender.tab?.id;
        const errors = tabId ? (this.errors.get(tabId) || []) : [];
        console.log('Sending errors for tab:', tabId, errors);
        sendResponse({ errors: errors });
        return true;
      } else if (message.type === 'clear_errors') {
        const tabId = message.tabId || sender.tab?.id;
        if (tabId) {
          this.errors.delete(tabId);
          this.updateBadge(tabId);
          console.log('Errors cleared for tab:', tabId);
          sendResponse({ status: 'cleared' });
        }
        return true;
      } else if (message.type === 'send_to_ai') {
        this.sendToAI(message.errors, message.context);
      } else if (message.type === 'execute_shortcut') {
        this.executeShortcut(message.action, sender.tab);
      } else if (message.type === 'refresh_errors') {
        const tabId = message.tabId || sender.tab?.id;
        if (tabId) {
          this.refreshErrors(tabId);
          sendResponse({ status: 'refreshing' });
        }
        return true;
      } else if (message.type === 'settings_updated') {
        this.settings = { ...this.settings, ...message.settings };
        this.updateAutoClear();
        sendResponse({ status: 'settings_applied' });
      }
    });
    
    chrome.webRequest.onCompleted.addListener(
      (details) => {
        if (details.statusCode >= 400) {
          // Skip if it's from an extension
          if (details.url.startsWith('chrome-extension://')) return;
          
          this.addError(details.tabId, {
            type: 'network_error_background',
            url: details.url,
            status: details.statusCode,
            method: details.method,
            timestamp: Date.now()
          });
          
          // Immediately update badge for better visibility
          this.updateBadge(details.tabId);
        }
      },
      { urls: ["<all_urls>"] },
      ["responseHeaders"]
    );
    
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.errors.delete(tabId);
      this.clearAutoClearInterval(tabId);
    });
    
    // Update badge when tab is activated
    chrome.tabs.onActivated.addListener((activeInfo) => {
      this.updateBadge(activeInfo.tabId);
    });
    
    // Listen for tab navigation to clear errors if auto-clear on refresh is enabled
    chrome.webNavigation.onCommitted.addListener((details) => {
      if (details.frameId === 0) { // Main frame only
        this.handleTabNavigation(details.tabId, details.transitionType);
      }
    });
    
    // Listen for browser keyboard shortcuts
    chrome.commands.onCommand.addListener((command) => {
      console.log('Command received:', command);
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (tabs[0]) {
          this.handleCommand(command, tabs[0]);
        }
      });
    });
  }
  
  addError(tabId, error) {
    if (!tabId) return;
    
    if (!this.errors.has(tabId)) {
      this.errors.set(tabId, []);
    }
    
    if (this.settings.filterNoise && this.isNoise(error)) {
      console.log('Filtered noise:', error);
      return;
    }
    
    const enrichedError = {
      ...error,
      id: this.generateErrorId(),
      tabId,
      grouped: this.findSimilarError(tabId, error)
    };
    
    this.errors.get(tabId).push(enrichedError);
    console.log('Error added for tab', tabId, ':', enrichedError);
    console.log('Total errors for tab:', this.errors.get(tabId).length);
    
    this.updateBadge(tabId);
    this.flashBadge(tabId); // Visual indicator
  }
  
  isNoise(error) {
    const noisePatterns = [
      /ERR_BLOCKED_BY_CLIENT/,
      /Extension context invalidated/,
      /ResizeObserver loop limit/,
      /Non-Error promise rejection captured/,
      /\[vite\] connecting/,
      /\[vite\] connected/,
      /\[TrapTracker\] Test error - capture system is working/ // Our own test errors
    ];
    
    // Skip debug console messages
    if (error.type === 'console' && error.method === 'debug') {
      return true;
    }
    
    // Apply domain filtering
    if (this.isDomainFiltered(error)) {
      return true;
    }
    
    // Apply smart filters
    if (this.isSmartFiltered(error)) {
      return true;
    }
    
    const errorString = JSON.stringify(error);
    return noisePatterns.some(pattern => pattern.test(errorString));
  }
  
  isDomainFiltered(error) {
    const url = error.url || '';
    if (!url) return false;
    
    let hostname;
    try {
      hostname = new URL(url).hostname;
    } catch (e) {
      return false;
    }
    
    // Apply mode-based filtering
    switch (this.settings.domainFilterMode) {
      case 'all':
        // No domain filtering in 'all' mode
        return false;
        
      case 'development':
        // Only allow development domains
        const devPatterns = [
          /^localhost$/,
          /^127\.0\.0\.1$/,
          /^\[::1\]$/,
          /^\[::1\]$/,
          /^192\.168\./,
          /^10\./,
          /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
          /\.local$/,
          /\.localhost$/,
          /\.test$/,
          /\.dev$/,
          /\.development$/
        ];
        
        // Check if URL includes common dev ports
        const devPorts = [
          // React/Node.js ports
          3000, // React, Next.js, Express
          3001, // React (alternate)
          3002, // Node alternatives
          3003, 3004, 3005, // More alternatives
          3333, // NestJS
          
          // API & Backend ports
          4000, // Phoenix, some APIs
          4001, 4002, // API alternatives
          4200, // Angular
          4321, // Astro
          
          // Python/Flask/FastAPI
          5000, // Flask, some APIs
          5001, 5002, 5003, // Flask alternatives
          5173, // Vite
          5174, // Vite (alternate)
          5432, // PostgreSQL web interface
          5500, // Live Server
          5501, // Live Server (alternate)
          5555, // ADB, custom
          5556, // Custom
          
          // Other frameworks
          6006, // Storybook
          6379, // Redis web interface
          7000, // Custom servers
          7001, 7002, // Alternatives
          
          // PHP/Laravel/Django
          8000, // Django, Laravel artisan
          8001, // Laravel alternate, Django
          8002, 8003, 8004, 8005, // Custom dev servers
          8006, 8007, 8008, 8009, 8010, // More alternatives
          8025, // MailHog
          8080, // Common web servers
          8081, // Alternate web servers
          8082, 8083, 8084, 8085, // More alternatives
          8086, 8087, 8088, 8089, // Even more
          8100, // Ionic
          8200, // Vault
          8300, // Consul
          8400, 8500, // Custom microservices
          8800, // Custom
          8888, // Jupyter, custom servers
          
          // High ports
          9000, // PHP built-in server
          9001, 9002, 9003, 9004, 9005, // PHP alternatives
          9090, // Custom APIs
          9200, // Elasticsearch
          9999, // Common test port
          10000, // Custom high ports
          
          // Expo (React Native)
          19000, 19001, 19002, // Expo
          19003, 19004, 19005, 19006 // Expo alternatives
        ];
        const urlPort = new URL(url).port;
        const hasDevPort = devPorts.includes(parseInt(urlPort));
        
        const isDevDomain = devPatterns.some(pattern => pattern.test(hostname)) || hasDevPort;
        return !isDevDomain; // Filter if NOT a dev domain
        
      case 'custom':
        // Check whitelist first (if set)
        if (this.settings.whitelistDomains && this.settings.whitelistDomains.length > 0) {
          const isWhitelisted = this.settings.whitelistDomains.some(domain => {
            if (domain.includes('*')) {
              // Convert wildcard to regex
              const regex = new RegExp('^' + domain.replace(/\*/g, '.*') + '$');
              return regex.test(hostname);
            }
            return hostname === domain || hostname.endsWith('.' + domain);
          });
          
          if (!isWhitelisted) return true; // Filter if not whitelisted
        }
        
        // Then check blacklist
        if (this.settings.blacklistDomains && this.settings.blacklistDomains.length > 0) {
          const isBlacklisted = this.settings.blacklistDomains.some(domain => {
            if (domain.includes('*')) {
              // Convert wildcard to regex
              const regex = new RegExp('^' + domain.replace(/\*/g, '.*') + '$');
              return regex.test(hostname);
            }
            return hostname === domain || hostname.endsWith('.' + domain);
          });
          
          if (isBlacklisted) return true; // Filter if blacklisted
        }
        
        return false;
        
      default:
        return false;
    }
  }
  
  isSmartFiltered(error) {
    if (!this.settings.smartFilters) return false;
    
    const url = error.url || '';
    
    // Filter 403 errors from external domains
    if (this.settings.smartFilters.filter403External && 
        error.status === 403) {
      // Check if it's an external domain
      try {
        const errorHost = new URL(url).hostname;
        const currentHost = error.pageUrl ? new URL(error.pageUrl).hostname : '';
        if (errorHost !== currentHost && !errorHost.includes('localhost') && !errorHost.includes('127.0.0.1')) {
          return true;
        }
      } catch (e) {
        // Invalid URL, let it through
      }
    }
    
    // Filter media streaming errors
    if (this.settings.smartFilters.filterMediaStreaming) {
      const mediaPatterns = [
        /\/videoplayback/,
        /\/stream\//,
        /\.m3u8/,
        /\.mp4/,
        /\.webm/,
        /\.mp3/,
        /googlevideo\.com/,
        /youtube-nocookie\.com/,
        /ytimg\.com/,
        /\/media\//,
        /\/audio\//,
        /\/video\//
      ];
      
      if (mediaPatterns.some(pattern => pattern.test(url))) {
        return true;
      }
    }
    
    // Filter duplicate errors
    if (this.settings.smartFilters.filterDuplicates) {
      const errorKey = `${error.type}_${error.message}_${error.url}`;
      const now = Date.now();
      
      // Check if we've seen this error recently (within 5 seconds)
      if (this.recentErrors.has(errorKey)) {
        const lastSeen = this.recentErrors.get(errorKey);
        if (now - lastSeen < 5000) {
          return true; // Filter duplicate
        }
      }
      
      // Store this error occurrence
      this.recentErrors.set(errorKey, now);
      
      // Clean up old entries (older than 10 seconds)
      if (this.recentErrors.size > 100) {
        const cutoff = now - 10000;
        for (const [key, time] of this.recentErrors.entries()) {
          if (time < cutoff) {
            this.recentErrors.delete(key);
          }
        }
      }
    }
    
    return false;
  }
  
  findSimilarError(tabId, error) {
    const tabErrors = this.errors.get(tabId) || [];
    return tabErrors.find(e => 
      e.type === error.type && 
      e.message === error.message &&
      e.filename === error.filename
    )?.id;
  }
  
  async sendToAI(errors, context) {
    const prompt = this.buildAIPrompt(errors, context);
    
    if (this.settings.aiProvider === 'chatgpt') {
      const chatGPTUrl = `https://chat.openai.com/?q=${encodeURIComponent(prompt)}`;
      chrome.tabs.create({ url: chatGPTUrl });
    }
  }
  
  buildAIPrompt(errors, context) {
    return `I'm encountering these errors (traps) in my ${context.framework || 'web'} application:

${errors.map(e => `
Error Type: ${e.type}
Message: ${e.message || 'N/A'}
URL: ${e.url || 'N/A'}
Stack: ${e.stack || 'N/A'}
`).join('\n---\n')}

Context:
- Page URL: ${context.url}
- Framework: ${context.framework}
- Browser: Chrome
- Captured by: TrapTracker Extension

Please help me understand and fix these errors.`;
  }
  
  updateBadge(tabId) {
    const errorCount = this.errors.get(tabId)?.length || 0;
    
    // Update badge for specific tab
    chrome.action.setBadgeText({
      text: errorCount > 0 ? String(errorCount) : '',
      tabId: tabId
    });
    
    // Set badge color for specific tab
    chrome.action.setBadgeBackgroundColor({
      color: '#FF0000',
      tabId: tabId
    });
    
    // Also update badge when viewing this tab
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (tabs[0] && tabs[0].id === tabId) {
        // Force update for current tab
        chrome.action.setBadgeText({
          text: errorCount > 0 ? String(errorCount) : ''
        });
        chrome.action.setBadgeBackgroundColor({
          color: '#FF0000'
        });
      }
    });
  }
  
  flashBadge(tabId) {
    // Flash the badge with a different color to indicate new error
    chrome.action.setBadgeBackgroundColor({
      color: '#FFA500', // Orange flash
      tabId
    });
    
    // Return to red after 500ms
    setTimeout(() => {
      chrome.action.setBadgeBackgroundColor({
        color: '#FF0000',
        tabId
      });
    }, 500);
  }
  
  generateErrorId() {
    return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  notifyDevTools(tabId, error) {
    chrome.runtime.sendMessage({
      type: 'devtools_update',
      tabId,
      error
    });
  }
  
  executeShortcut(action, tab) {
    console.log('Executing shortcut:', action);
    
    switch(action) {
      case 'refresh':
        // Refresh current tab errors
        if (tab && tab.id) {
          this.refreshErrors(tab.id);
        } else {
          this.showNotification('No active tab to refresh', 'warning');
        }
        break;
        
      case 'copy':
        // Get errors and copy to clipboard
        const errors = this.errors.get(tab.id) || [];
        if (errors.length > 0) {
          // Copy directly in background
          this.copyErrorsToClipboard(errors, tab);
        } else {
          this.showNotification('No errors to copy!', 'warning');
        }
        break;
        
      case 'clear':
        // Clear errors for current tab
        console.log('Clearing errors for tab:', tab.id);
        this.errors.delete(tab.id);
        this.updateBadge(tab.id);
        chrome.runtime.sendMessage({ type: 'errors_cleared' });
        // Silent notification
        console.log('Showing clear notification');
        this.showNotification('Errors cleared!', 'success');
        break;
        
      case 'devtools':
        // Open DevTools - this needs to be done from devtools.js
        chrome.runtime.sendMessage({ type: 'open_devtools' });
        break;
    }
  }
  
  handleCommand(command, tab) {
    console.log('Handling command:', command);
    
    switch(command) {
      case 'refresh-errors':
        // Refresh without reloading page
        this.refreshErrors(tab.id);
        break;
        
      case 'copy-errors':
        const errors = this.errors.get(tab.id) || [];
        if (errors.length > 0) {
          this.copyErrorsToClipboard(errors, tab);
        } else {
          this.showNotification('No errors to copy!', 'warning');
        }
        break;
        
      case 'clear-errors':
        this.errors.delete(tab.id);
        this.updateBadge(tab.id);
        this.showNotification('Errors cleared!', 'success');
        break;
    }
  }
  
  async refreshErrors(tabId) {
    console.log('Refreshing errors for tab:', tabId);
    
    try {
      // Check if tab is valid first
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab) {
        console.log('Tab not found');
        return;
      }
      
      // Skip special URLs where we can't inject
      if (tab.url && (
        tab.url.startsWith('chrome://') ||
        tab.url.startsWith('chrome-extension://') ||
        tab.url.startsWith('edge://') ||
        tab.url.startsWith('about:') ||
        tab.url.startsWith('file://') && !tab.url.endsWith('.html')
      )) {
        console.log('Cannot inject on special page:', tab.url);
        this.showNotification('Cannot detect errors on this page type', 'info');
        return;
      }
      
      // First, re-inject the capture script to ensure it's active
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['src/injected/trap-tracker-capture.js'],
        world: 'MAIN'
      });
      
      // Send a message to the tab to verify capture is active
      chrome.tabs.sendMessage(tabId, { type: 'verify_capture_active' }, (response) => {
        if (chrome.runtime.lastError) {
          // This is normal - content script might not be injected yet
          console.log('Content script not ready, re-injecting...', chrome.runtime.lastError.message);
          
          // Try to re-inject content script if needed
          chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['src/content/trap-tracker-content.js']
          }).then(() => {
            console.log('Content script re-injected successfully');
            // Try to inject capture script again after content script is ready
            setTimeout(() => {
              chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['src/injected/trap-tracker-capture.js'],
                world: 'MAIN'
              }).catch(err => {
                // Ignore - might be a special page
                console.log('Cannot inject on this page type');
              });
            }, 100);
          }).catch(err => {
            // This is also normal for special pages (chrome://, extensions, etc)
            console.log('Cannot inject scripts on this page type:', err.message);
          });
        } else {
          console.log('Capture verification response:', response);
        }
      });
      
      // Trigger any existing errors to be re-captured
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: () => {
          // Dispatch a custom event to trigger error re-detection
          window.dispatchEvent(new CustomEvent('traptracker-refresh'));
          
          // Force check all possible error sources
          console.log('[TrapTracker] Actively scanning for errors...');
          
          // 1. Check for Vite error overlay
          const viteError = document.querySelector('vite-error-overlay');
          if (viteError) {
            console.log('[TrapTracker] Found Vite error overlay');
            const event = new Event('click');
            viteError.dispatchEvent(event);
          }
          
          // 2. Check for any error text in the page
          const errorKeywords = ['Error', 'Exception', 'Failed', 'Cannot', 'Undefined', 'Uncaught'];
          const allTextNodes = document.evaluate(
            "//text()[normalize-space(.) != '']",
            document.body,
            null,
            XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE,
            null
          );
          
          for (let i = 0; i < allTextNodes.snapshotLength; i++) {
            const node = allTextNodes.snapshotItem(i);
            const text = node.textContent;
            if (errorKeywords.some(keyword => text.includes(keyword))) {
              const parent = node.parentElement;
              if (parent && (parent.tagName === 'PRE' || parent.className.includes('error'))) {
                console.log('[TrapTracker] Found potential error text:', text.substring(0, 100));
              }
            }
          }
          
          // 3. Check for Laravel/Ignition errors
          const laravelError = document.querySelector('.exception-message, .exception_message, [class*="exception"]');
          if (laravelError) {
            console.log('[TrapTracker] Found Laravel exception');
          }
          
          // 4. Trigger a test error to verify capture is working
          try {
            // This will be caught by our error handler
            throw new Error('[TrapTracker] Test error - capture system is working');
          } catch (e) {
            // Silently catch - this is just to test the system
          }
          
          // 5. Check console errors stored in memory
          if (window.__trapTrackerConsoleErrors && window.__trapTrackerConsoleErrors.length > 0) {
            console.log('[TrapTracker] Found', window.__trapTrackerConsoleErrors.length, 'stored console errors');
          }
        }
      });
      
      // Update UI with silent notification
      const errors = this.errors.get(tabId) || [];
      if (errors.length > 0) {
        this.showNotification(`Detected ${errors.length} errors!`, 'success');
      } else {
        this.showNotification('Error detection refreshed!', 'info');
      }
      
      chrome.runtime.sendMessage({ type: 'refresh_complete', tabId: tabId });
      
    } catch (error) {
      console.error('Error during refresh:', error);
    }
  }
  
  async copyErrorsToClipboard(errors, tab) {
    console.log('Copying errors to clipboard:', errors.length);
    const formattedErrors = this.formatErrorsForClipboard(errors, tab.url);
    
    // Check if tab is valid
    if (!tab || !tab.id) {
      console.error('Invalid tab for copy');
      this.showNotification('Cannot copy - invalid tab', 'error');
      return;
    }
    
    // Use offscreen document API for clipboard access
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (textToCopy) => {
          const textarea = document.createElement('textarea');
          textarea.value = textToCopy;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
          return true;
        },
        args: [formattedErrors]
      });
      
      console.log('Copy successful, showing notification');
      this.showNotification(`Copied ${errors.length} errors!`, 'success');
    } catch (err) {
      console.error('Failed to copy:', err);
      // Check if it's a special page
      if (err.message && err.message.includes('Cannot access')) {
        this.showNotification('Cannot copy on this page type', 'warning');
      } else {
        this.showNotification('Failed to copy errors', 'error');
      }
    }
  }
  
  formatErrorsForClipboard(errors, pageUrl) {
    let output = `🪤 TrapTracker Error Report\n`;
    output += `================================\n`;
    output += `Page URL: ${pageUrl}\n`;
    output += `Time: ${new Date().toLocaleString()}\n`;
    output += `Total Errors: ${errors.length}\n`;
    output += `================================\n\n`;

    errors.forEach((error, index) => {
      output += `Error #${index + 1}\n`;
      output += `---------\n`;
      output += `Type: ${this.formatErrorType(error.type)}\n`;
      
      // Laravel Exception specific formatting
      if (error.type === 'laravel_exception') {
        if (error.exceptionClass) output += `Exception: ${error.exceptionClass}\n`;
        if (error.message) output += `Message: ${error.message}\n`;
        if (error.file) output += `File: ${error.file}\n`;
        if (error.errorLine) output += `Error Line: ${error.errorLine}\n`;
        if (error.lineNumber) output += `Line Number: ${error.lineNumber}\n`;
        if (error.stackFrames) {
          output += `\nStack Trace:\n`;
          error.stackFrames.forEach((frame, i) => {
            output += `  ${i + 1}. ${frame.method}\n`;
            output += `     ${frame.file}\n`;
          });
        }
      } else {
        // Standard error formatting
        if (error.message) output += `Message: ${error.message}\n`;
        if (error.reason) output += `Reason: ${error.reason}\n`;
        if (error.url) {
          // Clean URL by removing fragment
          const cleanUrl = error.url.split('#')[0];
          output += `URL: ${cleanUrl}\n`;
        }
        if (error.method) output += `Method: ${error.method}\n`;
        if (error.status) output += `Status: ${error.status} ${error.statusText || ''}\n`;
        if (error.duration) output += `Duration: ${error.duration}ms\n`;
        if (error.filename) output += `File: ${error.filename}\n`;
        if (error.line) output += `Location: Line ${error.line}, Column ${error.column}\n`;
        if (error.tagName) output += `Element: <${error.tagName}${error.className ? ` class="${error.className}"` : ''}${error.id ? ` id="${error.id}"` : ''}>\n`;
        if (error.src) output += `Source: ${error.src}\n`;
        if (error.parentElement) output += `Parent: <${error.parentElement.tagName}${error.parentElement.className ? ` class="${error.parentElement.className}"` : ''}>\n`;
        if (error.responseBody) output += `\nResponse Body:\n${typeof error.responseBody === 'object' ? JSON.stringify(error.responseBody, null, 2) : error.responseBody}\n`;
        if (error.headers && error.headers.response) output += `\nResponse Headers:\n${JSON.stringify(error.headers.response, null, 2)}\n`;
        if (error.stack) output += `\nStack Trace:\n${error.stack}\n`;
      }
      
      if (error.framework) output += `Framework: ${error.framework}\n`;
      output += `\n`;
    });

    return output;
  }
  
  formatErrorType(type) {
    const typeMap = {
      'error': 'JavaScript Error',
      'javascript': 'JavaScript Error',
      'laravel_exception': 'Laravel Exception',
      'console': 'Console Message',
      'network': 'Network Error',
      'network_error_background': 'Network Error',
      'network_failure': 'Network Failure',
      'xhr': 'XHR Error',
      'xhr_failure': 'XHR Failure',
      'promise': 'Promise Rejection',
      'resource': 'Resource Error',
      'resource_blocked': 'Resource Blocked',
      'compiler_error': 'Compiler Error',
      'server_error': 'Server Error',
      'dom_error': 'DOM Error'
    };
    
    return typeMap[type] || type;
  }
  
  showNotification(message, type = 'info') {
    console.log('Creating notification:', message, type);
    // Create chrome notification
    const notificationId = `trap-${Date.now()}`;
    chrome.notifications.create(notificationId, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('assets/icons/icon48.png'),
      title: 'TrapTracker',
      message: message,
      silent: true,  // Tidak ada bunyi
      requireInteraction: false,  // Auto dismiss
      priority: 0  // Low priority untuk cepat hilang
    }, (notifId) => {
      if (chrome.runtime.lastError) {
        console.error('Notification error:', chrome.runtime.lastError);
      } else {
        console.log('Notification created:', notifId);
      }
    });
    
    // Auto clear notification setelah 2 detik
    setTimeout(() => {
      chrome.notifications.clear(notificationId);
    }, 2000);
  }
  
  loadSettings() {
    chrome.storage.sync.get([
      'filterNoise', 
      'autoClearMode', 
      'domainFilterMode',
      'whitelistDomains',
      'blacklistDomains',
      'smartFilters'
    ], (data) => {
      if (data.filterNoise !== undefined) {
        this.settings.filterNoise = data.filterNoise;
      }
      if (data.autoClearMode !== undefined) {
        this.settings.autoClearMode = data.autoClearMode;
        this.updateAutoClear();
      }
      if (data.domainFilterMode !== undefined) {
        this.settings.domainFilterMode = data.domainFilterMode;
      }
      if (data.whitelistDomains !== undefined) {
        this.settings.whitelistDomains = data.whitelistDomains;
      }
      if (data.blacklistDomains !== undefined) {
        this.settings.blacklistDomains = data.blacklistDomains;
      }
      if (data.smartFilters !== undefined) {
        this.settings.smartFilters = data.smartFilters;
      }
    });
  }
  
  handleTabNavigation(tabId, transitionType) {
    // Clear errors on refresh if auto-clear is set to 'refresh'
    if (this.settings.autoClearMode === 'refresh' && 
        (transitionType === 'reload' || transitionType === 'link')) {
      console.log('Auto-clearing errors on navigation for tab:', tabId);
      
      // Add delay before clearing to allow errors to be captured first
      setTimeout(() => {
        // Only clear if it's still the same navigation (not a new error page)
        const currentErrors = this.errors.get(tabId) || [];
        if (currentErrors.length > 0) {
          // Check if these are old errors (older than 5 seconds)
          const now = Date.now();
          const hasOldErrors = currentErrors.some(error => 
            (now - error.timestamp) > 5000
          );
          
          if (hasOldErrors) {
            // Clear old errors but keep new ones
            const newErrors = currentErrors.filter(error => 
              (now - error.timestamp) <= 5000
            );
            
            if (newErrors.length > 0) {
              this.errors.set(tabId, newErrors);
            } else {
              this.errors.delete(tabId);
            }
            this.updateBadge(tabId);
          }
        }
      }, 5000); // Wait 5 seconds before clearing
    }
  }
  
  updateAutoClear() {
    // Clear all existing intervals
    this.autoClearIntervals.forEach((intervalId) => {
      clearInterval(intervalId);
    });
    this.autoClearIntervals.clear();
    
    // Set up new auto-clear if needed
    if (this.settings.autoClearMode !== 'never' && 
        this.settings.autoClearMode !== 'refresh') {
      const minutes = parseInt(this.settings.autoClearMode);
      if (!isNaN(minutes) && minutes > 0) {
        console.log(`Setting auto-clear every ${minutes} minutes`);
        
        // Set interval for each tab
        const intervalId = setInterval(() => {
          this.errors.forEach((errors, tabId) => {
            console.log(`Auto-clearing errors for tab ${tabId}`);
            this.errors.delete(tabId);
            this.updateBadge(tabId);
          });
          this.showNotification('Errors auto-cleared', 'info');
        }, minutes * 60 * 1000); // Convert minutes to milliseconds
        
        this.autoClearIntervals.set('global', intervalId);
      }
    }
  }
  
  clearAutoClearInterval(tabId) {
    if (this.autoClearIntervals.has(tabId)) {
      clearInterval(this.autoClearIntervals.get(tabId));
      this.autoClearIntervals.delete(tabId);
    }
  }
}

const errorAggregator = new ErrorAggregator();