# FSRS scheduling

Chess OS pins `ts-fsrs` **5.4.2** and uses its FSRS-6 implementation. The scheduler configuration is fixed in `src/fsrs-review.js`:

- Desired retention: 90%.
- Maximum interval: 36,500 days.
- Fuzz disabled for deterministic scheduling.
- Short-term learning enabled, with 1-minute and 10-minute learning steps.
- Relearning step: 10 minutes.
- New-card daily limit: 20.

## Card identity

A review card is created for each outgoing repertoire move. Its stable identity is the repertoire ID plus the move-edge ID; it also stores the source position FEN, UCI move, SAN and side to train. The side is derived from the FEN side-to-move field, so a card asks the learner to find the repertoire move from the position where that side is to move.

The graph can merge transpositions. In that case, the shared position/move edge produces one card within that repertoire graph rather than duplicate cards for the same position and move. Different repertoires retain independent cards.

## Daily session

The daily queue contains every due learning/relearning/review card for the selected side plus the remaining portion of a cumulative limit of 20 new cards per local calendar day. The limit is computed from review logs in the New state, so opening multiple sessions cannot reset it. Due review cards are not capped. New cards are ordered after already-due review cards. A card is scheduled only after the learner chooses Again, Hard, Good or Easy, and the next due date is displayed through the scheduler state. Review logs retain whether the move was solved before revealing the answer; recall accuracy uses that outcome independently from the FSRS grade. The review panel exposes the latest eight sessions and fifteen ratings, including unfinished sessions as interrupted after an application restart.

Again can be selected immediately after an incorrect attempt. After a correct answer or after revealing the solution, all four ratings are available.

## Persistence

The Tauri desktop app stores the serialized FSRS card state in SQLite `study_cards.fsrs_json`, with normalized due/state counters alongside it. Each review writes a separate row into `review_logs` and updates the active `training_sessions` row in the same SQLite transaction. Browser preview stores equivalent data in `localStorage`.

The card scheduler and its parameter settings are versioned in source. Future algorithm or configuration changes must introduce a migration/version strategy rather than silently reinterpret existing card states.

## Tests

Run:

```sh
npm test
npm run build
```

The FSRS test suite covers card generation, state restoration, all four ratings, due-card ordering, side filters, daily new-card limits, local-day statistics and UCI parsing.
