/**
 * Private Use Area (PUA) Configuration Example
 *
 * This file shows how to configure custom labels for your PUA characters
 * When you have your historical weather font ready:
 *
 * 1. Copy this file to: static/js/pua-config.js
 * 2. Add your font file to: static/fonts/
 * 3. Uncomment the @font-face rule in static/css/style.css (around line 274)
 * 4. Update the font file paths in style.css
 * 5. Fill in your PUA character mappings below
 * 6. Include this file in your HTML: <script src="/static/js/pua-config.js"></script>
 */

// Example PUA Labels Configuration
window.PUA_CONFIG = {
  // Font configuration
  fontFamily: 'HistoricalWeather',
  fontFiles: {
    woff2: '/static/fonts/historical-weather.woff2',
    woff: '/static/fonts/historical-weather.woff'
  },

  // Character labels - map codepoint to description
  // Format: decimal_codepoint: 'Description'
  labels: {
    // Example mappings (replace with your actual symbols):
    // 0xE000 = 57344 in decimal
    57344: 'Clear Sky',           // U+E000
    57345: 'Partly Cloudy',       // U+E001
    57346: 'Cloudy',              // U+E002
    57347: 'Light Rain',          // U+E003
    57348: 'Heavy Rain',          // U+E004
    57349: 'Thunderstorm',        // U+E005
    57350: 'Snow',                // U+E006
    57351: 'Fog',                 // U+E007
    57352: 'Wind',                // U+E008
    57353: 'Storm',               // U+E009

    // Add more mappings as needed...
    // To convert hex to decimal: 0xE010 = 57360
  },

  // Optional: Group PUA characters by category for better organization
  categories: {
    'Weather Conditions': [57344, 57345, 57346, 57347, 57348],
    'Precipitation': [57349, 57350],
    'Atmospheric': [57351, 57352, 57353]
  }
};

// Helper function to convert hex to decimal for easier configuration
// Usage: hexToDec('E000') returns 57344
function hexToDec(hex) {
  return parseInt(hex, 16);
}

// Example usage:
// window.PUA_CONFIG.labels[hexToDec('E000')] = 'Clear Sky';
