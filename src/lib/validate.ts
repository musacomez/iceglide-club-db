// Küçük, bağımlılıksız doğrulama yardımcıları (yazma endpoint'leri için).

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function isValidTime(value: unknown): value is string {
  return typeof value === 'string' && TIME_RE.test(value);
}

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}

export function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function timeToMinutes(t: string): number {
  const [h = 0, m = 0] = t.split(':').map(Number);
  return h * 60 + m;
}

export function addDaysISO(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

export function uniqueInts(values: unknown): number[] | null {
  if (!Array.isArray(values)) return null;
  if (!values.every(isPositiveInt)) return null;
  return Array.from(new Set(values as number[]));
}

export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
