import fs from "node:fs";
import solc from "solc";
import { createPublicClient, createWalletClient, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";

const KEY_FILE = ".deployer-key";
let key = process.env.PRIVATE_KEY ?? (fs.existsSync(KEY_FILE) ? fs.readFileSync(KEY_FILE, "utf8").trim() : null);
if (!key) {
  key = generatePrivateKey();
  fs.writeFileSync(KEY_FILE, key);
}
const account = privateKeyToAccount(key);
const publicClient = createPublicClient({ chain: monadTestnet, transport: http() });

const balance = await publicClient.getBalance({ address: account.address });
if (balance < 10n ** 17n) {
  console.log("\nFund this deployer with test MON at https://faucet.monad.xyz, then run this script again:\n");
  console.log(account.address, "\n");
  process.exit(0);
}

const source = fs.readFileSync("contracts/AjoCircle.sol", "utf8");
const input = {
  language: "Solidity",
  sources: { "AjoCircle.sol": { content: source } },
  settings: {
    evmVersion: "cancun",
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (out.errors ?? []).filter((e) => e.severity === "error");
if (errors.length) {
  console.error(errors.map((e) => e.formattedMessage).join("\n"));
  process.exit(1);
}
const compiled = out.contracts["AjoCircle.sol"].AjoCircle;
fs.mkdirSync("src/generated", { recursive: true });
fs.writeFileSync("src/generated/AjoCircle.abi.json", JSON.stringify(compiled.abi, null, 2));

const wallet = createWalletClient({ account, chain: monadTestnet, transport: http() });
const hash = await wallet.deployContract({ abi: compiled.abi, bytecode: "0x" + compiled.evm.bytecode.object });
console.log("Deploying... tx:", hash);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log("\nAjoCircle deployed at:", receipt.contractAddress, "\n");
console.log("Send me this address.");