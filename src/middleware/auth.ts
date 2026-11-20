import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { collections } from "../config/db";

export type Role = "customer" | "technician" | "admin";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  image?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * verifyToken - reads `Authorization: Bearer <jwt>`, verifies it with JWT_SECRET
 * (the same secret the Next.js client uses to sign it), then loads the user from
 * the database so the role is always the current one (admin role changes apply
 * immediately). Missing / invalid token → 401.
 */
export async function verifyToken(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ message: "Unauthorized: token missing" });

  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET as string) as jwt.JwtPayload;
  } catch {
    return res.status(401).json({ message: "Unauthorized: invalid or expired token" });
  }

  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
  if (!email) return res.status(401).json({ message: "Unauthorized: invalid token" });

  try {
    const { users } = await collections();
    const user = await users.findOne({ email });
    if (!user) return res.status(401).json({ message: "Unauthorized: user not found" });
    req.user = {
      id: String(user._id),
      email: user.email,
      name: user.name,
      role: (user.role as Role) || "customer",
      image: user.image || "",
    };
    next();
  } catch (err) {
    next(err);
  }
}

/** Role guard factory - a valid user with the wrong role gets 403. */
const requireRole =
  (role: Role) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });
    if (req.user.role !== role) {
      return res.status(403).json({ message: `Forbidden: ${role} access only` });
    }
    next();
  };

export const verifyCustomer = requireRole("customer");
export const verifyTechnician = requireRole("technician");
export const verifyAdmin = requireRole("admin");
