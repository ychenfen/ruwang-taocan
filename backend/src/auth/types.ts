export type UserRole = "ADMIN" | "AGENT";

export type JwtUser = Readonly<{
  sub: string; // user id
  role: UserRole;
}>;

