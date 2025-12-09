# Custom Fonts for Private Use Area (PUA)

This directory is for custom fonts that contain Private Use Area (PUA) characters, such as historical weather symbols.

## Setup Instructions

### 1. Add Your Font Files

Place your font files in this directory. Supported formats:
- `.woff2` (recommended - best compression)
- `.woff` (good browser support)
- `.ttf` or `.otf` (if needed)

Example:
```
static/fonts/
  ├── historical-weather.woff2
  ├── historical-weather.woff
  └── README.md
```

### 2. Configure the Font in CSS

Edit `static/css/style.css` around line 274 and uncomment/update the `@font-face` rule:

```css
@font-face {
  font-family: 'HistoricalWeather';
  src: url('../fonts/historical-weather.woff2') format('woff2'),
       url('../fonts/historical-weather.woff') format('woff');
  font-weight: normal;
  font-style: normal;
}
```

### 3. Configure PUA Character Labels (Optional)

1. Copy `static/js/pua-config.example.js` to `static/js/pua-config.js`
2. Edit `pua-config.js` and add your character mappings:

```javascript
window.PUA_CONFIG = {
  labels: {
    57344: 'Clear Sky',      // U+E000
    57345: 'Partly Cloudy',  // U+E001
    // ... add more
  }
};
```

3. Include the config file in your HTML template (add to `templates/index.html`):

```html
<script src="{{ url_for('static', filename='js/pua-config.js') }}"></script>
```

### 4. Verify It Works

1. Restart your application
2. Open the Unicode picker
3. Navigate to "Private Use Area" category
4. Your custom symbols should now display with your font
5. Tooltips will show your custom labels if configured

## Finding Your PUA Codepoints

To find which codepoints your font uses:

1. Use a font editor like [FontForge](https://fontforge.org/) or [BirdFont](https://birdfont.org/)
2. Open your font file
3. Look for characters in the Private Use Area range (U+E000 to U+F8FF)
4. Note the Unicode codepoint for each symbol
5. Add them to your `pua-config.js`

## Converting Hex to Decimal

The configuration uses decimal codepoints. To convert:
- **Hex U+E000** → **Decimal 57344**
- **Hex U+E001** → **Decimal 57345**

Use this JavaScript helper in your browser console:
```javascript
parseInt('E000', 16)  // Returns 57344
```
