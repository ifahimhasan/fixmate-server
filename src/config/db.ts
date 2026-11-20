import { MongoClient, Db, Collection, Document } from "mongodb";

const uri = process.env.MONGODB_URI as string;
const dbName = process.env.DB_NAME || "fixmate";

// Cache the client across serverless invocations (Vercel) and hot reloads.
const globalForMongo = globalThis as unknown as { _mongoClient?: MongoClient; _mongoReady?: Promise<MongoClient> };

export async function getDb(): Promise<Db> {
  if (!uri) throw new Error("MONGODB_URI is not set");
  if (!globalForMongo._mongoReady) {
    globalForMongo._mongoClient = new MongoClient(uri);
    globalForMongo._mongoReady = globalForMongo._mongoClient.connect().then(async (client) => {
      await ensureIndexes(client.db(dbName));
      return client;
    });
  }
  const client = await globalForMongo._mongoReady;
  return client.db(dbName);
}

/**
 * The 4 FixMate collections. BetterAuth stores users in its own `user`
 * collection - we treat it as our `users` collection.
 */
export async function collections() {
  const db = await getDb();
  return {
    users: db.collection("user") as Collection<Document>,
    services: db.collection("services") as Collection<Document>,
    bookings: db.collection("bookings") as Collection<Document>,
    payments: db.collection("payments") as Collection<Document>,
  };
}

async function ensureIndexes(db: Db) {
  try {
    await Promise.all([
      db.collection("payments").createIndex({ stripeSessionId: 1 }, { unique: true }),
      db.collection("payments").createIndex({ bookingId: 1 }, { unique: true }),
      db.collection("services").createIndex({ approvalStatus: 1, isAvailable: 1, createdAt: -1 }),
      db.collection("services").createIndex({ technicianEmail: 1 }),
      db.collection("bookings").createIndex({ customerEmail: 1 }),
      db.collection("bookings").createIndex({ technicianEmail: 1 }),
      db.collection("bookings").createIndex({ serviceId: 1, customerEmail: 1, status: 1 }),
    ]);
  } catch (err) {
    console.error("Index creation failed", err);
  }
}
