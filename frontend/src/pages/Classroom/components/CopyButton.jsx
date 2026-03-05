import { useState } from 'react';
import { PiCopyFill, PiCheckCircleFill } from 'react-icons/pi';

/**
 * Button that copies text to clipboard and shows a brief confirmation.
 * @param {{ content: string }} props
 */
export default function CopyButton({ content }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      className="copy-btn"
      onClick={handleCopy}
      title={copied ? 'Copied!' : 'Copy to clipboard'}
      aria-label="Copy message"
    >
      {copied ? <PiCheckCircleFill /> : <PiCopyFill />}
    </button>
  );
}
