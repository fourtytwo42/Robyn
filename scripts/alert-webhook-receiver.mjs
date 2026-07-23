#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const host = process.env.ROBYN_ALERT_RECEIVER_HOST ?? "127.0.0.1";
const port = Number(process.env.ROBYN_ALERT_RECEIVER_PORT ?? "9094");
const logPath =
  process.env.ROBYN_ALERT_LOG ?? "/var/lib/robyn/alerts/deliveries.jsonl";
const maximumBytes = 1_048_576;
fs.mkdirSync(path.dirname(logPath), { recursive: true, mode: 0o750 });

function respond(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  response.end(`${JSON.stringify(body)}\n`);
}

const server = http.createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    respond(response, 200, { service: "robyn-alert-receiver", status: "ok" });
    return;
  }
  if (request.method !== "POST" || request.url !== "/alerts") {
    respond(response, 404, { error: "not_found" });
    return;
  }

  let size = 0;
  const chunks = [];
  request.on("data", (chunk) => {
    size += chunk.length;
    if (size > maximumBytes) request.destroy();
    else chunks.push(chunk);
  });
  request.on("end", () => {
    try {
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!Array.isArray(payload.alerts)) throw new Error("alerts missing");
      const receivedAt = new Date().toISOString();
      for (const alert of payload.alerts) {
        const entry = {
          schemaVersion: 1,
          receivedAt,
          status: alert.status,
          alertname: alert.labels?.alertname,
          labels: alert.labels ?? {},
          annotations: alert.annotations ?? {},
          startsAt: alert.startsAt,
          endsAt: alert.endsAt,
          fingerprint: alert.fingerprint,
        };
        fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, {
          encoding: "utf8",
          mode: 0o640,
        });
      }
      respond(response, 200, { accepted: payload.alerts.length });
    } catch (error) {
      respond(response, 400, {
        error: "invalid_alert_payload",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
});

server.requestTimeout = 5_000;
server.headersTimeout = 5_000;
server.listen(port, host, () => {
  process.stdout.write(
    `${JSON.stringify({ event: "listening", host, port, logPath })}\n`,
  );
});
