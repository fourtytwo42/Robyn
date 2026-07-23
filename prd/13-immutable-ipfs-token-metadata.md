# Immutable IPFS token metadata

Status: Implemented for controlled devnet  
Version: 1.0  
Date: 2026-07-23

## Product contract

`IPFS-001` Every new Robyn launch MUST deploy a token with a constructor-set,
nonempty ERC-1046 `tokenURI()` using an accepted CIDv1 `ipfs://` URI. The URI
MUST have no mutation path.

`IPFS-002` The atomic launch request, configuration hash, CREATE2 prediction,
and canonical launch event MUST commit to the metadata URI. A failed launch
MUST leave no partial onchain state.

`IPFS-003` Robyn's verified pipeline MUST decode an allowed static source once,
strip metadata, and deterministically create a 1024x1024 PNG plus optimized
WebP. The original upload MUST NOT be served publicly.

`IPFS-004` Canonical metadata MUST be ordered, minified ERC-1046 JSON containing
name, symbol, 18 decimals, optional description of at most 280 characters,
canonical PNG `image`, and optimized WebP `images`. Mutable profiles and social
links MUST NOT be included.

`IPFS-005` Sanitized bytes MUST remain recoverable in MinIO and MUST be added as
CIDv1 objects to the loopback-only Kubo API. Kubo is a distribution layer, not
the sole recoverable store.

`IPFS-006` The application MUST distinguish Robyn-sanitized metadata from
permissionlessly supplied external metadata. Direct launchers MAY use any
syntactically valid accepted CIDv1 URI without a Robyn attestation.

`IPFS-007` Public application rendering MUST resolve active Kubo content first,
identical MinIO bytes second, and Robyn fallback artwork last. It MUST NOT turn
the Kubo API or gateway into an unrestricted proxy.

`IPFS-008` Quarantine MUST immediately change Robyn rendering and token-list
eligibility without claiming the immutable URI or public IPFS content was
deleted. Moderation MUST NOT automatically unpin content.

`IPFS-009` Each public object MUST be locally pinned and submitted through a
vendor-neutral IPFS Pinning Service API. Devnet MAY disclose remote status as
queued; protected testnet readiness MUST require verified remote pinning.

`IPFS-010` Robyn MUST publish and pin a versioned Uniswap-compatible token list
whose `logoURI` values use canonical PNG CIDs, while also serving identical
bytes from a stable application endpoint.

`IPFS-011` Backups MUST contain every authoritative MinIO object, database CID
mapping, and complete pin manifest, but not the Kubo blockstore. Recovery MUST
reproduce every CID from restored bytes in an empty Kubo repository.

`IPFS-012` Creation UI MUST expose sanitization, local pin, redundant pin,
metadata-ready, wallet, confirmation, and indexing states. It MUST disclose
that IPFS publication is public and cannot be represented as deletable.

## Release gates

- Deterministic derivative and canonical JSON tests pass.
- URI validation, CREATE2 commitment, event hash, concurrency, and atomic
  rollback contract tests pass.
- Upload through binding, quarantine, fallback, gateway isolation, pin retry,
  backup, empty-Kubo restore, and onchain reconciliation pass.
- The controlled devnet is reset and seeded with curated immutable metadata.
- Protected testnet remains blocked until external pin credentials and pinned
  status are verified.
