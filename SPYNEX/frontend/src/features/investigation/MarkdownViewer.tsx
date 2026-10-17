import React from 'react';

export interface MarkdownViewerProps {
  content: string;
  className?: string;
  onInspectAccount?: (accountId: string) => void;
  inlineOnly?: boolean;
}

/**
 * High-agency Markdown & Investigative Brief renderer.
 * Formats headings, structured lists, bold/italic, account pills, and metadata keys
 * without leaking raw markdown syntax (such as ####, **, or *Reason:*).
 */
export const MarkdownViewer: React.FC<MarkdownViewerProps> = ({
  content,
  className = '',
  onInspectAccount,
  inlineOnly = false,
}) => {
  if (!content) return null;

  // Unescape double-escaped newlines and normalize line breaks
  const normalized = content
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n');

  if (inlineOnly) {
    return (
      <span className={`markdown-inline ${className}`}>
        {renderInline(normalized.trim(), onInspectAccount)}
      </span>
    );
  }

  const lines = normalized.split('\n');
  const elements: React.ReactNode[] = [];

  let inList = false;
  let currentListItems: React.ReactNode[] = [];
  let paragraphLines: string[] = [];

  const flushParagraph = (key: string) => {
    if (paragraphLines.length > 0) {
      elements.push(
        <p
          key={key}
          style={{
            margin: '0 0 0.75rem 0',
            lineHeight: 1.65,
            color: '#334155',
            fontSize: '0.85rem',
            fontFamily: 'var(--font-body, var(--font-sans))',
          }}
        >
          {paragraphLines.map((lineText, lIdx) => (
            <React.Fragment key={lIdx}>
              {lIdx > 0 && ' '}
              {renderInline(lineText, onInspectAccount)}
            </React.Fragment>
          ))}
        </p>
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
            margin: '0.35rem 0 0.85rem 1.25rem',
            paddingLeft: '0.25rem',
            listStyleType: 'disc',
            color: '#334155',
            fontSize: '0.85rem',
            lineHeight: 1.6,
            fontFamily: 'var(--font-body, var(--font-sans))',
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
      const level = headerMatch[1].length;
      const headerText = headerMatch[2];

      const headingStyle: React.CSSProperties = {
        fontFamily: 'var(--font-display)',
        color: '#0F172A',
        fontWeight: 750,
        letterSpacing: '-0.02em',
        marginTop: elements.length > 0 ? '1.1rem' : '0.2rem',
        marginBottom: '0.4rem',
        lineHeight: 1.3,
      };

      if (level === 1) {
        elements.push(
          <h1 key={`h1-${index}`} style={{ ...headingStyle, fontSize: '1.2rem', fontWeight: 800 }}>
            {renderInline(headerText, onInspectAccount)}
          </h1>
        );
      } else if (level === 2) {
        elements.push(
          <h2 key={`h2-${index}`} style={{ ...headingStyle, fontSize: '1.05rem' }}>
            {renderInline(headerText, onInspectAccount)}
          </h2>
        );
      } else if (level === 3) {
        elements.push(
          <h3 key={`h3-${index}`} style={{ ...headingStyle, fontSize: '0.975rem', color: '#1E293B' }}>
            {renderInline(headerText, onInspectAccount)}
          </h3>
        );
      } else if (level === 4) {
        elements.push(
          <h4
            key={`h4-${index}`}
            style={{
              ...headingStyle,
              fontSize: '0.875rem',
              fontWeight: 700,
              color: '#334155',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            {renderInline(headerText, onInspectAccount)}
          </h4>
        );
      } else {
        elements.push(
          <h5 key={`h5-${index}`} style={{ ...headingStyle, fontSize: '0.825rem', color: '#475569' }}>
            {renderInline(headerText, onInspectAccount)}
          </h5>
        );
      }
      return;
    }

    // List item: - item or * item (or • item)
    const listMatch = trimmed.match(/^[-*•]\s+(.*)$/);
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
            marginBottom: '0.4rem',
            fontSize: '0.85rem',
            color: '#334155',
            lineHeight: 1.6,
          }}
        >
          <span style={{ fontWeight: 700, color: '#0F172A', fontFamily: 'var(--font-mono)' }}>
            {numMatch[1]}.
          </span>
          <span style={{ flex: 1 }}>{renderInline(numMatch[2], onInspectAccount)}</span>
        </div>
      );
      return;
    }

    // Regular line in paragraph
    paragraphLines.push(trimmed);
  });

  flushParagraph('p-final');
  flushList('ul-final');

  return <div className={`markdown-viewer ${className}`}>{elements}</div>;
};

/**
 * Parses inline tokens: **bold**, *italic*, `code`, account pills (ACC_...),
 * and cleans up residual markdown syntax such as *Reason:* or stray hashes.
 */
export function renderInline(
  text: string,
  onInspectAccount?: (acc: string) => void
): React.ReactNode[] {
  if (!text) return [];

  // If text starts with residual heading tags like #### or ###, strip them
  let cleanText = text.replace(/^#{1,6}\s*/, '');

  // Normalize common key-value prefixes like "*Reason:*" or "* **Reason:**"
  cleanText = cleanText.replace(/^\*\s*\*\*([^*]+)\*\*/, '**$1**');
  cleanText = cleanText.replace(/^\*([^*:]+:)\*/, '**$1**');

  // Tokenize by code, bold, italic, or raw ACC_... / TX_... tokens
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\bACC_\d+\b|\bTX_\d+\b)/g;
  const parts = cleanText.split(pattern);

  return parts.map((part, i) => {
    if (!part) return null;

    // Code token: `something`
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      const codeVal = part.slice(1, -1);
      return renderCodeOrId(codeVal, i, onInspectAccount);
    }

    // Naked account identifier: ACC_...
    if (/^ACC_\d+$/.test(part)) {
      return renderAccountBadge(part, i, onInspectAccount);
    }

    // Naked transaction identifier: TX_...
    if (/^TX_\d+$/.test(part)) {
      return (
        <span
          key={i}
          className="mono"
          style={{
            display: 'inline-block',
            padding: '0.05rem 0.35rem',
            borderRadius: '4px',
            backgroundColor: '#F1F5F9',
            color: '#334155',
            fontSize: '0.75rem',
            fontWeight: 600,
            border: '1px solid #CBD5E1',
            margin: '0 0.15rem',
          }}
        >
          {part}
        </span>
      );
    }

    // Bold token: **something**
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      const boldVal = part.slice(2, -2);
      return (
        <strong
          key={i}
          style={{
            fontWeight: 700,
            color: '#0F172A',
            fontFamily: 'inherit',
          }}
        >
          {boldVal}
        </strong>
      );
    }

    // Italic token: *something*
    if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
      const italicVal = part.slice(1, -1);
      return (
        <em key={i} style={{ fontStyle: 'italic', color: '#1E293B' }}>
          {italicVal}
        </em>
      );
    }

    return <span key={i}>{part}</span>;
  });
}

function renderCodeOrId(
  val: string,
  key: number,
  onInspectAccount?: (acc: string) => void
): React.ReactNode {
  if (val.startsWith('ACC_')) {
    return renderAccountBadge(val, key, onInspectAccount);
  }

  return (
    <code
      key={key}
      className="mono"
      style={{
        backgroundColor: '#F1F5F9',
        color: '#0F172A',
        padding: '0.12rem 0.35rem',
        borderRadius: '4px',
        fontSize: '0.8em',
        border: '1px solid #E2E8F0',
        margin: '0 0.15rem',
        fontWeight: 600,
      }}
    >
      {val}
    </code>
  );
}

function renderAccountBadge(
  accountId: string,
  key: number,
  onInspectAccount?: (acc: string) => void
): React.ReactNode {
  if (onInspectAccount) {
    return (
      <button
        key={key}
        type="button"
        onClick={() => onInspectAccount(accountId)}
        className="rt-badge mono"
        style={{
          display: 'inline-flex',
          cursor: 'pointer',
          padding: '0.1rem 0.45rem',
          margin: '0 0.2rem',
          fontSize: '0.75rem',
          fontWeight: 600,
          backgroundColor: '#F1F5F9',
          color: '#0F172A',
          border: '1px solid #CBD5E1',
          verticalAlign: 'baseline',
          transition: 'all 0.15s ease',
        }}
        title={`Inspect ${accountId} in graph`}
      >
        {accountId}
      </button>
    );
  }

  return (
    <span
      key={key}
      className="rt-badge mono"
      style={{
        display: 'inline-flex',
        padding: '0.1rem 0.45rem',
        margin: '0 0.2rem',
        fontSize: '0.75rem',
        fontWeight: 600,
        backgroundColor: '#F1F5F9',
        color: '#0F172A',
        border: '1px solid #CBD5E1',
      }}
    >
      {accountId}
    </span>
  );
}

export default MarkdownViewer;
