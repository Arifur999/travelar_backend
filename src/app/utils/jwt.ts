import jwt, { JwtPayload, SignOptions } from "jsonwebtoken";

type VerifyTokenSuccess = { success: true; decoded: JwtPayload; message: string };
type VerifyTokenFailure = { success: false; decoded?: undefined; message: string; error: unknown };

const createToken = (payload: object, secret: string, expiresIn: string) =>
  jwt.sign(payload, secret, { expiresIn } as SignOptions);

// Returns a discriminated result rather than throwing, so callers branch
// instead of wrapping every check in a try/catch.
const verifyToken = (token: string, secret: string): VerifyTokenSuccess | VerifyTokenFailure => {
  try {
    return { success: true, decoded: jwt.verify(token, secret) as JwtPayload, message: "Token is valid" };
  } catch (error) {
    return { success: false, message: "Invalid or expired token", error };
  }
};

const decodeToken = (token: string) => jwt.decode(token) as JwtPayload | null;

export const jwtUtils = { createToken, verifyToken, decodeToken };
