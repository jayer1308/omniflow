# GOAL-005: controller gate green

Base 1ffad3460fb39c881cb6fc01c912cc091a044384 → delivery d765c545101cb9675cd9943056f3f89fc0074ee9 (/bin/sh, v24.22.1)

- CHK-1: **pass** — exit 0 on delivery
- CHK-2: **pass** — exit 0 on delivery
- APOS-LOCKED: **pass** — 1 locked files unchanged; the package's locked tests pass
- APOS-INVENTORY: **pass** — 318 tests at the base are all still there
- APOS-INFRA: **pass** — test infrastructure unchanged since the lock
- APOS-SCOPE: **pass** — every changed file is inside the package paths
- app.L0.tsc: **pass** — app.L0 tsc: exit 0
- app.L1.vitest: **pass** — app.L1 vitest: 163 tests, 0 failing as at the base
- app.L2.vitest-acceptance: **pass** — app.L2 vitest-acceptance: 155 tests, 0 failing as at the base
