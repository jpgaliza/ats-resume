import type { Pool as PgPool } from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import { EventEmitter } from "node:events";
import { mkdirSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { Pool } from "pg";
import { env } from "@reactive-resume/env/server";
import { findWorkspaceRoot } from "@reactive-resume/utils/monorepo.node";
import { authRelations } from "./schema/auth";

const createPgDatabase = (pool: PgPool) => drizzlePg({ client: pool, relations: authRelations });
type DatabaseInstance = ReturnType<typeof createPgDatabase>;

const requestDatabase = new AsyncLocalStorage<{ pool: PgPool; database: DatabaseInstance }>();
const activeTransactionStorage = new AsyncLocalStorage<unknown>();

declare global {
	var __pool: PgPool | undefined;
	var __pglite: PGlite | undefined;
	var __drizzle: DatabaseInstance | undefined;
}

const isPgliteUrl = () => env.DATABASE_URL.startsWith("pglite://");

function resolvePgliteDataDir(databaseUrl: string): string | undefined {
	const rawPath = databaseUrl.slice("pglite://".length).trim();
	if (!rawPath || rawPath === "memory" || rawPath === ":memory:") return undefined;
	const baseDir = findWorkspaceRoot() ?? process.cwd();
	const target = isAbsolute(rawPath) ? rawPath : resolve(baseDir, rawPath);
	mkdirSync(target, { recursive: true });
	return target;
}

export function getPglite(): PGlite {
	if (!globalThis.__pglite) {
		const dataDir = resolvePgliteDataDir(env.DATABASE_URL);
		globalThis.__pglite = dataDir ? new PGlite(dataDir) : new PGlite();
	}
	return globalThis.__pglite;
}

function createPglitePool(pglite: PGlite): PgPool {
	return {
		query: (text: string, values?: unknown[]) => pglite.query(text, values),
		connect: async () => {
			await pglite.waitReady;
			const emitter = new EventEmitter();
			const unsubscribes = new Map<string, () => Promise<void>>();
			return {
				on: (event: string, listener: (...args: unknown[]) => void) => {
					emitter.on(event, listener);
				},
				off: (event: string, listener: (...args: unknown[]) => void) => {
					emitter.off(event, listener);
				},
				query: async (text: string, values?: unknown[]) => {
					const listenMatch = /^\s*LISTEN\s+([a-zA-Z0-9_"]+)\s*;?\s*$/i.exec(text);
					if (listenMatch?.[1]) {
						const channel = listenMatch[1].replaceAll('"', "");
						if (!unsubscribes.has(channel)) {
							const unsub = await pglite.listen(channel, (payload) => {
								emitter.emit("notification", { channel, payload });
							});
							unsubscribes.set(channel, unsub);
						}
						return { rows: [], fields: [], affectedRows: 0 };
					}

					const unlistenMatch = /^\s*UNLISTEN\s+([a-zA-Z0-9_"]+|\*)\s*;?\s*$/i.exec(text);
					if (unlistenMatch?.[1]) {
						const channel = unlistenMatch[1].replaceAll('"', "");
						if (channel === "*") {
							await Promise.all([...unsubscribes.values()].map((unsub) => unsub().catch(() => {})));
							unsubscribes.clear();
						} else {
							const unsub = unsubscribes.get(channel);
							if (unsub) {
								await unsub().catch(() => {});
								unsubscribes.delete(channel);
							}
						}
						return { rows: [], fields: [], affectedRows: 0 };
					}

					return pglite.query(text, values);
				},
				release: () => {
					for (const unsub of unsubscribes.values()) {
						void unsub().catch(() => {});
					}
					unsubscribes.clear();
					emitter.removeAllListeners();
				},
			};
		},
		end: async () => {},
		on: () => {},
	} as unknown as PgPool;
}

export function getPool(): PgPool {
	const request = requestDatabase.getStore();
	if (request) return request.pool;
	if (!globalThis.__pool) {
		if (isPgliteUrl()) {
			globalThis.__pool = createPglitePool(getPglite());
			return globalThis.__pool;
		}
		const pool = new Pool({
			connectionString: env.DATABASE_URL,
			max: env.DATABASE_POOL_MAX,
			connectionTimeoutMillis: 10_000,
			idleTimeoutMillis: 10_000,
		});
		const logPgError = (error: unknown) => {
			console.error("[db] postgres connection error:", error);
		};
		pool.on("error", logPgError);
		pool.on("connect", (client) => {
			client.on("error", logPgError);
		});
		globalThis.__pool = pool;
	}
	return globalThis.__pool;
}

function getBaseDatabase(): DatabaseInstance {
	if (!globalThis.__drizzle) {
		globalThis.__drizzle = isPgliteUrl()
			? (drizzlePglite({ client: getPglite(), relations: authRelations }) as unknown as DatabaseInstance)
			: createPgDatabase(getPool());
	}
	return globalThis.__drizzle;
}

/** Workers must create sockets inside a request and cannot reuse them in another request. */
export function withDatabasePool<T>(pool: PgPool, callback: () => T): T {
	return requestDatabase.run({ pool, database: createPgDatabase(pool) }, callback);
}

function currentDatabase(): DatabaseInstance {
	const activeTx = activeTransactionStorage.getStore() as DatabaseInstance | undefined;
	return activeTx ?? requestDatabase.getStore()?.database ?? getBaseDatabase();
}

const proxyTarget = {
	select: (...args: unknown[]) => (currentDatabase().select as (...a: unknown[]) => unknown)(...args),
	selectDistinct: (...args: unknown[]) => (currentDatabase().selectDistinct as (...a: unknown[]) => unknown)(...args),
	selectDistinctOn: (...args: unknown[]) =>
		(currentDatabase().selectDistinctOn as (...a: unknown[]) => unknown)(...args),
	insert: (...args: unknown[]) => (currentDatabase().insert as (...a: unknown[]) => unknown)(...args),
	update: (...args: unknown[]) => (currentDatabase().update as (...a: unknown[]) => unknown)(...args),
	delete: (...args: unknown[]) => (currentDatabase().delete as (...a: unknown[]) => unknown)(...args),
	execute: (...args: unknown[]) => (currentDatabase().execute as (...a: unknown[]) => unknown)(...args),
	transaction: (
		callback: Parameters<DatabaseInstance["transaction"]>[0],
		config?: Parameters<DatabaseInstance["transaction"]>[1],
	) => {
		const activeTx = activeTransactionStorage.getStore() as DatabaseInstance | undefined;
		if (activeTx) {
			return activeTx.transaction(callback, config);
		}
		return currentDatabase().transaction((tx) => activeTransactionStorage.run(tx, () => callback(tx)), config);
	},
} as unknown as DatabaseInstance;

export const db: DatabaseInstance = new Proxy(proxyTarget, {
	get(target, property, receiver) {
		if (Object.hasOwn(target, property)) {
			return Reflect.get(target, property, receiver);
		}
		const database = currentDatabase();
		const value = Reflect.get(database, property, database) as unknown;
		return typeof value === "function" ? value.bind(database) : value;
	},
});

/** The client, or a transaction on it: helpers that write take either, so callers choose the transaction. */
export type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
