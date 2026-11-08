# Ajo

**Save together. Take turns.**

Ajo is a rotating savings circle on [Monad](https://monad.xyz). A group agrees on an amount and a schedule. Each round, everyone pays in and one member receives the whole pot. When the circle ends, every member has collected once.

**Live:** https://ajo-circle-teal.vercel.app/

## How it works

1. **Form the circle.** Pick the members, the contribution amount, and how often to pay. The payout order is set before anyone pays.
2. **Pay each round.** Every member adds their share. Funds are held by the smart contract, not by any one person.
3. **Collect your turn.** When it's your round, you receive the full pot. The circle then moves to the next member.

Example: 6 members paying $100 per round makes a $600 pot each round. Over 6 rounds, every member receives $600 once.

## Project structure

```
ajo/
├── contracts/   Smart contracts
├── scripts/     Scripts for the contracts
├── src/         Frontend source (Vite + TypeScript)
├── index.html   App entry
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## Run it locally (Ubuntu)

You need Node.js 18 or newer and git.

```bash
# Install Node with nvm (skip if you already have Node 18+)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install --lts

# Get the code
git clone https://github.com/BenCoy09/ajo.git
cd ajo
npm install

# Start the dev server
npm run dev
```

Open the local address printed in the terminal (Vite usually uses http://localhost:5173).

To make a production build:

```bash
npm run build
npm run preview
```

## Environment variables

If the app or scripts need keys or addresses, put them in a `.env` file in the project root. Never commit this file, and never put private keys in any file that gets pushed.

## Network

Built for Monad. Add your RPC URL and contract address to `.env` when you deploy.

## Status

Early stage, running on testnet. You can create an account, start or join a circle, contribute each round and pay out. Amounts are in AUSD, with MON used for gas, and live circle activity is read through Envio HyperRPC.

## Roadmap

- [x] Homepage with interactive circle demo
- [x] Account sign in
- [x] Create a circle
- [x] Invite link and join
- [x] Pay into a round
- [x] Payout and next round
- [x] Live circle activity
- [ ] Mainnet launch

## Author

Built by Benny ([@benny___5](https://x.com/benny___5)).

## License

MIT
