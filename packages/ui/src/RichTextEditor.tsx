'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import 'react-quill-new/dist/quill.snow.css';

const ReactQuill = dynamic(() => import('react-quill-new'), { ssr: false });

// Default allowlist for HTML committed from source mode — mirrors the
// platform's server-side rich-text sanitiser. Apps may override via the
// `sanitize` prop. DOMPurify is imported lazily so it never weighs on SSR or
// the initial bundle — it loads only the moment an author leaves source mode.
const DEFAULT_ALLOWED_TAGS = [
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'a', 'span', 'div', 'img',
];
const DEFAULT_ALLOWED_ATTR = ['href', 'rel', 'target', 'style', 'class', 'src', 'alt'];

async function defaultSanitize(html: string): Promise<string> {
  const { default: DOMPurify } = await import('isomorphic-dompurify');
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: DEFAULT_ALLOWED_TAGS,
    ALLOWED_ATTR: DEFAULT_ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:(?:https?):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  });
}

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: number;
  /**
   * Optional HTML-sanitiser override, applied when the author leaves raw-HTML
   * "source" mode. When omitted, a built-in DOMPurify allowlist runs, so the
   * source toggle is safe in every app out of the box
   * (scripts/handlers/unknown tags stripped). Defense-in-depth — the API also
   * sanitises on save and the storefront on render.
   */
  sanitize?: (html: string) => string;
}

export default function RichTextEditor({ value, onChange, placeholder, minHeight = 150, sanitize }: RichTextEditorProps) {
  // Visual (Quill) vs raw-HTML source view. Leaving source mode sanitises the
  // HTML (prop override, else the built-in allowlist) before the visual editor
  // renders it.
  const [showSource, setShowSource] = useState(false);
  const toggleSource = async () => {
    if (showSource) {
      const clean = sanitize ? sanitize(value) : await defaultSanitize(value);
      onChange(clean);
      setShowSource(false);
    } else {
      setShowSource(true);
    }
  };

  const modules = useMemo(() => ({
    toolbar: [
      [{ header: [1, 2, 3, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ color: [] }, { background: [] }],
      [{ align: [] }],
      ['link', 'image'],
      [{ list: 'ordered' }, { list: 'bullet' }],
      ['blockquote'],
      ['clean'],
    ],
    clipboard: {
      matchVisual: false,
    },
  }), []);

  const formats = [
    'header',
    'bold', 'italic', 'underline', 'strike',
    'color', 'background',
    'align',
    'link', 'image',
    'list',
    'blockquote',
    'code', 'code-block',
    'indent',
  ];

  return (
    <div className="rte-wrapper" style={{ minHeight, position: 'relative' }}>
      <button
        type="button"
        onClick={() => void toggleSource()}
        className="rte-source-toggle"
        title={showSource ? 'Back to the visual editor' : 'Edit raw HTML source'}
      >
        {showSource ? '✓ Visual' : '</> HTML'}
      </button>

      {showSource ? (
        <textarea
          className="rte-source-area"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? '<h1>Your HTML here…</h1>'}
          spellCheck={false}
          style={{ minHeight: minHeight - 8 }}
        />
      ) : (
        <ReactQuill
          theme="snow"
          value={value}
          onChange={onChange}
          modules={modules}
          formats={formats}
          placeholder={placeholder}
        />
      )}
      <style>{`
        .rte-wrapper .rte-source-toggle {
          position: absolute;
          top: 6px;
          right: 8px;
          z-index: 5;
          height: 26px;
          padding: 0 10px;
          font-size: 12px;
          font-weight: 600;
          font-family: 'SFMono-Regular', Menlo, Monaco, Consolas, monospace;
          color: #2563eb;
          background: #ffffff;
          border: 1px solid #c9cccf;
          border-radius: 6px;
          cursor: pointer;
        }
        .rte-wrapper .rte-source-toggle:hover {
          background: #eff6ff;
          border-color: #2563eb;
        }
        .rte-wrapper .rte-source-area {
          display: block;
          width: 100%;
          box-sizing: border-box;
          padding: 14px 16px;
          font-family: 'SFMono-Regular', Menlo, Monaco, Consolas, 'Courier New', monospace;
          font-size: 13px;
          line-height: 1.6;
          color: #cdd6f4;
          background: #1e1e2e;
          border: 1px solid #c9cccf;
          border-radius: 8px;
          resize: vertical;
          white-space: pre;
          overflow-x: auto;
          outline: none;
          tab-size: 2;
        }
        .rte-wrapper .rte-source-area::placeholder {
          color: #6c7086;
        }
        .rte-wrapper .ql-container {
          min-height: ${minHeight - 42}px;
          font-size: 14px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          border-bottom-left-radius: 8px;
          border-bottom-right-radius: 8px;
        }
        .rte-wrapper .ql-toolbar {
          border-top-left-radius: 8px;
          border-top-right-radius: 8px;
          background: #fafbfc;
          border-color: #c9cccf;
        }
        .rte-wrapper .ql-container {
          border-color: #c9cccf;
        }
        .rte-wrapper .ql-editor {
          min-height: ${minHeight - 42}px;
          line-height: 1.6;
        }
        .rte-wrapper .ql-editor.ql-blank::before {
          color: #9ca3af;
          font-style: normal;
        }

        /* Inline code */
        .rte-wrapper .ql-editor code {
          background: #f1f2f4;
          color: #d63384;
          padding: 2px 6px;
          border-radius: 4px;
          font-family: 'SFMono-Regular', Menlo, Monaco, Consolas, 'Courier New', monospace;
          font-size: 0.9em;
        }

        /* Code block */
        .rte-wrapper .ql-editor pre.ql-syntax,
        .rte-wrapper .ql-editor .ql-code-block-container,
        .rte-wrapper .ql-editor pre {
          background: #1e1e2e;
          color: #cdd6f4;
          padding: 16px 18px;
          border-radius: 8px;
          font-family: 'SFMono-Regular', Menlo, Monaco, Consolas, 'Courier New', monospace;
          font-size: 13px;
          line-height: 1.6;
          overflow-x: auto;
          margin: 8px 0;
          white-space: pre;
          border: 1px solid #313244;
        }

        /* Blockquote */
        .rte-wrapper .ql-editor blockquote {
          border-left: 4px solid #2563eb;
          padding-left: 16px;
          margin: 8px 0;
          color: #4b5563;
          font-style: italic;
        }

        /* Toolbar icon colors */
        .rte-wrapper .ql-toolbar .ql-stroke {
          stroke: #616161;
        }
        .rte-wrapper .ql-toolbar .ql-fill {
          fill: #616161;
        }
        .rte-wrapper .ql-toolbar button:hover .ql-stroke {
          stroke: #303030;
        }
        .rte-wrapper .ql-toolbar button:hover .ql-fill {
          fill: #303030;
        }
        .rte-wrapper .ql-toolbar button.ql-active .ql-stroke {
          stroke: #2563eb;
        }
        .rte-wrapper .ql-toolbar button.ql-active .ql-fill {
          fill: #2563eb;
        }
        .rte-wrapper .ql-toolbar button.ql-active {
          background: #eff6ff;
          border-radius: 4px;
        }

      `}</style>
    </div>
  );
}
