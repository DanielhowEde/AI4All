/**
 * ML-DSA-65 key generation helper (ESM).
 * Outputs JSON to stdout: { publicKey, secretKey } as hex strings.
 * Called by create-wallet.ts and run-blockchain.ts via child_process.
 */
import { createMLDSA65 } from '@openforge-sh/liboqs';
import { createHash } from 'crypto';

const dsa = await createMLDSA65();
const { publicKey, secretKey } = dsa.generateKeyPair();
dsa.destroy();

const pubHex = Buffer.from(publicKey).toString('hex');
const skHex = Buffer.from(secretKey).toString('hex');

// Derive address: "ai4a" + hex(SHA256(pk)[0:20])
const hash = createHash('sha256').update(publicKey).digest('hex');
const address = 'ai4a' + hash.slice(0, 40);

process.stdout.write(JSON.stringify({ address, publicKey: pubHex, secretKey: skHex }));
