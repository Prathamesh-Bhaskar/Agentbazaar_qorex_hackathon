-- QoreChain: a2a payments are bound to the contract leg they settle, and one payment tx settles only one leg.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS leg_id integer;
CREATE UNIQUE INDEX IF NOT EXISTS payments_a2a_tx ON payments (tx_hash) WHERE kind = 'a2a';
