import React from 'react';

export interface MarkdownViewerProps {
  content: string;
  className?: string;
  onInspectAccount?: (accountId: string) => void;
}

/**
 * Lightweight, safe internal Markdown renderer for autonomous agent findings and narratives.
 * Formats all header levels (# to ######), bold text (**text**), lists (* or - item),
 * code/identifiers (`id`), line breaks, and distinct paragraph blocks without external dependencies.
 */
export const MarkdownViewer: React.FC<MarkdownViewerProps> = ({
  content,
  className = '',
  onInspectAccount,
}) => {
  if (!content) return null;

  // Split narrative into line blocks
  const lines = content.split(/\r?\n/);
  const elements: React.ReactNode[] = [];

  let inList = false;
  let currentListItems: React.ReactNode[] = [];
  let paragraphLines: string[] = [];

  const flushParagraph = (key: string) => {
    if (paragraphLines.length > 0) {
      elements.push(
        <div
          key={key}
          style={{
            marginBottom: '0.85rem',
            lineHeight: 1.6,
            color: 'var(--text-primary)',
            fontSize: '0.85rem',
          }}
        >
          {paragraphLines.map((lineText, lIdx) => (
            <React.Fragment key={lIdx}>
              {lIdx > 0 && <br />}
              {renderInline(lineText, onInspectAccount)}
            </React.Fragment>
          ))}
        </div>
      );
      paragraphLines = [];
    }
  };

  const flushList = (key: string) => {
    if (inList && currentListItems.length > 0) {
      elements.push(
        <ul
          key={key}
          style={{
            margin: '0.5rem 0 1rem 1.25rem',
            paddingLeft: '0.5rem',
            listStyleType: 'disc',
            color: 'var(--text-primary)',
            fontSize: '0.85rem',
            lineHeight: 1.6,
          }}
        >
          {currentListItems}
        </ul>
      );
      currentListItems = [];
      inList = false;
    }
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    // Empty line separates blocks
    if (!trimmed) {
      flushParagraph(`p-${index}`);
      flushList(`ul-${index}`);
      return;
    }

    // Header match: # through ######
    const headerMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headerMatch) {
      flushParagraph(`p-pre-${index}`);
      flushList(`ul-pre-${index}`);
      const hashes = headerMatch[1];
      const headerText = headerMatch[2];
      const level = hashes.length;

      if (level === 1) {
        elements.push(
          <h1
            key={`h1-${index}`}
            style={{
              fontSize: '1.15rem',
              fontWeight: 800,
              color: 'var(--text-primary)',
              marginTop: elements.length > 0 ? '1.25rem' : '0.25rem',
              marginBottom: '0.5rem',
            }}
          >
            {renderInline(headerText, onInspectAccount)}
          </h1>
        );
      } else if (level === 2) {
        elements.push(
          <h2
            key={`h2-${index}`}
            style={{
              fontSize: '1.05rem',
              fontWeight: 700,
              color: 'var(--text-primary)',
              marginTop: elements.length > 0 ? '1.1rem' : '0.25rem',
              marginBottom: '0.45rem',
            }}
          >
            {renderInline(headerText, onInspectAccount)}
          </h2>
        );
      } else if (level === 3) {
        elements.push(
          <h3
            key={`h3-${index}`}
            style={{
              fontSize: '0.975rem',
              fontWeight: 700,
              color: 'var(--text-primary)',
              marginTop: elements.length > 0 ? '1rem' : '0.25rem',
              marginBottom: '0.4rem',
            }}
          >
            {renderInline(headerText, onInspectAccount)}
          </h3>
        );
      } else if (level === 4) {
        elements.push(
          <h4
            key={`h4-${index}`}
            style={{
              fontSize: '0.9rem',
              fontWeight: 700,
              color: 'var(--brand-forest)',
              marginTop: elements.length > 0 ? '0.9rem' : '0.25rem',
              marginBottom: '0.35rem',
            }}
          >
            {renderInline(headerText, onInspectAccount)}
          </h4>
        );
      } else {
        elements.push(
          <h5
            key={`h5-${index}`}
            style={{
              fontSize: '0.85rem',
              fontWeight: 700,
              color: 'var(--text-primary)',
              marginTop: elements.length > 0 ? '0.8rem' : '0.25rem',
              marginBottom: '0.3rem',
            }}
          >
            {renderInline(headerText, onInspectAccount)}
          </h5>
        );
      }
      return;
    }

    // List item: - item or * item
    const listMatch = trimmed.match(/^[-*]\s+(.*)$/);
    if (listMatch) {
      flushParagraph(`p-pre-${index}`);
      inList = true;
      currentListItems.push(
        <li key={`li-${index}`} style={{ marginBottom: '0.35rem' }}>
          {renderInline(listMatch[1], onInspectAccount)}
        </li>
      );
      return;
    }

    // Numbered list item: 1. item
    const numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (numMatch) {
      flushParagraph(`p-pre-${index}`);
      flushList(`ul-pre-${index}`);
      elements.push(
        <div
          key={`num-${index}`}
          style={{
            display: 'flex',
            gap: '0.5rem',
            marginBottom: '0.35rem',
            fontSize: '0.85rem',
            color: 'var(--text-primary)',
          }}
        >
          <span style={{ fontWeight: 600, color: 'var(--brand-teal)' }}>{numMatch[1]}.</span>
          <span style={{ flex: 1 }}>{renderInline(numMatch[2], onInspectAccount)}</span>
        </div>
      );
      return;
    }

    // Regular text line in paragraph
    paragraphLines.push(trimmed);
  });

  flushParagraph('p-final');
  flushList('ul-final');

  return <div className={`markdown-viewer ${className}`}>{elements}</div>;
};

/**
 * Parses inline tokens: **bold**, `code/id`, and standard text.
 */
function renderInline(text: string, onInspectAccount?: (acc: string) => void): React.ReactNode[] {
  // Regex to match `code` or **bold** or *italic*
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  const parts = text.split(pattern);

  return parts.map((part, i) => {
    if (!part) return null;

    // Code token: `something`
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      const codeVal = part.slice(1, -1);
      const isAccount = codeVal.startsWith('ACC_');
      const isTx = codeVal.startsWith('TX_');

      if (isAccount && onInspectAccount) {
        return (
          <button
            key={i}
            onClick={() => onInspectAccount(codeVal)}
            className="rt-badge badge-personal mono"
            style={{
              display: 'inline-flex',
              cursor: 'pointer',
              padding: '0.1rem 0.4rem',
              margin: '0 0.2rem',
              fontSize: '0.775rem',
              fontWeight: 600,
              verticalAlign: 'baseline',
            }}
            title={`Inspect account ${codeVal} in network graph`}
          >
            {codeVal}
          </button>
        );
      }

      return (
        <code
          key={i}
          className="mono"
          style={{
            backgroundColor: isTx ? 'var(--accent-blue-subtle)' : 'var(--surface-muted)',
            color: isTx ? 'var(--accent-blue)' : 'var(--text-primary)',
            padding: '0.12rem 0.35rem',
            borderRadius: '4px',
            fontSize: '0.825em',
            border: '1px solid var(--border-subtle)',
            margin: '0 0.15rem',
            fontWeight: 500,
          }}
        >
          {codeVal}
        </code>
      );
    }

    // Bold token: **something**
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      const boldVal = part.slice(2, -2);
      return (
        <strong key={i} style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
          {boldVal}
        </strong>
      );
    }

    // Italic token: *something*
    if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
      const italicVal = part.slice(1, -1);
      return <em key={i}>{italicVal}</em>;
    }

    return <span key={i}>{part}</span>;
  });
}

export default MarkdownViewer;
