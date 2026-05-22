import removeMd from 'remove-markdown';

/**
 * Strips markdown from text to provide plain text.
 * Suitable for TTS and Avatar lip-sync pipelines to prevent reading formatting characters.
 * @param {string} text 
 * @returns {string} plain text
 */
export function stripMarkdownForTTS(text) {
  if (!text) return '';
  return removeMd(text);
}
