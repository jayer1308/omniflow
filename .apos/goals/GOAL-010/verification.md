# GOAL-010: controller gate green

Base 92280057798a4f114b0a79fd2127b6d4d33e1aba → delivery 46995b4069f438e836936d2ba22b40cf788a51d1 (/bin/sh, v24.22.1)

- CHK-1: **pass** — exit 0 on delivery
- CHK-2: **pass** — exit 0 on delivery
- APOS-LOCKED: **pass** — 1 locked files unchanged; the package's locked tests pass
- APOS-INVENTORY: **pass** — 732 tests at the base are all still there
- APOS-INFRA: **pass** — test infrastructure unchanged since the lock
- APOS-SCOPE: **pass** — every changed file is inside the package paths
- app.L0.tsc: **pass** — app.L0 tsc: exit 0
- app.L1.vitest: **pass** — app.L1 vitest: 370 tests, 0 failing as at the base
- app.L2.vitest-acceptance: **pass** — app.L2 vitest-acceptance: 362 tests, 0 failing as at the base
