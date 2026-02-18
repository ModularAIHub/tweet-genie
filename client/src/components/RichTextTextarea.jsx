import React, { useRef } from 'react';
import { Bold, Italic, Underline } from 'lucide-react';

const toUnicodeBold = (text) =>
  Array.from(text || '')
    .map((char) => {
      const code = char.codePointAt(0);
      if (code >= 65 && code <= 90) return String.fromCodePoint(0x1d5d4 + (code - 65));
      if (code >= 97 && code <= 122) return String.fromCodePoint(0x1d5ee + (code - 97));
      if (code >= 48 && code <= 57) return String.fromCodePoint(0x1d7ec + (code - 48));
      return char;
    })
    .join('');

const toUnicodeItalic = (text) =>
  Array.from(text || '')
    .map((char) => {
      const code = char.codePointAt(0);
      if (code >= 65 && code <= 90) return String.fromCodePoint(0x1d608 + (code - 65));
      if (code >= 97 && code <= 122) return String.fromCodePoint(0x1d622 + (code - 97));
      return char;
    })
    .join('');

const toUnicodeUnderline = (text) =>
  Array.from(text || '')
    .map((char) => (char === ' ' || char === '\n' ? char : `${char}\u0332`))
    .join('');

const fromUnicodeBold = (text) =>
  Array.from(text || '')
    .map((char) => {
      const code = char.codePointAt(0);
      if (code >= 0x1d5d4 && code <= 0x1d5ed) return String.fromCodePoint(65 + (code - 0x1d5d4));
      if (code >= 0x1d5ee && code <= 0x1d607) return String.fromCodePoint(97 + (code - 0x1d5ee));
      if (code >= 0x1d7ec && code <= 0x1d7f5) return String.fromCodePoint(48 + (code - 0x1d7ec));
      return char;
    })
    .join('');

const fromUnicodeItalic = (text) =>
  Array.from(text || '')
    .map((char) => {
      const code = char.codePointAt(0);
      if (code >= 0x1d608 && code <= 0x1d621) return String.fromCodePoint(65 + (code - 0x1d608));
      if (code >= 0x1d622 && code <= 0x1d63b) return String.fromCodePoint(97 + (code - 0x1d622));
      return char;
    })
    .join('');

const removeUnicodeUnderline = (text) => String(text || '').replace(/\u0332/g, '');
const normalizeStyledTextToPlain = (text) =>
  fromUnicodeItalic(fromUnicodeBold(removeUnicodeUnderline(text)));

const RichTextTextarea = ({
  value = '',
  onChange,
  placeholder = '',
  className = '',
  rows = 4,
  disabled = false,
  maxLength,
  style,
}) => {
  const textareaRef = useRef(null);

  const emitValue = (nextValue) => {
    if (typeof onChange === 'function') {
      onChange(nextValue);
    }
  };

  const replaceSelection = (transformer) => {
    const textarea = textareaRef.current;
    if (!textarea || disabled) {
      return;
    }

    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? start;
    if (end <= start) {
      return;
    }

    const selectedText = value.slice(start, end);
    const replacement = transformer(selectedText);
    if (typeof replacement !== 'string') {
      return;
    }

    const nextValue = `${value.slice(0, start)}${replacement}${value.slice(end)}`;
    emitValue(nextValue);

    requestAnimationFrame(() => {
      textarea.focus();
      const nextCursorEnd = start + replacement.length;
      textarea.setSelectionRange(start, nextCursorEnd);
    });
  };

  const handleValueChange = (event) => {
    let nextValue = event.target.value;
    if (typeof maxLength === 'number' && maxLength > 0 && nextValue.length > maxLength) {
      nextValue = nextValue.slice(0, maxLength);
    }
    emitValue(nextValue);
  };

  const toggleBold = (selectedText) => {
    const normalized = normalizeStyledTextToPlain(selectedText);
    const fullyBold = toUnicodeBold(normalized) === selectedText;
    return fullyBold ? normalized : toUnicodeBold(normalized);
  };

  const toggleItalic = (selectedText) => {
    const normalized = normalizeStyledTextToPlain(selectedText);
    const fullyItalic = toUnicodeItalic(normalized) === selectedText;
    return fullyItalic ? normalized : toUnicodeItalic(normalized);
  };

  const toggleUnderline = (selectedText) => {
    const normalized = normalizeStyledTextToPlain(selectedText);
    const fullyUnderlined = toUnicodeUnderline(normalized) === selectedText;
    return fullyUnderlined ? normalized : toUnicodeUnderline(selectedText);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-1">
        <button
          type="button"
          onClick={() => replaceSelection(toggleBold)}
          onMouseDown={(e) => e.preventDefault()}
          disabled={disabled}
          className="rounded p-1.5 text-gray-700 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
          title="Bold selected text"
        >
          <Bold className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => replaceSelection(toggleItalic)}
          onMouseDown={(e) => e.preventDefault()}
          disabled={disabled}
          className="rounded p-1.5 text-gray-700 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
          title="Italic selected text"
        >
          <Italic className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => replaceSelection(toggleUnderline)}
          onMouseDown={(e) => e.preventDefault()}
          disabled={disabled}
          className="rounded p-1.5 text-gray-700 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
          title="Underline selected text"
        >
          <Underline className="h-4 w-4" />
        </button>
      </div>

      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleValueChange}
        placeholder={placeholder}
        className={className}
        style={style}
        rows={rows}
        disabled={disabled}
      />
    </div>
  );
};

export default RichTextTextarea;
