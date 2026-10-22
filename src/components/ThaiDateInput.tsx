import React, { useCallback, useEffect, useRef, useState } from 'react';

type NativeDateProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
  value: string;
  onChange: React.ChangeEventHandler<HTMLInputElement>;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REQUIRED_MESSAGE = 'กรุณาเลือกวันที่';

function toThaiDisplay(value: string): string {
  if (!DATE_RE.test(value)) return '';
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${Number(year) + 543}`;
}

function setNativeValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (setter) {
    setter.call(input, value);
  } else {
    input.value = value;
  }
}

function fireNativeChange(input: HTMLInputElement, value: string) {
  setNativeValue(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Drop-in replacement for <input type="date">.
 * Displays dd/mm/พ.ศ. (Buddhist year) while the value/onChange contract stays
 * 'YYYY-MM-DD' (or '' when empty), exactly like a native date input.
 */
export const ThaiDateInput: React.FC<NativeDateProps> = ({
  id,
  name,
  value,
  onChange,
  className,
  style,
  required,
  min,
  max,
  disabled,
  placeholder,
  ...rest
}) => {
  const visibleRef = useRef<HTMLInputElement>(null);
  const nativeRef = useRef<HTMLInputElement>(null);
  const [pickerOpenMode, setPickerOpenMode] = useState(false);

  // required must actually block submission. A readOnly input is "barred
  // from constraint validation" per the HTML spec, so the visible field is
  // kept editable (typing is blocked via key/paste handlers instead) and
  // required + setCustomValidity live here, not on the hidden native input.
  useEffect(() => {
    const el = visibleRef.current;
    if (!el) return;
    el.setCustomValidity(required && !disabled && !value ? REQUIRED_MESSAGE : '');
  }, [required, disabled, value]);

  const openPicker = useCallback(() => {
    const native = nativeRef.current;
    if (!native || disabled) return;
    let opened = false;
    try {
      if (typeof native.showPicker === 'function') {
        native.showPicker();
        opened = true;
      }
    } catch {
      opened = false;
    }
    if (!opened) {
      // Firefox / older iOS Safari: showPicker is missing or throws outside
      // a trusted gesture. Fall back to focusing/clicking the native input,
      // making it briefly visible/interactive so the OS control can anchor.
      setPickerOpenMode(true);
      native.focus();
      native.click();
    }
  }, [disabled]);

  const closePickerFallback = useCallback(() => setPickerOpenMode(false), []);

  const clearValue = useCallback(() => {
    if (disabled) return;
    const native = nativeRef.current;
    if (!native) return;
    fireNativeChange(native, '');
    visibleRef.current?.focus();
  }, [disabled]);

  const handleVisibleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      openPicker();
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      if (value) clearValue();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Block free typing (the field is display-only); non-character keys
    // (arrows, Tab, Home/End, Escape, etc.) pass through untouched.
    if (e.key.length === 1) {
      e.preventDefault();
    }
  };

  const showClear = !required && !disabled && !!value;

  return (
    <span style={{ position: 'relative', display: 'block' }}>
      <input
        {...rest}
        ref={visibleRef}
        id={id}
        type="text"
        inputMode="none"
        autoComplete="off"
        className={className}
        style={{ ...style, paddingRight: showClear ? 26 : style?.paddingRight, cursor: disabled ? 'not-allowed' : 'pointer' }}
        value={toThaiDisplay(value)}
        placeholder={placeholder ?? 'วว/ดด/ปปปป'}
        required={required}
        disabled={disabled}
        aria-required={required || undefined}
        onChange={() => { /* controlled via the hidden native date input */ }}
        onClick={openPicker}
        onKeyDown={handleVisibleKeyDown}
        onBeforeInput={e => e.preventDefault()}
        onPaste={e => e.preventDefault()}
      />
      {showClear && (
        <button
          type="button"
          aria-label="ล้างวันที่"
          tabIndex={-1}
          onClick={e => {
            e.preventDefault();
            e.stopPropagation();
            clearValue();
          }}
          style={{
            position: 'absolute',
            right: 2,
            top: '50%',
            transform: 'translateY(-50%)',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
            padding: '2px 6px',
            color: 'var(--text-secondary, #888)',
          }}
        >
          ×
        </button>
      )}
      <input
        ref={nativeRef}
        type="date"
        name={name}
        tabIndex={-1}
        aria-hidden="true"
        value={value}
        onChange={onChange}
        onBlur={closePickerFallback}
        min={min}
        max={max}
        disabled={disabled}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          margin: 0,
          border: 'none',
          background: 'transparent',
          opacity: pickerOpenMode ? 1 : 0,
          pointerEvents: pickerOpenMode ? 'auto' : 'none',
        }}
      />
    </span>
  );
};

export default ThaiDateInput;
