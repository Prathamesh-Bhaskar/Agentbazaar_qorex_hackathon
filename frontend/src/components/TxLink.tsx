'use client';
import { useState } from 'react';
import { EXPLORER_HINT, shortTx, txUrl } from '@/lib/explorer';
import { Icon } from './Icon';

/** A transaction hash: a link when the explorer can show it, otherwise a button that copies it. */
export default function TxLink({ hash, small }: { hash: string; small?: boolean }) {
  const [copied, setCopied] = useState(false);
  const url = txUrl(hash);
  const style = small ? { fontSize: 12 } : { fontSize: 13 };
  if (url) {
    return <a className="link mono" style={style} href={url} target="_blank" rel="noopener noreferrer" title={EXPLORER_HINT}>{shortTx(hash)}<Icon name="ext" size={13} /></a>;
  }
  const copy = async () => { try { await navigator.clipboard.writeText(hash); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked */ } };
  return (
    <button type="button" className="link mono" style={style} onClick={copy} title="EVM transaction hash: click to copy" aria-label={`Copy transaction hash ${hash}`}>
      {copied ? 'Copied' : shortTx(hash)}<Icon name="copy" size={13} />
    </button>
  );
}
