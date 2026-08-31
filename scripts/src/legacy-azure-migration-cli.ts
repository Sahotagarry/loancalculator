import { open, readFile, unlink, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { BlobServiceClient } from "@azure/storage-blob";
import {
  dryRun,
  humanReport,
  inventory,
  migrate,
  MigrationUnsafeError,
  type MigrationInput,
  type Reconciliation,
} from "./legacy-azure-migration.js";
import { PgLegacyMigrationStore } from "./pg-legacy-migration-store.js";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}
export function reportContents(result: Reconciliation | Awaited<ReturnType<typeof inventory>>) {
  return {
    json: `${JSON.stringify(result, (_key, value) => Buffer.isBuffer(value) ? `<${value.length} bytes>` : value, 2)}\n`,
    human: `${humanReport(result)}\n`,
  };
}
export async function reserveReportFiles(jsonPath: string, humanPath: string): Promise<void> {
  // Exclusive reservation happens before opening the database transaction.
  // It prevents a commit without a unique audit destination.
  const json = await open(jsonPath, "wx");
  try {
    const human = await open(humanPath, "wx");
    await human.close();
  } catch (error) {
    await json.close(); await unlink(jsonPath).catch(() => {});
    throw error;
  }
  await json.close();
}
export async function writeSyncedReports(jsonPath: string, humanPath: string, result: Reconciliation | Awaited<ReturnType<typeof inventory>>): Promise<void> {
  const contents = reportContents(result);
  for (const [path, content] of [[jsonPath, contents.json], [humanPath, contents.human]] as const) {
    const file = await open(path, "w");
    try { await file.writeFile(content); await file.sync(); } finally { await file.close(); }
  }
}

async function main() {
  const command = process.argv[2];
  if (!["inventory", "dry-run", "migrate"].includes(command)) {
    throw new Error("Usage: legacy-data <inventory|dry-run|migrate> [--config file] [--json file] [--human file]");
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const jsonPath = option("--json");
  const humanPath = option("--human");
  if (command === "migrate" && (!jsonPath || !humanPath)) {
    throw new Error("migrate requires both --json and --human audit report paths");
  }
  if (command === "migrate") await reserveReportFiles(jsonPath!, humanPath!);
  const store = new PgLegacyMigrationStore(connectionString);
  let reportsWritten = false;
  try {
    let result: Reconciliation | Awaited<ReturnType<typeof inventory>>;
    if (command === "inventory") {
      result = await inventory(store);
    } else {
      const configPath = option("--config");
      if (!configPath) throw new Error("--config is required for dry-run and migrate");
      const input = JSON.parse(await readFile(configPath, "utf8")) as MigrationInput;
      const storageConnection = process.env.AZURE_STORAGE_CONNECTION_STRING;
      const container = process.env.AZURE_STORAGE_CONTAINER ?? "loan-documents";
      const readAzure = async (storageRef: string) => {
        if (!storageConnection) throw new Error("AZURE_STORAGE_CONNECTION_STRING is required for Azure documents");
        const blob = BlobServiceClient.fromConnectionString(storageConnection)
          .getContainerClient(container).getBlockBlobClient(storageRef);
        return await blob.exists() ? blob.downloadToBuffer() : null;
      };
      if (command === "dry-run") result = await dryRun(store, input, readAzure);
      else {
        try {
          result = await migrate(store, input, readAzure, async (report) => {
            await writeSyncedReports(jsonPath!, humanPath!, report);
          });
          // Set this only after transaction() returns successfully. If COMMIT
          // itself fails after the pre-commit write, finally removes reports
          // that would otherwise incorrectly claim a completed migration.
          reportsWritten = true;
        } catch (error) {
          if (error instanceof MigrationUnsafeError) {
            await writeSyncedReports(jsonPath!, humanPath!, error.report);
            reportsWritten = true;
            process.stderr.write(`${humanReport(error.report)}\n`);
            process.exitCode = 2;
            return;
          }
          throw error;
        }
      }
    }
    const { json, human } = reportContents(result);
    if (command !== "migrate") {
      if (jsonPath) await writeFile(jsonPath, json, { flag: "wx" }); else process.stdout.write(json);
      if (humanPath) await writeFile(humanPath, human, { flag: "wx" }); else process.stderr.write(human);
    }
    const safe = "plan" in result ? result.plan.safe : result.safe;
    if (!safe) process.exitCode = 2;
  } finally {
    await store.close();
    if (command === "migrate" && !reportsWritten) {
      await Promise.all([unlink(jsonPath!).catch(() => {}), unlink(humanPath!).catch(() => {})]);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(async (error) => {
  if (error instanceof MigrationUnsafeError) {
    process.stderr.write(`${humanReport(error.report)}\n`);
    process.stdout.write(`${JSON.stringify(error.report, null, 2)}\n`);
    process.exitCode = 2;
  } else {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
});