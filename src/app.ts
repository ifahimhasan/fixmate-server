import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { HttpError } from "./utils/http";
import servicesRouter from "./routes/services";
import bookingsRouter from "./routes/bookings";
import paymentsRouter from "./routes/payments";
import webhookRouter from "./routes/webhook";
import adminRouter from "./routes/admin";
import usersRouter from "./routes/users";
import uploadRouter from "./routes/upload";

const app = express();

const allowed = (process.env.CLIENT_URLS || "http://localhost:3000")
  .split(",")
  .map((o) => o.trim().replace(/\/$/, ""))
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      // allow server-to-server / curl (no origin) and listed client origins
      if (!origin || allowed.includes(origin.replace(/\/$/, ""))) return cb(null, true);
      return cb(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
  })
);

app.get("/", (_req, res) => {
  res.json({ name: "FixMate API", status: "ok" });
});

// Stripe webhook must read the raw body, so it goes before express.json()
app.use("/api/payments/webhook", webhookRouter);
app.use(express.json({ limit: "10mb" }));
app.use("/api/services", servicesRouter);
app.use("/api/bookings", bookingsRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/users", usersRouter);
app.use("/api/upload", uploadRouter);

// 404 for unknown API routes
app.use((_req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// Central error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ message: status === 500 ? "Something went wrong" : err.message });
});

export default app;
