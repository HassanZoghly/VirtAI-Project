import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

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
      className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded-md transition-all duration-200 ${
        copied 
          ? 'bg-green-500/20 text-green-400 border border-green-500/30' 
          : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80 border border-transparent'
      }`}
      onClick={handleCopy}
      title={copied ? 'Copied!' : 'Copy to clipboard'}
      aria-label="Copy message"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      <span>{copied ? 'Copied!' : 'Copy'}</span>
    </button>
  );
}
