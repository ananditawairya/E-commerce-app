// backend/product-service/src/utils/descriptionFormatter.js

/**
 * Formats product description into bullet points for better readability
 * @param {string} description - Raw product description
 * @returns {string} - Formatted description with bullet points
 */
const formatDescriptionToBullets = (description) => {
  if (!description || typeof description !== 'string') {
    return '';
  }

  // Split by common delimiters that indicate new sections
  const sections = description
    .split(/(?:\n|--|\.\s+[A-Z])/g)
    .map(section => section.trim())
    .filter(section => section.length > 0);

  // Format each section as a bullet point
  const bulletPoints = sections.map(section => {
    // Clean up the section text
    let cleanSection = section
      .replace(/^--\s*/, '') // Remove leading dashes
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();

    // Ensure proper sentence ending
    if (cleanSection && !cleanSection.match(/[.!?]$/)) {
      cleanSection += '.';
    }

    return cleanSection;
  }).filter(section => section.length > 1);

  // Return formatted bullet points
  return bulletPoints.map(point => `• ${point}`).join('\n');
};

module.exports = {
  formatDescriptionToBullets,
};