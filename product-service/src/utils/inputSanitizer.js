// backend/product-service/src/utils/inputSanitizer.js

const he = require('he');

/**
 * Validates if a string is a valid URI
 * @param {string} uri - URI to validate
 * @returns {boolean} - True if valid
 */
// CHANGE: Add URI validation helper
const isValidUri = (uri) => {
  if (!uri || typeof uri !== 'string') return false;
  
  // Check for common URI patterns
  const uriPattern = /^(https?:\/\/|file:\/\/\/|data:image\/)/i;
  if (!uriPattern.test(uri)) return false;
  
  // For file URIs, ensure they have a filename with extension
  if (uri.startsWith('file:///')) {
    const parts = uri.split('/');
    const filename = parts[parts.length - 1];
    return filename && filename.includes('.');
  }
  
  // For HTTP(S) URIs, basic validation
  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    try {
      new URL(uri);
      return true;
    } catch {
      return false;
    }
  }
  
  // For data URIs, ensure they have proper format
  if (uri.startsWith('data:image/')) {
    return uri.includes(',') && uri.split(',')[1].length > 0;
  }
  
  return true;
};

/**
 * Sanitizes product input by decoding HTML entities and cleaning malformed JSON strings
 * @param {Object} input - Raw product input
 * @returns {Object} - Sanitized product input
 */
const sanitizeProductInput = (input) => {
  if (!input || typeof input !== 'object') {
    return input;
  }

  const sanitized = { ...input };

  // Sanitize string fields
  const stringFields = ['name', 'description', 'category'];
  stringFields.forEach(field => {
    if (sanitized[field] && typeof sanitized[field] === 'string') {
      sanitized[field] = he.decode(sanitized[field]);
    }
  });

  // Sanitize images array
  if (sanitized.images && Array.isArray(sanitized.images)) {
    sanitized.images = sanitized.images.map(image => {
      if (typeof image === 'string') {
        // Decode HTML entities and clean malformed JSON quotes
        let cleanImage = he.decode(image);
        // Remove extra quotes and malformed JSON artifacts
        cleanImage = cleanImage.replace(/^["']+|["']+$/g, '');
        cleanImage = cleanImage.replace(/\\"/g, '"');
        return cleanImage;
      }
      return image;
    })
    // CHANGE: Filter out invalid URIs
    .filter(image => image && image.trim() !== '' && isValidUri(image));
  }

  // Sanitize variants
  if (sanitized.variants && Array.isArray(sanitized.variants)) {
    sanitized.variants = sanitized.variants.map(variant => {
      const sanitizedVariant = { ...variant };
      
      // Sanitize variant string fields
      if (sanitizedVariant.name && typeof sanitizedVariant.name === 'string') {
        sanitizedVariant.name = he.decode(sanitizedVariant.name);
      }
      
      if (sanitizedVariant.description && typeof sanitizedVariant.description === 'string') {
        sanitizedVariant.description = he.decode(sanitizedVariant.description);
      }

      // Sanitize variant images
      if (sanitizedVariant.images && Array.isArray(sanitizedVariant.images)) {
        sanitizedVariant.images = sanitizedVariant.images.map(image => {
          if (typeof image === 'string') {
            let cleanImage = he.decode(image);
            cleanImage = cleanImage.replace(/^["']+|["']+$/g, '');
            cleanImage = cleanImage.replace(/\\"/g, '"');
            return cleanImage;
          }
          return image;
        })
        // CHANGE: Filter out invalid URIs
        .filter(image => image && image.trim() !== '' && isValidUri(image));
      }

      return sanitizedVariant;
    });
  }

  return sanitized;
};

module.exports = {
  sanitizeProductInput,
};