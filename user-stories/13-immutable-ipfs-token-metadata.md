# Immutable IPFS token-metadata stories

### US-IPFS-001: Launch with immutable portable metadata

- Release: Testnet readiness
- Priority: Must
- Persona: Creator
- PRD: IPFS-001, IPFS-002, IPFS-004
- Depends on: Atomic launch coordinator

As a creator, I want my token to expose an immutable ERC-1046 URI so that
wallets and explorers can resolve the same committed identity.

Acceptance criteria:

1. The prepared CIDv1 URI is included in simulation and the single atomic
   launch transaction.
2. The receipt event hash and deployed `tokenURI()` match the prepared URI.
3. Invalid URIs and any later mutation attempt fail closed.

### US-IPFS-002: Publish sanitized compatible artwork

- Release: Testnet readiness
- Priority: Must
- Persona: Creator
- PRD: IPFS-003, IPFS-004, IPFS-012
- Depends on: Authenticated media upload

As a creator, I want one upload converted into compatible deterministic assets
so that token directories and Robyn cards render consistently.

Acceptance criteria:

1. Allowed static sources produce a 1024 PNG and WebP with metadata removed.
2. Animated, malformed, oversized, and unsupported inputs are rejected.
3. The UI shows local and redundant pin readiness before wallet approval.

### US-IPFS-003: Verify provenance without restricting launches

- Release: Testnet readiness
- Priority: Must
- Persona: Verifier
- PRD: IPFS-006, IPFS-010
- Depends on: US-IPFS-001

As a verifier, I want Robyn-sanitized status and a pinned token list so that I
can distinguish the platform pipeline from arbitrary external metadata.

Acceptance criteria:

1. Direct contract callers can launch with any syntactically valid CIDv1 URI.
2. Only exact sanitized pipeline outputs receive Robyn-verified status.
3. The pinned token list includes active verified tokens and canonical PNG
   `logoURI` values, and its CID is exposed beside a stable HTTPS path.

### US-IPFS-004: Render safely during storage and moderation failures

- Release: Testnet readiness
- Priority: Must
- Persona: Holder
- PRD: IPFS-007, IPFS-008
- Depends on: US-IPFS-002

As a holder, I want token art to fail safely so that an IPFS or moderation
incident does not create broken or misleading market cards.

Acceptance criteria:

1. Active local Kubo content is preferred, identical MinIO bytes are fallback,
   and Robyn fallback art is final.
2. Quarantine changes Robyn rendering and token-list eligibility immediately.
3. The interface states that immutable public IPFS content is not deleted.

### US-IPFS-005: Recover every authoritative CID

- Release: Testnet readiness
- Priority: Must
- Persona: Operator
- PRD: IPFS-005, IPFS-009, IPFS-011
- Depends on: Encrypted state backup

As an operator, I want an empty-node restore to reproduce every CID so that the
Kubo blockstore is disposable without losing token metadata.

Acceptance criteria:

1. The backup maps every local pin to an exact MinIO artifact.
2. Isolated recovery re-adds bytes to an empty Kubo repository and compares the
   complete restored pin set and every expected CID.
3. Kubo RPC remains loopback-only, NoFetch remains enabled, and protected
   testnet readiness blocks until remote pins are verified.
