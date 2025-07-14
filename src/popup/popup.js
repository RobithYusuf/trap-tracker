document.addEventListener('DOMContentLoaded', function() {
  updateErrorCounts();
  
  // Auto refresh interval
  let autoRefreshInterval = setInterval(updateErrorCounts, 2000);
  
  // Listen for refresh complete messages
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'refresh_complete') {
      setTimeout(updateErrorCounts, 200);
    } else if (message.type === 'errors_cleared') {
      updateErrorCounts();
    }
  });
  
  // Manual refresh button
  document.getElementById('refresh-errors').addEventListener('click', () => {
    const btn = document.getElementById('refresh-errors');
    btn.classList.add('loading');
    
    // Send refresh request to background
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (tabs[0]) {
        chrome.runtime.sendMessage({
          type: 'refresh_errors',
          tabId: tabs[0].id
        }, (response) => {
          console.log('Refresh response:', response);
          
          // Wait a bit for errors to be captured
          setTimeout(() => {
            updateErrorCounts(() => {
              btn.classList.remove('loading');
              
              // Flash visual feedback
              btn.style.background = '#22c55e';
              btn.innerHTML = 'Updated! <span class="refresh-icon">✓</span>';
              
              setTimeout(() => {
                btn.style.background = '';
                btn.innerHTML = 'Refresh <span class="refresh-icon">🔄</span>';
              }, 800);
            });
          }, 500);
        });
      }
    });
  });
  
  document.getElementById('clear-errors').addEventListener('click', () => {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      chrome.runtime.sendMessage({
        type: 'clear_errors',
        tabId: tabs[0].id
      }, () => {
        showNotification('Cleared! ✓', 'clear-errors');
        updateErrorCounts();
      });
    });
  });
  
  document.getElementById('copy-errors').addEventListener('click', () => {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      chrome.runtime.sendMessage({
        type: 'get_tab_errors',
        tabId: tabs[0].id
      }, (response) => {
        if (response && response.errors && response.errors.length > 0) {
          const formattedErrors = formatErrorsForClipboard(response.errors, tabs[0].url);
          copyToClipboard(formattedErrors);
          const errorCount = response.errors.length;
          showNotification(`Copied ${errorCount} error${errorCount > 1 ? 's' : ''}! ✓`);
        } else {
          showNotification('No errors to copy!');
        }
      });
    });
  });
  
  
  document.getElementById('settings-btn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  
  document.getElementById('copy-with-ai').addEventListener('click', () => {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      chrome.runtime.sendMessage({
        type: 'get_tab_errors',
        tabId: tabs[0].id
      }, (response) => {
        if (response && response.errors && response.errors.length > 0) {
          const formattedErrors = formatErrorsForClipboard(response.errors, tabs[0].url);
          const aiPrompt = generateAIPrompt();
          const fullText = formattedErrors + '\n' + aiPrompt;
          copyToClipboard(fullText);
          const errorCount = response.errors.length;
          showNotification(`✓`, 'copy-with-ai');
        } else {
          showNotification('✓', 'copy-with-ai');
        }
      });
    });
  });
});

function updateErrorCounts(callback) {
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    if (!tabs[0]) {
      if (callback) callback();
      return;
    }
    
    chrome.runtime.sendMessage({
      type: 'get_tab_errors', 
      tabId: tabs[0].id
    }, (response) => {
      console.log('Popup received errors:', response);
      
      if (response && response.errors) {
        const counts = {
          js: 0,
          network: 0,
          console: 0,
          resource: 0
        };
        
        response.errors.forEach(error => {
          console.log('Processing error:', error);
          
          // Better categorization
          switch(error.type) {
            case 'javascript':
            case 'error':
            case 'promise':
            case 'laravel_exception':
            case 'compiler_error':
            case 'server_error':
            case 'dom_error':
              counts.js++;
              break;
            case 'network':
            case 'network_error':
            case 'network_error_background':
            case 'network_failure':
            case 'xhr':
            case 'xhr_failure':
              counts.network++;
              break;
            case 'console':
              counts.console++;
              break;
            case 'resource':
            case 'resource_blocked':
              // Skip resource_blocked - too many false positives
              if (error.type !== 'resource_blocked') {
                counts.resource++;
              }
              break;
          }
        });
        
        document.getElementById('js-errors').textContent = counts.js;
        document.getElementById('network-errors').textContent = counts.network;
        document.getElementById('console-errors').textContent = counts.console;
        document.getElementById('resource-errors').textContent = counts.resource;
        
        // Update error canvas
        displayErrors(response.errors);
      } else {
        // No errors, show empty state
        displayErrors([]);
      }
      
      if (callback) callback();
    });
  });
}

function formatErrorsForClipboard(errors, pageUrl) {
  let output = `🪤 TrapTracker Error Report
================================
Page URL: ${pageUrl}
Time: ${new Date().toLocaleString()}
Total Errors: ${errors.length}
================================\n\n`;

  errors.forEach((error, index) => {
    output += `Error #${index + 1}
---------
Type: ${formatErrorType(error.type)}
${error.message ? `Message: ${error.message}\n` : ''}${error.reason ? `Reason: ${error.reason}\n` : ''}${error.url ? `URL: ${error.url}\n` : ''}${error.method ? `Method: ${error.method}\n` : ''}${error.status ? `Status: ${error.status} ${error.statusText || ''}\n` : ''}${error.duration ? `Duration: ${error.duration}ms\n` : ''}${error.framework ? `Framework: ${error.framework}\n` : ''}${error.filename ? `File: ${error.filename}\n` : ''}${error.line ? `Location: Line ${error.line}, Column ${error.column}\n` : ''}${error.tagName ? `Element: <${error.tagName}${error.className ? ` class="${error.className}"` : ''}${error.id ? ` id="${error.id}"` : ''}>\n` : ''}${error.src ? `Source: ${error.src}\n` : ''}${error.parentElement ? `Parent: <${error.parentElement.tagName}${error.parentElement.className ? ` class="${error.parentElement.className}"` : ''}>\n` : ''}${error.responseBody ? `\nResponse Body:\n${typeof error.responseBody === 'object' ? JSON.stringify(error.responseBody, null, 2) : error.responseBody}\n` : ''}${error.headers && error.headers.response ? `\nResponse Headers:\n${JSON.stringify(error.headers.response, null, 2)}\n` : ''}${error.stack ? `\nStack Trace:\n${error.stack}\n` : ''}\n`;
  });

  return output;
}

function formatErrorType(type) {
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
    'server_error': 'Server Error'
  };
  
  return typeMap[type] || type;
}

async function copyToClipboard(text) {
  try {
    // Menggunakan Chrome API untuk copy
    await chrome.tabs.query({active: true, currentWindow: true}, async (tabs) => {
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: (textToCopy) => {
          const textarea = document.createElement('textarea');
          textarea.value = textToCopy;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
        },
        args: [text]
      });
    });
  } catch (err) {
    console.error('Failed to copy:', err);
    showNotification('Failed to copy errors');
  }
}

function showNotification(message, buttonId = 'copy-errors') {
  const btn = document.getElementById(buttonId);
  const originalText = btn.textContent;
  btn.textContent = message;
  btn.disabled = true;
  
  setTimeout(() => {
    btn.textContent = originalText;
    btn.disabled = false;
  }, 2000);
}

function displayErrors(errors) {
  const canvas = document.getElementById('error-canvas');
  
  if (!errors || errors.length === 0) {
    canvas.textContent = 'No errors detected\n\nErrors will appear here when caught';
    canvas.style.color = '#9ca3af';
    canvas.style.textAlign = 'center';
    canvas.style.paddingTop = '40px';
    return;
  }
  
  // Reset styles
  canvas.style.color = '#1f2937';
  canvas.style.textAlign = 'left';
  canvas.style.paddingTop = '16px';
  
  // Sort errors by timestamp (newest first)
  const sortedErrors = errors.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  
  // Format errors as text - matching the copy format exactly
  let errorText = '🪤 TrapTracker Error Report\n';
  errorText += '================================\n';
  errorText += `Page URL: ${window.location.href}\n`;
  errorText += `Time: ${new Date().toLocaleString()}\n`;
  errorText += `Total Errors: ${sortedErrors.length}\n`;
  errorText += '================================\n\n';
  
  sortedErrors.forEach((error, index) => {
    errorText += `Error #${index + 1}\n`;
    errorText += `---------\n`;
    errorText += `Type: ${formatErrorType(error.type)}\n`;
    
    // Main error details
    if (error.message) errorText += `Message: ${error.message}\n`;
    if (error.reason) errorText += `Reason: ${error.reason}\n`;
    if (error.url) errorText += `URL: ${error.url}\n`;
    if (error.status) errorText += `Status: ${error.status} ${error.statusText || ''}\n`;
    if (error.method) errorText += `Method: ${error.method}\n`;
    if (error.filename) errorText += `File: ${error.filename}\n`;
    if (error.line) errorText += `Location: Line ${error.line}${error.column ? `, Column ${error.column}` : ''}\n`;
    
    // Laravel specific
    if (error.exceptionClass) errorText += `Exception: ${error.exceptionClass}\n`;
    if (error.file) errorText += `File: ${error.file}\n`;
    if (error.errorLine) errorText += `Error Line: ${error.errorLine}\n`;
    
    // Stack trace
    if (error.stack) {
      errorText += `\nStack Trace:\n`;
      errorText += error.stack + '\n';
    }
    
    errorText += '\n';
  });
  
  canvas.textContent = errorText;
}

function getErrorIcon(type) {
  const iconMap = {
    'javascript': '🪤',
    'error': '🪤',
    'promise': '🪤',
    'laravel_exception': '🔥',
    'compiler_error': '⚡',
    'server_error': '💥',
    'dom_error': '📄',
    'network': '🕸️',
    'network_error': '🕸️',
    'network_error_background': '🕸️',
    'network_failure': '🕸️',
    'xhr': '🕸️',
    'xhr_failure': '🕸️',
    'console': '⚠️',
    'resource': '🚫',
    'resource_blocked': '🚫'
  };
  
  return iconMap[type] || '❌';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatSingleError(error) {
  let output = `🪤 TrapTracker Error\n`;
  output += `================\n`;
  output += `Type: ${formatErrorType(error.type)}\n`;
  if (error.message) output += `Message: ${error.message}\n`;
  if (error.url) output += `URL: ${error.url}\n`;
  if (error.filename) output += `File: ${error.filename}\n`;
  if (error.line) output += `Line: ${error.line}${error.column ? `, Column: ${error.column}` : ''}\n`;
  if (error.stack) output += `\nStack Trace:\n${error.stack}\n`;
  return output;
}

function generateAIPrompt() {
  return `
Perbaiki masalah ini, menurut anda cara apa saja yang kita bisa terapkan untuk perbaikan ini?`;
}