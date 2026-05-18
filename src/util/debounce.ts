export function debounce<T extends (...a: any[]) => void>(
  fn: T,
  ms: number,
): T & { cancel(): void } {
  let t: NodeJS.Timeout | undefined;
  const wrapped = ((...args: any[]) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  }) as T & { cancel(): void };
  wrapped.cancel = () => {
    if (t) clearTimeout(t);
  };
  return wrapped;
}
