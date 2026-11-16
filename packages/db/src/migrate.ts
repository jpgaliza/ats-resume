import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { env } from "@reactive-resume/env/server";
import { getPglite } from "./client";

function resolveMigrationsFolder(): string {
	let dir = dirname(fileURLToPath(import.meta.url));
	while (dir !== dirname(dir)) {
		const candidate = join(dir, "migrations");
		if (existsSync(candidate)) return candidate;
		dir = dirname(dir);
	}
	throw new Error("Could not locate migrations folder.");
}

async function runPgliteMigrations(migrationsFolder: string): Promise<void> {
	const pglite = getPglite();
	await pglite.waitReady;

	// PGlite simple-query `.exec()` executes multi-statement migration chunks that lack
	// `--> statement-breakpoint` markers without triggering extended-protocol parse error 42601.
	await pglite.exec(`
		CREATE SCHEMA IF NOT EXISTS "drizzle";
		CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
			id SERIAL PRIMARY KEY,
			hash text NOT NULL,
			created_at bigint,
			name text,
			applied_at timestamp with time zone DEFAULT now()
		);
		ALTER TABLE "drizzle"."__drizzle_migrations" ADD COLUMN IF NOT EXISTS "name" text;
		ALTER TABLE "drizzle"."__drizzle_migrations" ADD COLUMN IF NOT EXISTS "applied_at" timestamp with time zone DEFAULT now();
	`);

	const existing = await pglite.query<{ hash: string; name: string | null }>(
		'SELECT hash, name FROM "drizzle"."__drizzle_migrations"',
	);
	const appliedNames = new Set(existing.rows.map((row) => row.name).filter((n): n is string => Boolean(n)));
	const appliedHashes = new Set(existing.rows.map((row) => row.hash));

	const localMigrations = readMigrationFiles({ migrationsFolder });
	const pending = localMigrations.filter((migration) =>
		migration.name
			? !appliedNames.has(migration.name) && !appliedHashes.has(migration.hash)
			: !appliedHashes.has(migration.hash),
	);
	if (pending.length === 0) return;

	await pglite.exec("BEGIN");
	try {
		for (const migration of pending) {
			for (const statement of migration.sql) {
				const trimmed = statement.trim();
				if (trimmed.length > 0) {
					await pglite.exec(trimmed);
				}
			}
			await pglite.query(
				'INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at", "name") VALUES ($1, $2, $3)',
				[migration.hash, migration.folderMillis, migration.name ?? null],
			);
		}
		await pglite.exec("COMMIT");
	} catch (error) {
		await pglite.exec("ROLLBACK").catch(() => {});
		throw error;
	}
}

export async function runMigrations(migrationsFolder = resolveMigrationsFolder()): Promise<void> {
	if (env.DATABASE_URL.startsWith("pglite://")) {
		await runPgliteMigrations(migrationsFolder);
		return;
	}

	const pool = new Pool({
		connectionString: env.DATABASE_MIGRATION_URL ?? env.DATABASE_URL,
		max: 1,
		connectionTimeoutMillis: 10_000,
	});
	try {
		await migratePg(drizzle({ client: pool }), { migrationsFolder });
	} finally {
		await pool.end();
	}
}
