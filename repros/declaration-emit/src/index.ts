export interface UserProfile {
  id: string;
  name: string;
  role?: "admin" | "user" | "guest";
  metadata?: Record<string, string | number | boolean>;
}

export type ApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } };

export type ReadonlyEntity<T extends { id: string }> = Readonly<T> & {
  readonly entityType: string;
};

export function createUserProfile(input: Pick<UserProfile, "id" | "name">): UserProfile {
  return {
    ...input,
    role: "user"
  };
}

export function mapApiResult<T, R>(
  result: ApiResult<T>,
  mapper: (value: T) => R
): ApiResult<R> {
  if (result.ok) {
    return { ok: true, value: mapper(result.value) };
  }

  return result;
}

export class UserStore<T extends UserProfile> {
  #items = new Map<string, T>();

  add(user: T): void {
    this.#items.set(user.id, user);
  }

  get(id: string): T | undefined {
    return this.#items.get(id);
  }
}
