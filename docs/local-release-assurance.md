# Local release assurance

This program is an internal AI-assisted engineering review of the controlled
Robyn devnet. It is not an independent professional audit, external
penetration test, Robinhood Testnet rehearsal, or proof of total-host disaster
recovery.

## Fail-closed order

1. Require a clean exact pushed commit and a passing deployment verifier.
2. Create and independently restore an encrypted off-VM backup.
3. Run contract/security and adversarial economic campaigns.
4. Run alert delivery and one-fault-at-a-time chaos.
5. Run isolated recovery and reproducible-build comparisons.
6. Complete browser/persona acceptance.
7. Promote one immutable candidate and explicitly start one uninterrupted
   eight-hour soak.

Unexplained accounting drift stops the program. Restore the baseline in
isolation, diagnose the defect, add regression coverage, and rerun every
affected gate.

## Chaos runner

Run only from the authoritative VM:

```bash
sudo /home/hendo420/Robyn/scripts/run-chaos-assurance.sh
```

The runner:

- SIGKILLs each declared PM2 process separately and proves PM2 resurrection.
- interrupts Redis, PostgreSQL, MinIO and Anvil one at a time.
- reconciles application health and deployment invariants after every fault.
- applies bounded disk pressure.
- tests 1, 5 and 20 block rollback only on an isolated Anvil port.
- proves a corrupt encrypted backup is rejected.

Every event records the exact Git SHA, UTC time, scenario, phase, result and
detail. Raw evidence and SHA-256 manifests are written beneath
`/var/backups/robyn/chaos/`.

## Reproducible builds

Run `scripts/verify-reproducible-builds.sh` from a clean pushed commit. It
extracts the same Git archive twice, uses separate fresh pnpm stores, and
builds each archive at the same fixed source root. This fixed root is an
explicit normalization because Next and Foundry artifact containers embed
absolute source paths.

The gate compares application bundles, ABI, creation/runtime bytecode, storage
layouts, operations/migrations, dependency graphs, license inventory and a
deterministic CycloneDX 1.5 SBOM. JSON object keys and Next client-reference
objects are canonicalized recursively while array order is preserved. Next
cache/trace telemetry and absolute-path-only Solidity metadata are excluded.
It temporarily serves the second clean build on loopback port 3300 and verifies
the development-network disclosure. Every normalization is recorded in the
checksummed summary.

## Alert evidence

`scripts/verify-alert-delivery.sh` injects reversible synthetic alerts into
loopback Alertmanager and requires firing plus resolved webhook delivery for
all declared alert routes. The receiver is append-only and local. No external
human notification is claimed.

## Deferred gates

The following remain explicit future gates: public Robinhood Testnet rehearsal
or broadcast, an external application penetration test, an independent
professional smart-contract audit, external paging delivery, a soak longer
than eight hours, mainnet/real Stock Tokens, legal review and production-wallet
acceptance.
