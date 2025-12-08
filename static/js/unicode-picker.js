/**
 * UnicodePicker - A lightweight, comprehensive Unicode character picker
 * Supports all Unicode blocks with search, categories, and recents
 * No external dependencies
 */
class UnicodePicker {
  constructor(options = {}) {
    this.options = {
      buttonText: '⊕ Special Characters',
      position: 'below',
      maxRecents: 20,
      storageKey: 'unicode-picker-recents',
      ...options
    };

    this.targetInput = null;
    this.pickerEl = null;
    this.isOpen = false;
    this.recents = this.loadRecents();
    this.currentCategory = null;
    this.searchQuery = '';

    // All Unicode blocks with ranges (lazy-loaded)
    this.unicodeBlocks = this.getUnicodeBlocks();
  }

  /**
   * Returns all major Unicode blocks with their ranges
   * Characters are generated on-demand for performance
   */
  getUnicodeBlocks() {
    return {
      // Common & frequently used
      "Latin Extended-A": { start: 0x0100, end: 0x017F },
      "Latin Extended-B": { start: 0x0180, end: 0x024F },
      "IPA Extensions": { start: 0x0250, end: 0x02AF },
      "Spacing Modifier Letters": { start: 0x02B0, end: 0x02FF },
      "Combining Diacritical Marks": { start: 0x0300, end: 0x036F },
      "Greek and Coptic": { start: 0x0370, end: 0x03FF },
      "Cyrillic": { start: 0x0400, end: 0x04FF },
      "Cyrillic Supplement": { start: 0x0500, end: 0x052F },
      "Armenian": { start: 0x0530, end: 0x058F },
      "Hebrew": { start: 0x0590, end: 0x05FF },
      "Arabic": { start: 0x0600, end: 0x06FF },
      "Syriac": { start: 0x0700, end: 0x074F },
      "Arabic Supplement": { start: 0x0750, end: 0x077F },
      "Thaana": { start: 0x0780, end: 0x07BF },
      "Devanagari": { start: 0x0900, end: 0x097F },
      "Bengali": { start: 0x0980, end: 0x09FF },
      "Gurmukhi": { start: 0x0A00, end: 0x0A7F },
      "Gujarati": { start: 0x0A80, end: 0x0AFF },
      "Oriya": { start: 0x0B00, end: 0x0B7F },
      "Tamil": { start: 0x0B80, end: 0x0BFF },
      "Telugu": { start: 0x0C00, end: 0x0C7F },
      "Kannada": { start: 0x0C80, end: 0x0CFF },
      "Malayalam": { start: 0x0D00, end: 0x0D7F },
      "Sinhala": { start: 0x0D80, end: 0x0DFF },
      "Thai": { start: 0x0E00, end: 0x0E7F },
      "Lao": { start: 0x0E80, end: 0x0EFF },
      "Tibetan": { start: 0x0F00, end: 0x0FFF },
      "Myanmar": { start: 0x1000, end: 0x109F },
      "Georgian": { start: 0x10A0, end: 0x10FF },
      "Hangul Jamo": { start: 0x1100, end: 0x11FF },
      "Ethiopic": { start: 0x1200, end: 0x137F },
      "Cherokee": { start: 0x13A0, end: 0x13FF },
      "Unified Canadian Aboriginal Syllabics": { start: 0x1400, end: 0x167F },
      "Ogham": { start: 0x1680, end: 0x169F },
      "Runic": { start: 0x16A0, end: 0x16FF },
      "Tagalog": { start: 0x1700, end: 0x171F },
      "Khmer": { start: 0x1780, end: 0x17FF },
      "Mongolian": { start: 0x1800, end: 0x18AF },
      "Latin Extended Additional": { start: 0x1E00, end: 0x1EFF },
      "Greek Extended": { start: 0x1F00, end: 0x1FFF },
      "General Punctuation": { start: 0x2000, end: 0x206F },
      "Superscripts and Subscripts": { start: 0x2070, end: 0x209F },
      "Currency Symbols": { start: 0x20A0, end: 0x20CF },
      "Combining Diacritical Marks for Symbols": { start: 0x20D0, end: 0x20FF },
      "Letterlike Symbols": { start: 0x2100, end: 0x214F },
      "Number Forms": { start: 0x2150, end: 0x218F },
      "Arrows": { start: 0x2190, end: 0x21FF },
      "Mathematical Operators": { start: 0x2200, end: 0x22FF },
      "Miscellaneous Technical": { start: 0x2300, end: 0x23FF },
      "Control Pictures": { start: 0x2400, end: 0x243F },
      "Optical Character Recognition": { start: 0x2440, end: 0x245F },
      "Enclosed Alphanumerics": { start: 0x2460, end: 0x24FF },
      "Box Drawing": { start: 0x2500, end: 0x257F },
      "Block Elements": { start: 0x2580, end: 0x259F },
      "Geometric Shapes": { start: 0x25A0, end: 0x25FF },
      "Miscellaneous Symbols": { start: 0x2600, end: 0x26FF },
      "Dingbats": { start: 0x2700, end: 0x27BF },
      "Miscellaneous Mathematical Symbols-A": { start: 0x27C0, end: 0x27EF },
      "Supplemental Arrows-A": { start: 0x27F0, end: 0x27FF },
      "Braille Patterns": { start: 0x2800, end: 0x28FF },
      "Supplemental Arrows-B": { start: 0x2900, end: 0x297F },
      "Miscellaneous Mathematical Symbols-B": { start: 0x2980, end: 0x29FF },
      "Supplemental Mathematical Operators": { start: 0x2A00, end: 0x2AFF },
      "CJK Radicals Supplement": { start: 0x2E80, end: 0x2EFF },
      "CJK Symbols and Punctuation": { start: 0x3000, end: 0x303F },
      "Hiragana": { start: 0x3040, end: 0x309F },
      "Katakana": { start: 0x30A0, end: 0x30FF },
      "Bopomofo": { start: 0x3100, end: 0x312F },
      "Hangul Compatibility Jamo": { start: 0x3130, end: 0x318F },
      "Kanbun": { start: 0x3190, end: 0x319F },
      "Enclosed CJK Letters and Months": { start: 0x3200, end: 0x32FF },
      "CJK Compatibility": { start: 0x3300, end: 0x33FF },
      "CJK Unified Ideographs Extension A": { start: 0x3400, end: 0x4DBF },
      "CJK Unified Ideographs": { start: 0x4E00, end: 0x9FFF },
      "Hangul Syllables": { start: 0xAC00, end: 0xD7AF },
      "Private Use Area": { start: 0xE000, end: 0xF8FF },
      "CJK Compatibility Ideographs": { start: 0xF900, end: 0xFAFF },
      "Alphabetic Presentation Forms": { start: 0xFB00, end: 0xFB4F },
      "Arabic Presentation Forms-A": { start: 0xFB50, end: 0xFDFF },
      "Combining Half Marks": { start: 0xFE20, end: 0xFE2F },
      "CJK Compatibility Forms": { start: 0xFE30, end: 0xFE4F },
      "Small Form Variants": { start: 0xFE50, end: 0xFE6F },
      "Arabic Presentation Forms-B": { start: 0xFE70, end: 0xFEFF },
      "Halfwidth and Fullwidth Forms": { start: 0xFF00, end: 0xFFEF },
      "Specials": { start: 0xFFF0, end: 0xFFFF }
    };
  }

  /**
   * Generate characters for a Unicode block
   */
  generateCharacters(blockName) {
    const block = this.unicodeBlocks[blockName];
    if (!block) return [];

    const chars = [];
    for (let code = block.start; code <= block.end; code++) {
      const char = String.fromCodePoint(code);
      // Skip control characters and invalid code points
      if (code < 0x20 || (code >= 0x7F && code <= 0x9F)) continue;

      chars.push({
        char: char,
        code: code,
        hex: '0x' + code.toString(16).toUpperCase().padStart(4, '0'),
        name: blockName
      });
    }
    return chars;
  }

  /**
   * Attach picker to a textarea/input element
   */
  attach(inputSelector, options = {}) {
    this.options = { ...this.options, ...options };
    this.targetInput = document.querySelector(inputSelector);

    if (!this.targetInput) {
      console.error('[UnicodePicker] Target input not found:', inputSelector);
      return;
    }

    // Create and inject picker UI
    this.createPickerUI();
    this.attachEventListeners();
  }

  /**
   * Create the picker UI elements
   */
  createPickerUI() {
    // Remove existing picker if any
    const existing = document.getElementById('unicode-picker-container');
    if (existing) existing.remove();

    // Create button next to input
    const button = document.createElement('button');
    button.id = 'unicode-picker-btn';
    button.type = 'button';
    button.className = 'button is-small is-light';
    button.innerHTML = this.options.buttonText;
    button.style.width = '100%';

    // Insert button after input
    this.targetInput.parentNode.insertBefore(button, this.targetInput.nextSibling);

    // Create picker dropdown
    const container = document.createElement('div');
    container.id = 'unicode-picker-container';
    container.className = 'unicode-picker-dropdown';
    container.style.display = 'none';

    container.innerHTML = `
      <div class="unicode-picker-header">
        <input type="text" id="unicode-picker-search" placeholder="Search characters or blocks..." class="input is-small">
        <button type="button" id="unicode-picker-close" class="delete is-small"></button>
      </div>
      <div class="unicode-picker-body">
        <div class="unicode-picker-sidebar">
          <div class="unicode-picker-category active" data-category="recents">
            <strong>★ Recent</strong>
          </div>
          ${Object.keys(this.unicodeBlocks).map(name =>
            `<div class="unicode-picker-category" data-category="${name}">${name}</div>`
          ).join('')}
        </div>
        <div class="unicode-picker-grid-container">
          <div id="unicode-picker-grid" class="unicode-picker-grid"></div>
        </div>
      </div>
    `;

    document.body.appendChild(container);
    this.pickerEl = container;

    // Show recents by default
    this.showCategory('recents');
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    const button = document.getElementById('unicode-picker-btn');
    const closeBtn = document.getElementById('unicode-picker-close');
    const searchInput = document.getElementById('unicode-picker-search');

    button.addEventListener('click', (e) => {
      e.preventDefault();
      this.toggle();
    });

    closeBtn.addEventListener('click', () => this.close());

    searchInput.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.trim().toLowerCase();
      this.performSearch();
    });

    // Category clicks
    this.pickerEl.addEventListener('click', (e) => {
      const category = e.target.closest('.unicode-picker-category');
      if (category) {
        const categoryName = category.dataset.category;
        this.showCategory(categoryName);

        // Update active state
        this.pickerEl.querySelectorAll('.unicode-picker-category').forEach(el => {
          el.classList.remove('active');
        });
        category.classList.add('active');
      }

      // Character click
      const charBtn = e.target.closest('.unicode-char-btn');
      if (charBtn) {
        const char = charBtn.dataset.char;
        this.insertCharacter(char);
      }
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (this.isOpen &&
          !this.pickerEl.contains(e.target) &&
          e.target.id !== 'unicode-picker-btn') {
        this.close();
      }
    });
  }

  /**
   * Toggle picker open/closed
   */
  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  /**
   * Open picker
   */
  open() {
    this.pickerEl.style.display = 'block';
    this.isOpen = true;
    this.positionPicker();
    document.getElementById('unicode-picker-search').focus();
  }

  /**
   * Close picker
   */
  close() {
    this.pickerEl.style.display = 'none';
    this.isOpen = false;
    document.getElementById('unicode-picker-search').value = '';
    this.searchQuery = '';
  }

  /**
   * Position picker relative to target input
   */
  positionPicker() {
    const inputRect = this.targetInput.getBoundingClientRect();
    const pickerWidth = 600;
    const pickerHeight = 400;

    let left = inputRect.left;
    let top = inputRect.bottom + 8;

    // Keep picker on screen
    if (left + pickerWidth > window.innerWidth) {
      left = window.innerWidth - pickerWidth - 16;
    }
    if (top + pickerHeight > window.innerHeight) {
      top = inputRect.top - pickerHeight - 8;
    }

    this.pickerEl.style.left = `${left}px`;
    this.pickerEl.style.top = `${top}px`;
  }

  /**
   * Show a category of characters
   */
  showCategory(categoryName) {
    this.currentCategory = categoryName;
    const grid = document.getElementById('unicode-picker-grid');

    let chars = [];
    if (categoryName === 'recents') {
      chars = this.recents.map(char => ({
        char: char,
        code: char.codePointAt(0),
        hex: '0x' + char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'),
        name: 'Recent'
      }));
    } else {
      chars = this.generateCharacters(categoryName);
    }

    this.renderCharacterGrid(chars);
  }

  /**
   * Perform search across all blocks
   */
  performSearch() {
    if (!this.searchQuery) {
      // Return to current category if search is cleared
      this.showCategory(this.currentCategory);
      return;
    }

    const grid = document.getElementById('unicode-picker-grid');
    const results = [];

    // Search block names
    const matchingBlocks = Object.keys(this.unicodeBlocks).filter(name =>
      name.toLowerCase().includes(this.searchQuery)
    );

    // Generate characters from matching blocks (limit results for performance)
    matchingBlocks.slice(0, 10).forEach(blockName => {
      const chars = this.generateCharacters(blockName);
      results.push(...chars.slice(0, 50)); // Limit per block
    });

    // Also search recent characters
    const matchingRecents = this.recents.filter(char => {
      const code = '0x' + char.codePointAt(0).toString(16).toLowerCase();
      return char.includes(this.searchQuery) || code.includes(this.searchQuery);
    });

    matchingRecents.forEach(char => {
      results.unshift({
        char: char,
        code: char.codePointAt(0),
        hex: '0x' + char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'),
        name: 'Recent'
      });
    });

    if (results.length === 0) {
      grid.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">No characters found</div>';
    } else {
      this.renderCharacterGrid(results.slice(0, 200)); // Limit total results
    }
  }

  /**
   * Render character grid
   */
  renderCharacterGrid(chars) {
    const grid = document.getElementById('unicode-picker-grid');

    if (chars.length === 0) {
      grid.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">No characters in this category</div>';
      return;
    }

    grid.innerHTML = chars.map(ch => `
      <button type="button"
              class="unicode-char-btn"
              data-char="${ch.char}"
              title="${ch.hex} - ${ch.name}">
        ${ch.char}
      </button>
    `).join('');
  }

  /**
   * Insert character at cursor position
   */
  insertCharacter(char) {
    const input = this.targetInput;
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const text = input.value;

    // Insert character at cursor
    input.value = text.substring(0, start) + char + text.substring(end);

    // Move cursor after inserted character
    const newPos = start + char.length;
    input.setSelectionRange(newPos, newPos);
    input.focus();

    // Trigger input event for frameworks that listen to it
    input.dispatchEvent(new Event('input', { bubbles: true }));

    // Add to recents
    this.addToRecents(char);

    // Update recents display if currently showing
    if (this.currentCategory === 'recents') {
      this.showCategory('recents');
    }
  }

  /**
   * Add character to recents list
   */
  addToRecents(char) {
    // Remove if already exists
    this.recents = this.recents.filter(c => c !== char);

    // Add to front
    this.recents.unshift(char);

    // Limit size
    if (this.recents.length > this.options.maxRecents) {
      this.recents = this.recents.slice(0, this.options.maxRecents);
    }

    // Persist to localStorage
    this.saveRecents();
  }

  /**
   * Load recents from localStorage
   */
  loadRecents() {
    try {
      const stored = localStorage.getItem(this.options.storageKey);
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      console.warn('[UnicodePicker] Failed to load recents:', e);
      return [];
    }
  }

  /**
   * Save recents to localStorage
   */
  saveRecents() {
    try {
      localStorage.setItem(this.options.storageKey, JSON.stringify(this.recents));
    } catch (e) {
      console.warn('[UnicodePicker] Failed to save recents:', e);
    }
  }

  /**
   * Destroy the picker
   */
  destroy() {
    const button = document.getElementById('unicode-picker-btn');
    if (button) button.remove();

    if (this.pickerEl) this.pickerEl.remove();

    this.targetInput = null;
    this.pickerEl = null;
    this.isOpen = false;
  }
}

// Export for use in other scripts
window.UnicodePicker = UnicodePicker;
