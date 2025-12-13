# Private Use Area (PUA) Support - Quick Setup Guide

### Step 1: Add Font
```bash
# Copy font files to:
static/fonts/your-font-name.woff2
static/fonts/your-font-name.woff
```

### Step 2: Enable the Font in CSS
Edit `static/css/style.css`:

```css
/* UNCOMMENT AND UPDATE THESE LINES: */
@font-face {
  font-family: 'HistoricalWeather';
  src: url('../fonts/your-font-name.woff2') format('woff2'),
       url('../fonts/your-font-name.woff') format('woff');
  font-weight: normal;
  font-style: normal;
}
```

### Step 3: Add Labels
```bash
# Copy the example config:
cp static/js/pua-config.example.js static/js/pua-config.js

# Edit pua-config.js and add your mappings:
# Example:
window.PUA_CONFIG = {
  labels: {
    57344: 'Rain Symbol',        # U+E000
    57345: 'Cloud Symbol',       # U+E001
    57346: 'Sun Symbol',         # U+E002
    # ... etc
  }
};
```

### Step 4: Include Config in HTML
Edit `templates/index.html` or `templates/base.html`, add before `</body>`:

```html
<script src="{{ url_for('static', filename='js/pua-config.js') }}"></script>
```

### Step 5: Test
1. Restart app: `python app.py`
2. Open a page with text editing
3. Click "Special Characters" button
4. Navigate to "Private Use Area" category
5. Your custom symbols should appear with your font

## How It Works

```
User clicks PUA category
Picker generates U+E000-U+F8FF
Characters get 'pua-char' class
CSS applies custom font
Labels come from PUA_CONFIG
User sees symbols
```

## Example Configuration

If your font has these symbols:
- U+E000 (decimal 57344) = ☼ Sun
- U+E001 (decimal 57345) = ☁ Cloud
- U+E002 (decimal 57346) = ☂ Rain

Your `pua-config.js` would be:

```javascript
window.PUA_CONFIG = {
  fontFamily: 'HistoricalWeather',
  labels: {
    57344: 'Sun',
    57345: 'Cloud',
    57346: 'Rain'
  }
};
```

## Finding Your Codepoints

Use a font editor to inspect your font:
- **FontForge** (free): https://fontforge.org/
- **BirdFont** (free): https://birdfont.org/
- **FontLab** (paid): https://fontlab.com/

Or use this JavaScript in browser console:
```javascript
// See what codepoint a character is:
'🌧'.codePointAt(0).toString(16)  // Returns hex like 'e003'

// Convert hex to decimal for config:
parseInt('E003', 16)  // Returns 57347
```