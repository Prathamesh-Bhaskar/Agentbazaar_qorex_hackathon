-- QoreChain: the client's native funding transfer is kept beside the confirming transaction.
ALTER TABLE payments RENAME COLUMN hedera_tx_id TO native_tx;
