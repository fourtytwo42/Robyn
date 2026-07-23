export function processRestartChanges(baselineProcesses, currentProcesses) {
  const baselineByName = new Map(
    baselineProcesses.map((processEntry) => [
      processEntry.name,
      processEntry.restartCount,
    ]),
  );
  const currentByName = new Map(
    currentProcesses.map((processEntry) => [
      processEntry.name,
      processEntry.restartCount,
    ]),
  );
  const changes = [];

  for (const [name, baselineCount] of baselineByName) {
    const currentCount = currentByName.get(name);
    if (currentCount === undefined) {
      changes.push(`${name} disappeared`);
    } else if (currentCount !== baselineCount) {
      changes.push(`${name} restarts changed ${baselineCount} -> ${currentCount}`);
    }
  }
  for (const name of currentByName.keys()) {
    if (!baselineByName.has(name)) changes.push(`${name} appeared`);
  }

  return changes;
}

export function assertProcessContinuity(baselineProcesses, currentProcesses) {
  const changes = processRestartChanges(baselineProcesses, currentProcesses);
  if (changes.length > 0) {
    throw new Error(`PM2 process continuity failed: ${changes.join("; ")}`);
  }
}

export function isRetryableNonceError(error) {
  const message =
    error instanceof Error
      ? [
          error.message,
          "stderr" in error ? String(error.stderr ?? "") : "",
          "stdout" in error ? String(error.stdout ?? "") : "",
        ].join("\n")
      : String(error);
  return /nonce too low|nonce has already been used|replacement transaction underpriced/i.test(
    message,
  );
}
