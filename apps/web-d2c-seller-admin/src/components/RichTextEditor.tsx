'use client';

import dynamic from 'next/dynamic';
import { useMemo } from 'react';
import 'react-quill-new/dist/quill.snow.css';

const ReactQuill = dynamic(() => import('react-quill-new'), { ssr: false });

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: number;
}

export default function RichTextEditor({ value, onChange, placeholder, minHeight = 150 }: RichTextEditorProps) {
  const modules = useMemo(() => ({
    toolbar: [
      [{ header: [1, 2, 3, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ color: [] }, { background: [] }],
      [{ align: [] }],
      ['link', 'image'],
      [{ list: 'ordered' }, { list: 'bullet' }],
      ['blockquote', 'code-block'],
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
    <div className="rte-wrapper" style={{ minHeight }}>
      <ReactQuill
        theme="snow"
        value={value}
        onChange={onChange}
        modules={modules}
        formats={formats}
        placeholder={placeholder}
      />
      <style>{`
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
        .rte-wrapper .ql-editor code {
          background: #f1f2f4;
          color: #d63384;
          padding: 2px 6px;
          border-radius: 4px;
          font-family: 'SFMono-Regular', Menlo, Monaco, Consolas, 'Courier New', monospace;
          font-size: 0.9em;
        }
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
        .rte-wrapper .ql-editor blockquote {
          border-left: 4px solid #2563eb;
          padding-left: 16px;
          margin: 8px 0;
          color: #4b5563;
          font-style: italic;
        }
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
