import React, { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import RobotMascot from '../components/RobotMascot';
import { Modal } from '../components/UIUtils';

interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** If set, user must type this exact string to enable the confirm button */
  requireText?: string;
  /** Optional helper line shown below the message (e.g., warning details) */
  description?: string;
}

interface ConfirmState extends ConfirmOptions {
  message: string;
  resolve: (value: boolean) => void;
}

interface ConfirmContextType {
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextType | undefined>(undefined);

export const ConfirmProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, setState] = useState<ConfirmState | null>(null);
  const [typed, setTyped] = useState('');

  // Reset typed challenge whenever a new dialog opens
  useEffect(() => { setTyped(''); }, [state]);

  const confirm = useCallback((message: string, options?: ConfirmOptions): Promise<boolean> => {
    return new Promise(resolve => {
      setState({ message, resolve, ...options });
    });
  }, []);

  const challengeOk = !state?.requireText || typed.trim() === state.requireText;

  const handleConfirm = () => {
    if (!challengeOk) return;
    state?.resolve(true);
    setState(null);
  };

  const handleCancel = () => {
    state?.resolve(false);
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {state && (
        <Modal open={true} onClose={handleCancel} title={state.title} width={440}>
          <div
            id="confirm-description"
            style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', marginBottom: '1.25rem' }}
          >
            <RobotMascot
              scene={state.danger ? 'confirmDanger' : 'confirm'}
              size={72}
              style={{ flexShrink: 0, marginTop: -6 }}
              fallback={
                <div style={{
                  width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: state.danger ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)',
                  color: state.danger ? '#ef4444' : '#f59e0b',
                  fontSize: '1.25rem',
                  fontWeight: 700,
                }} aria-hidden="true">
                  {state.danger ? '!' : '?'}
                </div>
              }
            />
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5 }}>
              <div>{state.message}</div>
              {state.description && (
                <div style={{ marginTop: 6, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {state.description}
                </div>
              )}
            </div>
          </div>

          {state.requireText && (
            <div style={{ marginBottom: '1rem' }} aria-live="polite">
              <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 6 }} htmlFor="confirmcontext-typed">
                พิมพ์ <code style={{ background: 'var(--bg-tertiary)', padding: '1px 6px', borderRadius: 4, color: 'var(--status-danger)', fontWeight: 700 }}>{state.requireText}</code> เพื่อยืนยัน
              </label>
              <input id="confirmcontext-typed"
                type="text"
                className="form-control"
                value={typed}
                onChange={e => setTyped(e.target.value)}
                placeholder={state.requireText}
                autoComplete="off"
                spellCheck={false}
                aria-label="พิมพ์ข้อความยืนยัน"
              />
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-outline"
              onClick={handleCancel}
              style={{ minWidth: 80 }}
            >
              {state.cancelLabel || 'ยกเลิก'}
            </button>
            <button
              type="button"
              className={`btn ${state.danger ? 'btn-danger' : 'btn-primary'}`}
              onClick={handleConfirm}
              disabled={!challengeOk}
              style={{ minWidth: 80, opacity: challengeOk ? 1 : 0.5, cursor: challengeOk ? 'pointer' : 'not-allowed' }}
              autoFocus={!state.requireText}
            >
              {state.confirmLabel || 'ยืนยัน'}
            </button>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
};

export const useConfirm = () => {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx.confirm;
};
