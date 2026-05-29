-- Phase 95 (2026-05-23) — Phase 93 deferred #29 closure.
--
-- Pre-Phase-95 generateNextReturnNumber wrapped a Serializable tx
-- around an UPSERT on the singleton ReturnSequence row. Under burst
-- load (e.g., a marketing-campaign cancellation wave) every concurrent
-- creator deadlocked on that one row, and Serializable retries cost
-- ~50ms per attempt.
--
-- Postgres SEQUENCE eliminates the contention — nextval() is a single
-- atomic increment + return, with no row lock. Sequence values are not
-- transactional (a rolled-back tx still consumes the value, leaving
-- gaps), but the return-number format isn't required to be
-- gap-free — uniqueness + monotonic increase is enough.
--
-- The ReturnSequence model is retained as a fallback for environments
-- that don't have the sequence yet (the repo falls back when nextval
-- raises). Once all envs are migrated we can drop the model.

CREATE SEQUENCE IF NOT EXISTS return_number_seq
  START WITH 1
  INCREMENT BY 1
  NO CYCLE;

-- Seed the new sequence past the highest existing ReturnSequence
-- value so we don't collide with any RET-{year}-{n} already issued.
DO $$
DECLARE
  current_max BIGINT;
BEGIN
  SELECT COALESCE(MAX(last_number), 0) INTO current_max FROM return_sequences;
  IF current_max > 0 THEN
    PERFORM setval('return_number_seq', current_max, true);
  END IF;
END $$;
