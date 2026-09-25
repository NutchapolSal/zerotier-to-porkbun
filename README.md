# zerotier-to-porkbun

Publishes the members of a ZeroTier network as DNS records in a Porkbun-hosted
zone. It reproduces the naming scheme of
[zeronsd](https://github.com/zerotier/zeronsd), which serves the same records
from its own DNS server instead of a registrar's API.

Every authorized member that has an IP assignment receives:

- `zt-<nodeId>.<subdomain>.<domain>`, which is stable across renames.
- `<member name>.<subdomain>.<domain>`, when the member's name survives
  zeronsd's sanitizing rules (whitespace becomes `-`, punctuation is removed).
- A `*.` variant of each of the above, when `PORKBUN_WILDCARD` is enabled.

Both A and AAAA records are published, taken from the member's
`ipAssignments`. PTR records are not, because the reverse zone belongs to the
address holder rather than to you.

The configured subdomain is treated as exclusively owned: any A or AAAA record
under it that is not part of the computed set is deleted. Do not keep unrelated
records there.

## Installation

A container image is published to `ghcr.io/nutchapolsal/zerotier-to-porkbun`.

The domain must be delegated to Porkbun's nameservers for these records to
resolve. The API accepts writes either way; when the domain is delegated
elsewhere, Porkbun returns a warning, which this program logs.

## Configuration

Each secret may be supplied either as `NAME` or, for container secrets, as
`NAME_FILE` containing the path to a file to read.

| Variable                    | Default  | Description                                                                        |
| --------------------------- | -------- | ---------------------------------------------------------------------------------- |
| `ZEROTIER_TOKEN`            | required | ZeroTier Central API token, from https://my.zerotier.com/account                   |
| `ZEROTIER_NETWORK_ID`       | required | Network to publish                                                                 |
| `PORKBUN_API_KEY`           | required | Porkbun API key, from https://porkbun.com/account/api                              |
| `PORKBUN_SECRET_API_KEY`    | required | Matching secret key                                                                |
| `PORKBUN_DOMAIN`            | required | Registrable domain, for example `example.com`                                      |
| `PORKBUN_SUBDOMAIN`         | required | Prefix this program owns, for example `zt`                                         |
| `PORKBUN_RECORD_TTL`        | `600`    | Record TTL. Porkbun's account minimum is usually 600                               |
| `PORKBUN_WILDCARD`          | `true`   | Also publish `*.<name>` records                                                    |
| `PORKBUN_USE_IPV4_ENDPOINT` | `false`  | Use `api-ipv4.porkbun.com` instead of the default host                             |
| `PORKBUN_MAX_PRUNE_RATIO`   | `0.5`    | Skip deletions when more than this share of owned records would be removed at once |
| `PORKBUN_DRY_RUN`           | `false`  | Report the planned changes without writing                                         |
| `SYNC_INTERVAL_SECONDS`     | `300`    | Polling interval                                                                   |
| `SYNC_ONCE`                 | `false`  | Perform a single round and exit                                                    |

A Porkbun sandbox key pair (`pk1_sb_` / `sk1_sb_`) works against the same API
and affects nothing real. Note that the sandbox uses an isolated datastore, so
a domain registered on the live account is not visible to it.

## Development

```
npm ci
npm test        # node's built-in test runner
npx tsc
npx eslint .
PORKBUN_DRY_RUN=true SYNC_ONCE=true node --env-file=.env src/index.ts
```
