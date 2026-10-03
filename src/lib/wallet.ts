import {
  createPasskeyWithPrfOutput,
  getPasskeyPrfOutput,
  createSecp256k1SigningSession,
  isMeraError,
} from "@category-labs/mera";
import { toViemAccount } from "@category-labs/mera/viem";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  parseAbi,
  parseEventLogs,
  parseUnits,
  zeroAddress,
  type Hex,
} from "viem";
import { monadTestnet } from "viem/chains";

const CRED_KEY = "ajo.credential";

export const AUSD: Hex = "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC";
const AUSD_FAUCET: Hex = "0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C";
export const CIRCLE: Hex = "0xa678625cb9c2475a683d1f14bc15b847308f7311";
export const EXPLORER = "https://testnet.monadvision.com/tx/";

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
const faucetAbi = parseAbi(["function requestFunds(address recipient)"]);
const circleAbi = parseAbi([
  "function createCircle(address token, uint256 contribution, uint32 maxMembers, uint32 roundDuration) returns (uint256)",
  "function joinCircle(uint256 id)",
  "function contribute(uint256 id)",
  "function payout(uint256 id)",
  "function getCircle(uint256 id) view returns (address token, address creator, uint256 contribution, uint32 maxMembers, uint32 roundDuration, uint32 currentRound, uint64 roundStart, bool started, bool finished, uint256 memberCount)",
  "function getMembers(uint256 id) view returns (address[])",
  "function hasPaid(uint256, uint32, address) view returns (bool)",
  "event CircleCreated(uint256 indexed id, address indexed creator, address token, uint256 contribution, uint32 maxMembers, uint32 roundDuration)",
]);

export const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(),
});

function deriveEvmKey(prfOutput: Uint8Array, index = 0): Uint8Array {
  const seed = mnemonicToSeedSync(entropyToMnemonic(prfOutput, wordlist));
  const node = HDKey.fromMasterSeed(seed).derive(`m/44'/60'/0'/0/${index}`);
  if (node.privateKey === null) throw new Error("derivation produced no key");
  return node.privateKey;
}

function addressFrom(prfOutput: Uint8Array): Hex {
  const session = createSecp256k1SigningSession({
    privateKey: deriveEvmKey(prfOutput),
  });
  const address = toViemAccount(session).address;
  session.end();
  return address;
}

async function promptPrf(forcePick = false): Promise<Uint8Array> {
  const stored = localStorage.getItem(CRED_KEY);
  const known = !forcePick && stored ? JSON.parse(stored) : undefined;
  const { prfOutput, credentialId } = await getPasskeyPrfOutput({
    rpId: location.hostname,
    credential: known,
  });
  localStorage.setItem(CRED_KEY, JSON.stringify({ credentialId }));
  return prfOutput;
}

export async function createAccount(): Promise<Hex> {
  const created = await createPasskeyWithPrfOutput({
    rp: { id: location.hostname, name: "Ajo" },
    user: {
      name: "ajo-" + Date.now().toString(36).slice(-4),
      displayName: "Ajo member",
    },
  });
  localStorage.setItem(
    CRED_KEY,
    JSON.stringify({
      credentialId: created.credentialId,
      transports: created.transports,
    }),
  );
  return addressFrom(created.prfOutput);
}

export async function signIn(forcePick = false): Promise<Hex> {
  return addressFrom(await promptPrf(forcePick));
}

let decimalsPromise: Promise<number> | undefined;
function ausdDecimals(): Promise<number> {
  decimalsPromise ??= publicClient.readContract({
    address: AUSD, abi: erc20, functionName: "decimals",
  });
  return decimalsPromise;
}

export async function getBalances(address: Hex) {
  const [mon, raw, decimals] = await Promise.all([
    publicClient.getBalance({ address }),
    publicClient.readContract({ address: AUSD, abi: erc20, functionName: "balanceOf", args: [address] }),
    ausdDecimals(),
  ]);
  return { mon: formatUnits(mon, 18), ausd: formatUnits(raw, decimals) };
}

function makeClient(session: ReturnType<typeof createSecp256k1SigningSession>) {
  return createWalletClient({
    account: toViemAccount(session),
    chain: monadTestnet,
    transport: http(),
  });
}

async function withSession<T>(
  fn: (client: ReturnType<typeof makeClient>) => Promise<T>,
): Promise<T> {
  const prfOutput = await promptPrf();
  const session = createSecp256k1SigningSession({
    privateKey: deriveEvmKey(prfOutput),
  });
  try {
    return await fn(makeClient(session));
  } finally {
    session.end();
  }
}

export function getTestAusd(address: Hex): Promise<Hex> {
  return withSession((client) =>
    client.writeContract({
      address: AUSD_FAUCET,
      abi: faucetAbi,
      functionName: "requestFunds",
      args: [address],
      gas: 250_000n,
    }),
  );
}

export async function sendAusd(to: Hex, amount: string): Promise<Hex> {
  const decimals = await ausdDecimals();
  const hash = await withSession((client) =>
    client.writeContract({
      address: AUSD,
      abi: erc20,
      functionName: "transfer",
      args: [to, parseUnits(amount, decimals)],
      gas: 150_000n,
    }),
  );
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

// ---------- Ajo circles ----------

export type CircleView = {
  id: bigint;
  creator: Hex;
  contribution: bigint;
  decimals: number;
  maxMembers: number;
  roundDuration: number;
  currentRound: number;
  roundStart: bigint;
  started: boolean;
  finished: boolean;
  members: Hex[];
  paid: boolean[];
};

export async function loadCircle(id: bigint): Promise<CircleView | null> {
  const r = await publicClient.readContract({
    address: CIRCLE, abi: circleAbi, functionName: "getCircle", args: [id],
  });
  const [, creator, contribution, maxMembers, roundDuration, currentRound, roundStart, started, finished] = r;
  if (creator === zeroAddress) return null;
  const members = [...(await publicClient.readContract({
    address: CIRCLE, abi: circleAbi, functionName: "getMembers", args: [id],
  }))] as Hex[];
  const active = started && !finished;
  const paid = await Promise.all(
    members.map((m) =>
      active
        ? publicClient.readContract({
            address: CIRCLE, abi: circleAbi, functionName: "hasPaid", args: [id, currentRound, m],
          })
        : Promise.resolve(false),
    ),
  );
  return {
    id, creator, contribution, decimals: await ausdDecimals(), maxMembers,
    roundDuration, currentRound, roundStart, started, finished, members, paid,
  };
}

export async function createCircleTx(amount: string, maxMembers: number, roundSeconds: number): Promise<bigint> {
  const decimals = await ausdDecimals();
  const hash = await withSession((client) =>
    client.writeContract({
      address: CIRCLE,
      abi: circleAbi,
      functionName: "createCircle",
      args: [AUSD, parseUnits(amount, decimals), maxMembers, roundSeconds],
      gas: 350_000n,
    }),
  );
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const logs = parseEventLogs({ abi: circleAbi, logs: receipt.logs, eventName: "CircleCreated" });
  return logs[0].args.id;
}

export async function joinCircleTx(id: bigint): Promise<Hex> {
  const hash = await withSession((client) =>
    client.writeContract({
      address: CIRCLE, abi: circleAbi, functionName: "joinCircle", args: [id], gas: 250_000n,
    }),
  );
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/** One passkey tap: approves AUSD if needed, then contributes. */
export async function contributeTx(id: bigint, contribution: bigint): Promise<Hex> {
  return withSession(async (client) => {
    const owner = client.account.address;
    const allowance = await publicClient.readContract({
      address: AUSD, abi: erc20, functionName: "allowance", args: [owner, CIRCLE],
    });
    if (allowance < contribution) {
      const a = await client.writeContract({
        address: AUSD, abi: erc20, functionName: "approve",
        args: [CIRCLE, contribution * 20n], gas: 100_000n,
      });
      await publicClient.waitForTransactionReceipt({ hash: a });
    }
    const hash = await client.writeContract({
      address: CIRCLE, abi: circleAbi, functionName: "contribute", args: [id], gas: 200_000n,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  });
}

export async function payoutTx(id: bigint): Promise<Hex> {
  const hash = await withSession((client) =>
    client.writeContract({
      address: CIRCLE, abi: circleAbi, functionName: "payout", args: [id], gas: 400_000n,
    }),
  );
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export function friendlyError(e: unknown): string {
  if (isMeraError(e)) {
    switch (e.code) {
      case "PRF_UNAVAILABLE":
        return "This device or passkey app isn't supported yet. On Chrome, save the passkey to Google Password Manager.";
      case "PASSKEY_OPERATION_FAILED":
        return "That didn't go through. Tap to try again.";
      case "CRYPTO_UNAVAILABLE":
        return "This page needs a secure (https) connection.";
      default:
        return `Something went wrong (${e.code}).`;
    }
  }
  return e instanceof Error ? e.message : "Something went wrong.";
}