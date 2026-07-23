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

export function shouldCreateLaunch(writeCycle, launchEveryWrites) {
  if (!Number.isInteger(writeCycle) || writeCycle < 1) {
    throw new Error("write cycle must be a positive integer");
  }
  if (!Number.isInteger(launchEveryWrites) || launchEveryWrites < 1) {
    throw new Error("launch cadence must be a positive integer");
  }
  return writeCycle % launchEveryWrites === 0;
}

export function shouldGraduateLaunch(launchSequence, graduateEveryLaunches) {
  if (!Number.isInteger(launchSequence) || launchSequence < 1) {
    throw new Error("launch sequence must be a positive integer");
  }
  if (!Number.isInteger(graduateEveryLaunches) || graduateEveryLaunches < 1) {
    throw new Error("graduation cadence must be a positive integer");
  }
  return launchSequence % graduateEveryLaunches === 0;
}

export function realisticSoakSymbol(launchSequence) {
  if (!Number.isInteger(launchSequence) || launchSequence < 1) {
    throw new Error("launch sequence must be a positive integer");
  }
  return `R${launchSequence.toString(36).toUpperCase().padStart(4, "0")}`;
}

export function maximumCreatedLaunches(
  durationSeconds,
  intervalSeconds,
  writeEverySamples,
  launchEveryWrites,
) {
  for (const value of [
    durationSeconds,
    intervalSeconds,
    writeEverySamples,
    launchEveryWrites,
  ]) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error("soak timing values must be positive");
    }
  }
  const samples = Math.ceil(durationSeconds / intervalSeconds);
  const writeCycles = Math.floor((samples - 1) / writeEverySamples);
  return Math.floor(writeCycles / launchEveryWrites);
}
