import { type ErrorRequestHandler } from "express";

interface PgErrorInfo {
  code?: string;
  constraint?: string;
  table?: string;
}

function extractPgError(err: unknown): PgErrorInfo {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current != null; depth++) {
    if (typeof current === "object") {
      const candidate = current as Record<string, unknown>;
      if (typeof candidate.code === "string") {
        return {
          code: candidate.code,
          constraint:
            typeof candidate.constraint === "string" ? candidate.constraint : undefined,
          table: typeof candidate.table === "string" ? candidate.table : undefined,
        };
      }
      current = candidate.cause;
    } else {
      break;
    }
  }
  return {};
}

function uniqueViolationMessage(info: PgErrorInfo): string {
  const target = `${info.constraint ?? ""} ${info.table ?? ""}`.toLowerCase();
  if (target.includes("client") && target.includes("code")) {
    return "A client with this code already exists.";
  }
  if (target.includes("client")) {
    return "A client with these details already exists.";
  }
  return "A record with these details already exists.";
}

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  req.log?.error({ err }, "Unhandled route error");

  if (
    err instanceof Error &&
    (err as { type?: string }).type === "entity.parse.failed"
  ) {
    res.status(400).json({ error: "Invalid JSON in request body." });
    return;
  }

  const info = extractPgError(err);

  if (info.code === "23505") {
    res.status(409).json({ error: uniqueViolationMessage(info) });
    return;
  }

  if (info.code === "23503") {
    res.status(409).json({
      error: "This record is referenced by other data and cannot be modified.",
    });
    return;
  }

  res.status(500).json({ error: "An unexpected error occurred. Please try again." });
};
