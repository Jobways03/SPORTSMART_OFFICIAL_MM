# Inter-Module Dependency Matrix

## Legend
- D = Direct facade call allowed
- E = Event-driven reaction allowed
- X = Forbidden
- R = Read-only access via facade

## Matrix (row DEPENDS ON column)

| Module | identity | seller | catalog | inventory | cart | checkout | orders | payments | cod | shipping | returns | settlements | affiliate | franchise | notifications | audit | files |
|--------|----------|--------|---------|-----------|------|----------|--------|----------|-----|----------|---------|-------------|-----------|-----------|---------------|-------|-------|
| identity | - | X | X | X | X | X | X | X | X | X | X | X | X | X | E | D | X |
| seller | D | - | X | X | X | X | X | X | X | X | X | X | X | X | E | D | D |
| catalog | D | D | - | X | X | X | X | X | X | X | X | X | X | X | E | D | D |
| search | X | X | D | R | X | X | X | X | X | X | X | X | X | X | X | D | X |
| inventory | X | R | D | - | X | X | X | X | X | X | X | X | X | X | X | D | X |
| cart | X | R | D | R | - | X | X | X | X | X | X | X | X | X | X | D | X |
| checkout | D | D | D | D | D | - | D | D | D | R | X | X | D | D | E | D | X |
| orders | D | D | D | D | X | X | - | X | X | X | X | X | D | D | E | D | X |
| payments | D | X | X | X | X | X | D | - | X | X | X | X | X | X | E | D | X |
| cod | X | D | X | X | X | X | X | X | - | X | X | X | X | X | X | D | X |
| shipping | D | D | X | X | X | X | D | X | X | - | X | X | X | X | E | D | D |
| returns | D | D | D | D | X | X | D | D | X | D | - | D | X | X | E | D | D |
| settlements | D | D | X | X | X | X | D | D | X | X | D | - | D | D | E | D | X |
| affiliate | D | X | X | X | X | X | X | X | X | X | X | X | - | X | E | D | X |
| franchise | D | X | X | X | X | X | X | X | X | X | X | X | X | - | E | D | X |
| notifications | X | X | X | X | X | X | X | X | X | X | X | X | X | X | - | D | X |
| admin-ctrl | D | D | D | R | X | X | D | D | D | D | D | D | D | D | E | D | D |
| audit | D | X | X | X | X | X | X | X | X | X | X | X | X | X | X | - | X |
| files | X | X | X | X | X | X | X | X | X | X | X | X | X | X | X | D | - |
