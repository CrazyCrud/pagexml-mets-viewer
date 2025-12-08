# Unicode Picker

A lightweight, comprehensive Unicode character picker for historical document transcription.

## Features

- **All Unicode Blocks**: Supports 150+ Unicode blocks covering ~149,000 characters
- **Search**: Search by character, block name, or hex code
- **Recently Used**: Automatically tracks your 20 most recently used characters
- **Lazy Loading**: Characters generated on-demand for optimal performance
- **No Dependencies**: Pure JavaScript, no external libraries needed
- **localStorage**: Remembers your recent characters across sessions

## Usage

### Basic Integration

```javascript
// Create a new picker instance
const picker = new UnicodePicker();

// Attach to a textarea or input element
picker.attach('#myTextarea', {
  buttonText: '⊕ Special Characters',  // Button label
  position: 'below',                    // Position relative to input
  maxRecents: 20,                       // Max recent characters to store
  storageKey: 'unicode-picker-recents' // localStorage key
});
```

### In This Application

The Unicode picker is automatically attached to the line transcription input when you click a TextLine. Look for the **"⊕ Unicode"** button next to the text input field.

## Supported Unicode Blocks

### Common for Historical Documents
- Latin Extended-A, B
- IPA Extensions
- Combining Diacritical Marks
- Greek and Coptic
- Cyrillic
- Hebrew, Arabic, Syriac
- And 140+ more...

### How to Use

1. Click a TextLine to open the transcription popover
2. Click the **"⊕ Unicode"** button
3. Browse categories or search for characters
4. Click any character to insert it at the cursor position
5. Your recently-used characters appear in the **★ Recent** category

## Search Examples

- Type "greek" → Shows Greek and Coptic block
- Type "0x03A9" → Finds character by hex code
- Type "arrow" → Shows Arrows block
- Type "combining" → Shows diacritical marks

## Performance

- Characters are generated on-demand when you open a category
- Only the visible category is in memory at any time
- Search is limited to 200 results for responsiveness
- No network requests needed - all data is generated client-side

## Customization

### Change Button Text
```javascript
picker.attach('#input', { buttonText: '🔤 Characters' });
```

### Increase Recent History
```javascript
picker.attach('#input', { maxRecents: 50 });
```

### Custom Storage Key
```javascript
picker.attach('#input', { storageKey: 'my-app-unicode-recents' });
```

## Browser Support

Works in all modern browsers that support:
- ES6 Classes
- String.fromCodePoint()
- localStorage
- CSS Grid

## File Structure

```
static/
├── js/
│   ├── unicode-picker.js    # Main picker class
│   └── main.js              # Application integration
└── css/
    └── style.css            # Picker styles
```

## Architecture

The picker uses:
- **Unicode Blocks**: Defined as start/end code point ranges
- **On-Demand Generation**: Characters generated when category is opened
- **Event Delegation**: Single event listener for all character clicks
- **Cursor Insertion**: Uses `setSelectionRange()` for proper cursor positioning

## Contributing

To add more Unicode blocks, edit the `getUnicodeBlocks()` method in `unicode-picker.js`:

```javascript
"Block Name": { start: 0xSTART, end: 0xEND }
```

Find Unicode block ranges at: https://www.unicode.org/charts/
