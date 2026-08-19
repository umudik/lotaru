import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

export type LocalUser = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: string;
};

export type PublicLocalUser = {
  id: string;
  name: string;
  email: string;
  role: "admin";
  isSystemAdmin: true;
  createdAt: string;
};

type LocalUserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  is_system_admin: number;
  password_hash: string;
  created_at: string;
};

let db: Database.Database | null = null;

function openUsersDb(dataDir: string): Database.Database {
  if (db !== null) {
    return db;
  }
  const path = join(dataDir, "users.sqlite");
  mkdirSync(dirname(path), { recursive: true });
  const opened = new Database(path);
  opened.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      is_system_admin INTEGER NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  db = opened;
  return opened;
}

function mapRow(row: LocalUserRow): LocalUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
  };
}

export function hasLocalUsers(dataDir: string): boolean {
  const row = openUsersDb(dataDir).prepare("SELECT COUNT(*) AS count FROM users").get() as {
    count: number;
  };
  return row.count > 0;
}

export function countLocalUsers(dataDir: string): number {
  const row = openUsersDb(dataDir).prepare("SELECT COUNT(*) AS count FROM users").get() as {
    count: number;
  };
  return row.count;
}

export function toPublicLocalUser(user: LocalUser): PublicLocalUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: "admin",
    isSystemAdmin: true,
    createdAt: user.createdAt,
  };
}

export function listLocalUsers(dataDir: string): PublicLocalUser[] {
  const rows = openUsersDb(dataDir)
    .prepare("SELECT * FROM users ORDER BY created_at ASC")
    .all() as LocalUserRow[];
  return rows.map((row) => toPublicLocalUser(mapRow(row)));
}

export function createLocalUser(
  dataDir: string,
  params: {
    name: string;
    email: string;
    password: string;
  },
): LocalUser {
  const id = randomBytes(8).toString("hex");
  const email = params.email.trim().toLowerCase();
  const name = params.name.trim();
  const passwordHash = bcrypt.hashSync(params.password, 10);
  const createdAt = new Date().toISOString();
  openUsersDb(dataDir)
    .prepare(
      `INSERT INTO users (id, name, email, role, is_system_admin, password_hash, created_at)
       VALUES (?, ?, ?, 'admin', 1, ?, ?)`,
    )
    .run(id, name, email, passwordHash, createdAt);
  return {
    id,
    name,
    email,
    passwordHash,
    createdAt,
  };
}

export function deleteLocalUser(
  dataDir: string,
  id: string,
): { deleted: boolean; reason: string } {
  const existing = findLocalUserById(dataDir, id);
  if (existing === null) {
    return { deleted: false, reason: "User not found" };
  }
  if (countLocalUsers(dataDir) <= 1) {
    return { deleted: false, reason: "Cannot delete the last user" };
  }
  openUsersDb(dataDir).prepare("DELETE FROM users WHERE id = ?").run(id);
  return { deleted: true, reason: "" };
}

export function findLocalUserByEmail(dataDir: string, email: string): LocalUser | null {
  const row = openUsersDb(dataDir)
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email.trim().toLowerCase()) as LocalUserRow | undefined;
  if (row === undefined) {
    return null;
  }
  return mapRow(row);
}

export function findLocalUserById(dataDir: string, id: string): LocalUser | null {
  const row = openUsersDb(dataDir).prepare("SELECT * FROM users WHERE id = ?").get(id) as
    | LocalUserRow
    | undefined;
  if (row === undefined) {
    return null;
  }
  return mapRow(row);
}

export function verifyLocalPassword(user: LocalUser, password: string): boolean {
  return bcrypt.compareSync(password, user.passwordHash);
}
