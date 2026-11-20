import "dotenv/config";
import app from "./app";
import { getDb } from "./config/db";

const port = Number(process.env.PORT) || 5000;

getDb()
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection failed", err));

app.listen(port, () => {
  console.log(`FixMate API running on http://localhost:${port}`);
});
