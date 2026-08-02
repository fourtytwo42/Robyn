# Application-only releases with frozen Schema-18 contracts

Use the application-only release path for presentation and wallet-UX changes that do not alter the deployed protocol.

```bash
pnpm build:web-release devnet <release-id>
pnpm build:web-release testnet <release-id>
pnpm build:web-release mainnet <release-id>
```

The builder is fail-closed. Before it runs application checks, it verifies:

- the exact Git tree object for `packages/contracts/src`;
- the exact Foundry configuration blob;
- all direct Solidity dependency versions;
- the SHA-256 of the immutable full-gate security report; and
- the SHA-256 of the immutable full release manifest that produced that report.

A passing application-only release runs web formatting, lint, typechecking, unit tests, secret scanning, dependency auditing, and a protected network-specific Next.js build. It records the frozen-contract attestation in the release evidence.

The application-only builder never compiles, tests, analyzes, deploys, or mutates contracts. If any frozen contract input or qualification artifact differs, it refuses to build. Contract changes must establish a new schema qualification and full release attestation before the fast path can be used again.

The existing full release builders remain available for contract, deployment, broad service, dependency, or uncertain-scope changes.
