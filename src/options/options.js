// Default settings
const defaultSettings = {
  filterNoise: true,
  maxErrors: 1000,
  autoClearMode: 'never',  // Changed from 'refresh' to 'never'
  debugMode: false,
  showTimestamps: true,
  domainFilterMode: 'all',
  whitelistDomains: [],
  blacklistDomains: [],
  smartFilters: {
    filter403External: true,
    filterMediaStreaming: true,
    filterDuplicates: true
  }
};

// Load settings
function loadSettings() {
  chrome.storage.sync.get(defaultSettings, (settings) => {
    document.getElementById('filterNoise').checked = settings.filterNoise;
    document.getElementById('maxErrors').value = settings.maxErrors;
    document.getElementById('autoClearMode').value = settings.autoClearMode || 'never';
    document.getElementById('debugMode').checked = settings.debugMode || false;
    document.getElementById('showTimestamps').checked = settings.showTimestamps !== false;
    
    // Domain filter settings
    document.getElementById('domainFilterMode').value = settings.domainFilterMode || 'all';
    document.getElementById('whitelistDomains').value = (settings.whitelistDomains || []).join('\n');
    document.getElementById('blacklistDomains').value = (settings.blacklistDomains || []).join('\n');
    
    // Smart filters
    document.getElementById('filter403External').checked = settings.smartFilters?.filter403External !== false;
    document.getElementById('filterMediaStreaming').checked = settings.smartFilters?.filterMediaStreaming !== false;
    document.getElementById('filterDuplicates').checked = settings.smartFilters?.filterDuplicates !== false;
    
    // Show/hide custom domain settings
    toggleCustomDomainSettings(settings.domainFilterMode || 'all');
  });
}

// Save settings
function saveSettings(isAutoSave = false) {
  const settings = {
    filterNoise: document.getElementById('filterNoise').checked,
    maxErrors: parseInt(document.getElementById('maxErrors').value),
    autoClearMode: document.getElementById('autoClearMode').value,
    debugMode: document.getElementById('debugMode').checked,
    showTimestamps: document.getElementById('showTimestamps').checked,
    domainFilterMode: document.getElementById('domainFilterMode').value,
    whitelistDomains: document.getElementById('whitelistDomains').value
      .split('\n')
      .map(d => d.trim())
      .filter(d => d.length > 0),
    blacklistDomains: document.getElementById('blacklistDomains').value
      .split('\n')
      .map(d => d.trim())
      .filter(d => d.length > 0),
    smartFilters: {
      filter403External: document.getElementById('filter403External').checked,
      filterMediaStreaming: document.getElementById('filterMediaStreaming').checked,
      filterDuplicates: document.getElementById('filterDuplicates').checked
    }
  };

  chrome.storage.sync.set(settings, () => {
    if (!isAutoSave) {
      showMessage('Pengaturan berhasil disimpan!');
    } else {
      // Show subtle indicator for auto-save
      showMessage('Tersimpan otomatis ✓', 1000);
    }
    
    // Notify background script
    chrome.runtime.sendMessage({
      type: 'settings_updated',
      settings: settings
    });
  });
}

// Reset to defaults
function resetSettings() {
  chrome.storage.sync.set(defaultSettings, () => {
    loadSettings();
    showMessage('Settings reset to default!');
  });
}

// Show success message
function showMessage(text, duration = 3000) {
  // Remove existing message if any
  const existing = document.querySelector('.success-message');
  if (existing) existing.remove();
  
  const message = document.createElement('div');
  message.className = 'success-message';
  message.textContent = text;
  document.body.appendChild(message);
  
  setTimeout(() => {
    message.remove();
  }, duration);
}

// Auto-save on any change
let saveTimeout;
function autoSave() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveSettings(true); // true = auto save
  }, 500); // Save after 500ms of no changes
}

// Event listeners
document.getElementById('resetSettings').addEventListener('click', resetSettings);

// Open browser shortcuts page
document.getElementById('open-shortcuts').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

// Domain filter mode change
document.getElementById('domainFilterMode').addEventListener('change', (e) => {
  toggleCustomDomainSettings(e.target.value);
  autoSave();
});

// Add auto-save listeners to all inputs
document.querySelectorAll('input[type="checkbox"], input[type="number"], select, textarea').forEach(element => {
  element.addEventListener('change', autoSave);
  if (element.tagName === 'TEXTAREA' || element.type === 'number') {
    element.addEventListener('input', autoSave);
  }
});

// Toggle custom domain settings visibility
function toggleCustomDomainSettings(mode) {
  const customSettings = document.getElementById('customDomainSettings');
  customSettings.style.display = mode === 'custom' ? 'block' : 'none';
}

// Load settings on page load
loadSettings();