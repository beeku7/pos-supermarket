import { PrismaClient } from '@prisma/client';

// Singleton Prisma client.  In an Electron environment each process
// should reuse a single client instance to avoid exhausting the
// connection pool.  When testing this file can be mocked to
// replace the client with an in‑memory instance.
const prisma = new PrismaClient();

export default prisma;