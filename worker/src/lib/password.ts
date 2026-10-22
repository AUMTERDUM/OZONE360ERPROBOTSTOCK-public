// Password policy — returns null if OK, otherwise an error message.
export function validatePasswordPolicy(pwd: string): string | null {
  if (!pwd || typeof pwd !== 'string') return 'Password is required';
  if (pwd.length < 8) return 'Password must be at least 8 characters';
  if (pwd.length > 128) return 'Password must not exceed 128 characters';
  if (!/[a-z]/.test(pwd)) return 'Password must contain at least one lowercase letter';
  if (!/[A-Z]/.test(pwd)) return 'Password must contain at least one uppercase letter';
  if (!/[0-9]/.test(pwd)) return 'Password must contain at least one digit';
  return null;
}
