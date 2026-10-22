import React, { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timeoutRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const remove = useCallback((id: string) => {
    const timeout = timeoutRef.current.get(id);
    if (timeout) {
      clearTimeout(timeout);
      timeoutRef.current.delete(id);
    }
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const duplicate = toasts.find(toast => toast.message === message && toast.type === type);
    if (duplicate) return;
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, message, type }].slice(-3));
    // Errors and warnings need time to read (often while holding a robot); others stay brief.
    timeoutRef.current.set(id, setTimeout(() => remove(id), type === 'error' || type === 'warning' ? 8000 : 3200));
  }, [remove, toasts]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div role="status" aria-live="polite" style={{
        position: 'fixed', bottom: '1.5rem', right: '0.75rem',
        display: 'flex', flexDirection: 'column', gap: '0.5rem', zIndex: 9999,
        maxWidth: '360px', width: 'calc(100% - 1.5rem)'
      }}>
        {toasts.map(toast => (
          <div key={toast.id} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)',
            fontSize: '0.875rem', fontWeight: 500,
            animation: 'slideInRight 0.14s ease',
            color: '#fff',
            background: toast.type === 'success' ? 'rgba(16,185,129,0.95)'
              : toast.type === 'error' ? 'rgba(239,68,68,0.95)'
              : toast.type === 'warning' ? 'rgba(245,158,11,0.95)'
              : 'rgba(59,130,246,0.95)',
            boxShadow: '0 4px 12px rgba(30,58,138,0.25)',
            willChange: 'transform, opacity',
          }}>
            <span>{toast.message}</span>
            <button onClick={() => remove(toast.id)} style={{
              background: 'none', border: 'none', color: 'rgba(255,255,255,0.9)',
              cursor: 'pointer', marginLeft: '0.75rem', fontSize: '1rem', lineHeight: 1
            }}>×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
};
