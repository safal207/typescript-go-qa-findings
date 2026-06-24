import { formatUser, type User } from "@qa-lab/core";

const user: User = {
  id: "u_1",
  name: "Ada"
};

export const label = formatUser(user);
