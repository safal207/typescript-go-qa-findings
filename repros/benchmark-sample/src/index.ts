type Primitive = string | number | boolean | null;

type JsonValue = Primitive | JsonValue[] | { [key: string]: JsonValue };

type DeepReadonly<T> = T extends Primitive
  ? T
  : T extends Array<infer U>
    ? ReadonlyArray<DeepReadonly<U>>
    : { readonly [K in keyof T]: DeepReadonly<T[K]> };

type ApiEnvelope<TData, TMeta extends Record<string, JsonValue> = Record<string, JsonValue>> = {
  data: TData;
  meta: TMeta;
  included?: Array<{ type: string; id: string; attributes: Record<string, JsonValue> }>;
};

type User = {
  id: string;
  name: string;
  flags: Array<"active" | "staff" | "beta">;
  profile: {
    email?: string;
    timezone: string;
    settings: Record<string, JsonValue>;
  };
};

type UserEnvelope = ApiEnvelope<User, { source: "benchmark"; page: number }>;

function freezeEnvelope<T>(envelope: T): DeepReadonly<T> {
  return envelope as DeepReadonly<T>;
}

const userEnvelope: UserEnvelope = {
  data: {
    id: "u_1",
    name: "Ada",
    flags: ["active", "beta"],
    profile: {
      timezone: "UTC",
      settings: {
        theme: "dark",
        score: 42
      }
    }
  },
  meta: {
    source: "benchmark",
    page: 1
  }
};

const frozen = freezeEnvelope(userEnvelope);

console.log(frozen.data.id);
