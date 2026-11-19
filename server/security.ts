import {
  createHash,
  randomBytes,
  scrypt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
const scryptAsync = promisify(scrypt);
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function passwordCheck(password: string) {
  const salt = randomBytes(16);
  const expected = scryptSync(password, salt, 64);
  return async (value: string) =>
    timingSafeEqual((await scryptAsync(value, salt, 64)) as Buffer, expected);
}
export function parseToken(cookie: string | undefined) {
  return (
    cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("lottery_session="))
      ?.slice(16) ?? ""
  );
}
