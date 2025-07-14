class TrapTrackerPanel {
  constructor() {
    this.errors = [];
    this.selectedError = null;
    this.filters = {
      type: 'all',
      search: ''
    };
    this.initializeUI();
    this.connectToBackground();
  }
  
  initializeUI() {
    this.errorList = document.getElementById('error-list');
    this.errorDetail = document.getElementById('error-detail');
    this.errorCount = document.getElementById('error-count');
    
    document.getElementById('filter-type').addEventListener('change', (e) => {
      this.filters.type = e.target.value;
      this.renderErrors();
    });
    
    document.getElementById('filter-search').addEventListener('input', (e) => {
      this.filters.search = e.target.value;
      this.renderErrors();
    });
    
    document.getElementById('clear-errors').addEventListener('click', () => {
      this.clearErrors();
    });
    
    document.getElementById('export-errors').addEventListener('click', () => {
      this.exportErrors();
    });
    
    document.getElementById('settings').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
  }
  
  connectToBackground() {
    chrome.devtools.inspectedWindow.eval(
      "window.location.href",
      (url) => {
        chrome.runtime.sendMessage({
          type: 'get_tab_errors',
          url: url
        }, (response) => {
          if (response && response.errors) {
            this.errors = response.errors;
            this.renderErrors();
          }
        });
      }
    );
    
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'devtools_update') {
        this.errors.push(message.error);
        this.renderErrors();
      }
    });
  }
  
  renderErrors() {
    const filtered = this.filterErrors();
    this.errorCount.textContent = `Errors: ${filtered.length}`;
    
    this.errorList.innerHTML = filtered.map(error => `
      <div class="error-item" data-id="${error.id}">
        <div class="error-type">
          <span class="error-icon">${this.getErrorIcon(error.type)}</span>
          ${this.formatErrorType(error.type)}
        </div>
        <div class="error-message">${this.truncate(error.message || error.reason || 'No message', 100)}</div>
        <div class="error-time">${this.formatTime(error.timestamp)}</div>
      </div>
    `).join('');
    
    this.errorList.querySelectorAll('.error-item').forEach(item => {
      item.addEventListener('click', () => {
        this.showErrorDetail(item.dataset.id);
        document.querySelectorAll('.error-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
      });
    });
  }
  
  showErrorDetail(errorId) {
    const error = this.errors.find(e => e.id === errorId);
    if (!error) return;
    
    this.selectedError = error;
    
    let detailHTML = `
      <h3>${this.formatErrorType(error.type)}</h3>
    `;
    
    if (error.message || error.reason) {
      detailHTML += `<p class="error-message">${error.message || error.reason}</p>`;
    }
    
    if (error.stack) {
      detailHTML += `<pre class="error-stack">${error.stack}</pre>`;
    }
    
    if (error.url && error.type.includes('network')) {
      detailHTML += `<p class="error-url"><strong>URL:</strong> ${error.url}</p>`;
    }
    
    if (error.status) {
      detailHTML += `<p class="error-location"><strong>Status:</strong> ${error.status} ${error.statusText || ''}</p>`;
    }
    
    if (error.line && error.column) {
      detailHTML += `<p class="error-location"><strong>Location:</strong> Line ${error.line}, Column ${error.column}</p>`;
    }
    
    if (error.filename) {
      detailHTML += `<p class="error-location"><strong>File:</strong> ${error.filename}</p>`;
    }
    
    detailHTML += `
      <div class="error-actions">
        <button class="btn btn-primary" id="copy-error">Copy Error</button>
        <button class="btn btn-primary" id="send-to-ai">Send to AI</button>
        <button class="btn btn-secondary" id="search-stackoverflow">Search StackOverflow</button>
      </div>
    `;
    
    this.errorDetail.innerHTML = detailHTML;
    
    document.getElementById('copy-error')?.addEventListener('click', () => {
      this.copyError(error);
    });
    
    document.getElementById('send-to-ai')?.addEventListener('click', () => {
      this.sendToAI([error]);
    });
    
    document.getElementById('search-stackoverflow')?.addEventListener('click', () => {
      this.searchStackOverflow(error);
    });
  }
  
  filterErrors() {
    return this.errors.filter(error => {
      if (this.filters.type !== 'all') {
        const typeMap = {
          'error': ['error', 'laravel_exception'],
          'console': ['console'],
          'network': ['network', 'xhr', 'network_failure', 'xhr_failure'],
          'resource': ['resource', 'resource_blocked'],
          'promise': ['promise']
        };
        
        const allowedTypes = typeMap[this.filters.type] || [];
        if (!allowedTypes.some(type => error.type.includes(type))) {
          return false;
        }
      }
      
      if (this.filters.search) {
        const searchStr = JSON.stringify(error).toLowerCase();
        return searchStr.includes(this.filters.search.toLowerCase());
      }
      
      return true;
    });
  }
  
  getErrorIcon(type) {
    const icons = {
      'error': '🪤',
      'laravel_exception': '🪤',
      'network': '🕸️',
      'network_failure': '🕸️',
      'xhr': '🕸️',
      'xhr_failure': '🕸️',
      'console': '⚠️',
      'promise': '🔗',
      'resource': '🚫',
      'resource_blocked': '🚫'
    };
    
    for (const [key, icon] of Object.entries(icons)) {
      if (type.includes(key)) return icon;
    }
    return '❓';
  }
  
  formatErrorType(type) {
    const typeMap = {
      'error': 'JavaScript Error',
      'laravel_exception': 'Laravel Exception',
      'console': 'Console',
      'network': 'Network Error',
      'network_failure': 'Network Failure',
      'xhr': 'XHR Error',
      'xhr_failure': 'XHR Failure',
      'promise': 'Promise Rejection',
      'resource': 'Resource Error',
      'resource_blocked': 'Resource Blocked'
    };
    
    return typeMap[type] || type;
  }
  
  formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) {
      return 'Just now';
    } else if (diff < 3600000) {
      return `${Math.floor(diff / 60000)} min ago`;
    } else if (diff < 86400000) {
      return `${Math.floor(diff / 3600000)} hr ago`;
    } else {
      return date.toLocaleTimeString();
    }
  }
  
  truncate(str, length) {
    if (!str) return '';
    return str.length > length ? str.substring(0, length) + '...' : str;
  }
  
  copyError(error) {
    const errorText = JSON.stringify(error, null, 2);
    navigator.clipboard.writeText(errorText).then(() => {
      const btn = document.getElementById('copy-error');
      const originalText = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => {
        btn.textContent = originalText;
      }, 2000);
    });
  }
  
  sendToAI(errors) {
    chrome.devtools.inspectedWindow.eval(
      `(function() {
        return {
          url: window.location.href,
          framework: window.TrapTracker?.context?.framework || 
                     (window.Laravel ? 'Laravel' : 
                      window.Vue ? 'Vue.js' : 
                      window.React ? 'React' : 
                      window.angular ? 'Angular' : 'Unknown')
        };
      })()`,
      (context) => {
        chrome.runtime.sendMessage({
          type: 'send_to_ai',
          errors: errors,
          context: context
        });
      }
    );
  }
  
  searchStackOverflow(error) {
    const query = error.message || error.reason || error.type;
    const url = `https://stackoverflow.com/search?q=${encodeURIComponent(query)}`;
    window.open(url, '_blank');
  }
  
  clearErrors() {
    this.errors = [];
    this.selectedError = null;
    this.renderErrors();
    this.errorDetail.innerHTML = '<div class="empty-state"><p>Select an error to view details</p></div>';
    
    chrome.runtime.sendMessage({
      type: 'clear_errors'
    });
  }
  
  exportErrors() {
    chrome.storage.sync.get(['exportFormat'], (settings) => {
      const format = settings.exportFormat || 'json';
      const filtered = this.filterErrors();
      
      if (filtered.length === 0) {
        alert('No errors to export');
        return;
      }
      
      let content, filename, mimeType;
      
      switch (format) {
        case 'json':
          content = JSON.stringify(filtered, null, 2);
          filename = `traptracker-errors-${Date.now()}.json`;
          mimeType = 'application/json';
          break;
          
        case 'csv':
          content = this.convertToCSV(filtered);
          filename = `traptracker-errors-${Date.now()}.csv`;
          mimeType = 'text/csv';
          break;
          
        case 'text':
          content = this.convertToText(filtered);
          filename = `traptracker-errors-${Date.now()}.txt`;
          mimeType = 'text/plain';
          break;
      }
      
      this.downloadFile(content, filename, mimeType);
    });
  }
  
  convertToCSV(errors) {
    const headers = ['Type', 'Message', 'URL', 'Status', 'File', 'Line', 'Column', 'Timestamp'];
    const rows = errors.map(error => [
      error.type || '',
      (error.message || error.reason || '').replace(/"/g, '""'),
      error.url || '',
      error.status || '',
      error.filename || '',
      error.line || '',
      error.column || '',
      new Date(error.timestamp).toISOString()
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');
    
    return csvContent;
  }
  
  convertToText(errors) {
    let content = `TrapTracker Error Report
Generated: ${new Date().toLocaleString()}
Total Errors: ${errors.length}
================================\n\n`;

    errors.forEach((error, index) => {
      content += `Error #${index + 1}
Type: ${this.formatErrorType(error.type)}
${error.message ? `Message: ${error.message}\n` : ''}${error.reason ? `Reason: ${error.reason}\n` : ''}${error.url ? `URL: ${error.url}\n` : ''}${error.status ? `Status: ${error.status}\n` : ''}${error.filename ? `File: ${error.filename}\n` : ''}${error.line ? `Location: Line ${error.line}, Column ${error.column}\n` : ''}Time: ${new Date(error.timestamp).toLocaleString()}
${error.stack ? `\nStack Trace:\n${error.stack}\n` : ''}
--------------------------------\n\n`;
    });
    
    return content;
  }
  
  downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

new TrapTrackerPanel();