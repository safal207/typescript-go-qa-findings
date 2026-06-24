export function formatUserId(id: string): string {
  return `user:${id}`;
}

const numericId: number = 42;

console.log(formatUserId(numericId));
