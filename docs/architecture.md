# OctoFit Tracker architecture

OctoFit Tracker is a three-tier application for a school fitness program. The starter code includes API contracts and intentionally incomplete implementation points so you can use GitHub Copilot agent mode in a test-driven loop.

![Three-tier OctoFit architecture](../.github/images/octofit-architecture.svg)

## Tier boundaries

- **Presentation tier**: React 19, Vite, React Router, Bootstrap, and a shared API client in `octofit-tracker/frontend/src`.
- **Logic tier**: Express and TypeScript routes/services in `octofit-tracker/backend/src` expose `/api/*` behavior on port `8000`.
- **Data tier**: Mongoose models and seed data in `octofit-tracker/backend/src/models` and `src/scripts/seed.ts` persist to MongoDB on port `27017`.

## Ports and environment rules

- MongoDB: `27017`
- Express API: `8000`
- Vite frontend: `5173`
- The browser calls relative `/api` paths. Vite proxies them to `http://localhost:8000`, so the unauthenticated API port stays private in Codespaces. `VITE_API_BASE_URL` can override the base URL.

## API contract

| Capability | Method and path | Expected behavior |
| --- | --- | --- |
| Activity tracking | `GET /api/activities`, `POST /api/activities` | List and create valid activity records. POST accepts `userId`, `teamId`, `type`, and `minutes`; `userId` and `teamId` must be well-formed IDs for an existing user and team; otherwise respond with a deliberate 4xx (never a 500 from a cast error). A created activity stores the submitted `user`, `team`, `type`, and `minutes` plus computed `points` and `occurredAt`. |
| Teams | `GET /api/teams`, `POST /api/teams` | List and create teams with members. Created and listed teams keep the submitted `name` and `mascot`. Reject a team without a name with `400`. |
| Leaderboard | `GET /api/leaderboard` | Return teams ordered by the sum of their activity points, highest first. Each entry has `teamName`, `totalPoints`, and a 1-based `rank`. |
| Workout suggestions | `GET /api/workouts/suggestions/:userEmail` | Recommend workouts from recent activity patterns for the matching seeded user's email address. The first suggestion's `focus` matches that user's goal or recent activity, with a `reason` explaining why. An email with no matching user returns a deliberate 4xx (for example, `404`). |

## Implementation decisions

These decisions are the implementation plan, not a claim that the starter code is complete. Keep changes small and test-driven; do not add authentication.

- Presentation tier decision: Keep the existing React routes and Bootstrap layout. Replace capability placeholders with API-backed views using the shared API client and typed response shapes. Each view must provide accessible loading (`role="status"`), error (`role="alert"`), empty, and populated states. Keep business rules and database access out of React. Request workouts for `mona@example.com` initially, matching the seeded demo user and presentation contract.
- Logic tier decision: Keep Express routes thin and implement validation and business rules in the existing service module. Preserve the documented response envelopes (`activities`, `activity`, `teams`, `team`, `leaderboard`, and `suggestions`). Send deliberate 4xx errors for invalid input or missing referenced records through the existing error middleware; do not mask failures as successful empty responses.
- Data tier decision: Add required-field validation to the existing Mongoose schemas: user name, email, and fitness goal; team name and mascot; activity user, team, type, minutes, points, and occurrence date; workout focus, minutes, and difficulty. Preserve ObjectId references and the default empty team members array. Retain the existing non-destructive, idempotent seed process and its membership-repair behavior. Keep MongoDB on port `27017`, the API on `8000`, and Vite on `5173`.
- Activity tracking approach: Validate the request body, non-empty activity type, positive finite minutes, and both ObjectId formats before querying. Require an existing user and team, returning a deliberate 4xx without inserting anything when validation fails. Persist the submitted references, type, and minutes, compute one point per minute to match the seed fixtures, and set `occurredAt` on the server. Return the created record with `201` and list persisted records through the existing GET endpoint.
- Team management approach: Validate a non-empty name and mascot and an optional array of member IDs, defaulting members to an empty array. Validate supplied member IDs and referenced users before persistence. Preserve the submitted name, mascot, and members in creation and listing responses; return `400` for a missing name.
- Leaderboard approach: Aggregate persisted activity points by team, resolve team names, sort by descending total points, and assign sequential 1-based ranks. Use team name as a deterministic secondary sort for equal totals. Return entries with `teamName`, `totalPoints`, and `rank`, keeping aggregation out of presentation components.
- Workout suggestions approach: Look up the user by the route's email and return `404` if no user matches. Use that user's fitness goal and recent activities to prioritize matching workout focus, mapping running and cycling to endurance and strength activities to strength. Include a human-readable `reason` explaining the goal or activity match on each suggestion; never return an arbitrary workout independent of the user.

### Smallest safe implementation order

1. Add schema validation and run data contracts, preserving the already-passing seed regression.
2. Follow API contract order: implement activity creation and reference validation, then team creation; run the relevant API contracts after each change.
3. Implement leaderboard aggregation, then personalized workout suggestions; verify exact response shapes and error cases.
4. Replace presentation placeholders one route at a time: activities, teams, leaderboard, then workouts. Complete all four UI states for each route before proceeding.
5. Run all contract tests and both builds, then smoke-test the seeded application through Vite's relative `/api` proxy without exposing the API port.

## Test plan

### Verified baseline (2026-10-18)

The following commands were run against the unchanged starter implementation:

| Command | Result | Meaning |
| --- | --- | --- |
| `npm test --prefix octofit-tracker/backend` | 8 failed, 1 passed | Data contracts: four required-field validation tests fail because schemas accept missing fields; the idempotent, non-destructive seed test passes. API contracts: all four fail: activity and team POST return `501` instead of `400`, leaderboard returns an empty array, and workout suggestions are not personalized and omit `reason`. |
| `npm test --prefix octofit-tracker/frontend` | 15 failed | Placeholder views do not render API data or request a specific user's workouts. All four capabilities lack the required loading text, meaningful empty states, and accessible failure alerts. |

Total: **23 failed, 1 passed**. These are implementation failures, not missing-dependency or database-startup failures. Backend tests use an isolated MongoDB memory server rather than the application's persistent database.

Each test stops at its first failed assertion. Later assertions in failing API tests, including malformed/nonexistent references, successful creation, second-user recommendations, and unknown-user handling, must still be verified after the initial failures are fixed.

### Data-tier implementation results (2026-10-19)

Added required-field validators without changing field types, ObjectId references, optional user team assignment, or empty team membership defaults. Seed writes now enable Mongoose update validation. Existing fixture values and stable upsert keys remain unchanged: user email, team name, workout title, and activity user/team/type with fixed occurrence dates. No collections are cleared.

Ran `npm run test:data --prefix octofit-tracker/backend` after each capability change:

| Change | Result | Remaining failures |
| --- | --- | --- |
| User and team schemas and seed validation | 3 passed, 2 failed | Activity and workout required-field validation, not yet implemented. |
| Activity schema and seed validation | 4 passed, 1 failed | Workout required-field validation, not yet implemented. |
| Workout schema and seed validation | 5 passed | None. |

The seed regression passed at every step. It runs the seed twice, checks stable collection counts, retains unrelated records, and verifies demo-user membership repair. `npm run build --prefix octofit-tracker/backend` also passed after all model changes. API and React files were not changed; their suites were not rerun during this data-only implementation.

### First API contract results (2026-10-19)

Implemented only activity creation in the existing service. Missing or invalid fields return `400`; well-formed IDs without a matching user or team return `404`. Validation completes before insertion. Created activities retain the supplied references, type, and minutes, compute one point per minute, and use a server-generated occurrence date. Existing routes and activity listing remain unchanged.

- `npm run test:api --prefix octofit-tracker/backend -- -t "creates and lists valid activities while rejecting invalid input"`: passed (1 passed, 3 skipped). Coverage also checks invalid types/minutes, each missing reference independently, and that client-supplied points and dates cannot override computed values.
- `npm run build --prefix octofit-tracker/backend`: passed.
- Next: `npm run test:api --prefix octofit-tracker/backend -- -t "creates teams and exposes members"`: confirmed failing because team creation still returns `501` instead of `400` for a missing name. Team creation, leaderboard, workout suggestions, and React are unchanged.

### Implementation validation commands

Use the targeted commands below during implementation. The separate data/API selectors and both builds were not run for this baseline; the combined backend command above exercised both contract files.

- Data-tier command: `npm run test:data --prefix octofit-tracker/backend`
  - Require all five tests to pass: required-field validation, member-array defaults and ID casting, and repeatable seeding that preserves unrelated records and repairs membership.
- API command: `npm run test:api --prefix octofit-tracker/backend`
  - Require all four tests to pass: invalid requests produce deliberate 4xx responses without writes, valid records are created and listed with the required fields, leaderboard totals and ranks match exactly, and suggestions match each user's goal/activity with a reason and reject unknown users.
- Frontend command: `npm test --prefix octofit-tracker/frontend`
  - Require all 15 tests to pass: API-backed content, the specific-user workout URL, and loading, empty, and accessible error states for every capability.
- Backend build command: `npm run build --prefix octofit-tracker/backend`
  - Require TypeScript checking to pass; this command uses `tsc --noEmit` and does not produce a server bundle.
- Frontend build command: `npm run build --prefix octofit-tracker/frontend`
  - Require TypeScript checking and Vite production bundling to pass.

After these checks pass, run the seed twice against a development database and confirm stable fixture counts without deleting unrelated records. Start MongoDB, Express, and Vite on their assigned ports and verify all four routes through the browser-facing Vite server. Confirm activity/team creation, refreshed lists, leaderboard ordering, user-specific suggestions, and visible failure states. Keep authentication out of this exercise.
