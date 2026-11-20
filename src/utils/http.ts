import { Request, Response, NextFunction, RequestHandler } from "express";
import { ObjectId } from "mongodb";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Wrap async route handlers so thrown errors reach the error middleware. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function toObjectId(id: string): ObjectId {
  if (!ObjectId.isValid(id)) throw new HttpError(400, "Invalid id");
  return new ObjectId(id);
}

export function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
