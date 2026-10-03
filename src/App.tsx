import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import {
  createAccount, signIn, getBalances, getTestAusd, sendAusd,
  createCircleTx, joinCircleTx, contributeTx, payoutTx, loadCircle,
  friendlyError, publicClient, EXPLORER, type CircleView,
} from "./lib/wallet";

type Hex = `0x${string}`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function circleFromUrl(): bigint | undefined {
  const v = new URLSearchParams(location.search).get("circle");
  return v && /^\d+$/.test(v) ? BigInt(v) : undefined;
}

export default function App() {
  const [address, setAddress] = useState<Hex>();
  const [bal, setBal] = useState<{ mon: string; ausd: string }>();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [msg, setMsg] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const [circleId, setCircleId] = useState<bigint | undefined>(circleFromUrl());
  const [circle, setCircle] = useState<CircleView | null>();
  const [cAmount, setCAmount] = useState("10");
  const [cMembers, setCMembers] = useState("2");
  const [cSeconds, setCSeconds] = useState("120");
  const [openId, setOpenId] = useState("");

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(undefined); setMsg(undefined);
    try { await fn(); } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  }

  const refresh = async (a: Hex) => setBal(await getBalances(a));
  const reloadCircle = async () => {
    if (circleId !== undefined) setCircle(await loadCircle(circleId));
  };

  useEffect(() => {
    if (circleId === undefined) { setCircle(undefined); return; }
    let stop = false;
    const tick = async () => {
      try { const c = await loadCircle(circleId); if (!stop) setCircle(c); } catch { /* ignore */ }
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => { stop = true; clearInterval(t); };
  }, [circleId]);

  const login = (fn: () => Promise<Hex>) =>
    run(async () => { const a = await fn(); setAddress(a); await refresh(a); });

  const faucet = () => run(async () => {
    const hash = await getTestAusd(address!);
    await publicClient.waitForTransactionReceipt({ hash });
    await refresh(address!);
    setMsg("Test AUSD received.");
  });

  const send = () => run(async () => {
    const hash = await sendAusd(to as Hex, amount);
    await refresh(address!);
    setMsg(`Sent. Settled: ${EXPLORER}${hash}`);
  });

  const switchAccount = () => {
    setAddress(undefined); setBal(undefined);
    login(() => signIn(true));
  };

  const openCircle = (id: bigint) => {
    setCircleId(id);
    history.replaceState(null, "", `?circle=${id}`);
  };
  const closeCircle = () => {
    setCircleId(undefined);
    history.replaceState(null, "", location.pathname);
  };

  const create = () => run(async () => {
    const id = await createCircleTx(cAmount, Number(cMembers), Number(cSeconds));
    openCircle(id);
    await refresh(address!);
    setMsg(`Circle #${id} created. Share the invite link below.`);
  });

  const join = () => run(async () => {
    await joinCircleTx(circleId!);
    await reloadCircle(); await refresh(address!);
    setMsg("You joined the circle.");
  });

  const contribute = () => run(async () => {
    await contributeTx(circleId!, circle!.contribution);
    await reloadCircle(); await refresh(address!);
    setMsg("Contribution sent.");
  });

  const payout = () => run(async () => {
    await payoutTx(circleId!);
    await reloadCircle(); await refresh(address!);
    setMsg("Payout sent to this round's recipient.");
  });

  // derived circle state
  const me = address?.toLowerCase();
  const idx = circle ? circle.members.findIndex((m) => m.toLowerCase() === me) : -1;
  const isMember = idx >= 0;
  const paidN = circle ? circle.paid.filter(Boolean).length : 0;
  const now = Math.floor(Date.now() / 1000);
  const roundEnd = circle ? Number(circle.roundStart) + circle.roundDuration : 0;
  const active = !!circle && circle.started && !circle.finished;
  const ready = active && paidN > 0 && (paidN === circle!.members.length || now >= roundEnd);
  const iPaid = isMember && circle ? circle.paid[idx] : false;
  const recipient = active ? circle!.members[circle!.currentRound] : undefined;
  const pot = circle ? formatUnits(circle.contribution * BigInt(paidN), circle.decimals) : "0";
  const invite = circleId !== undefined ? `${location.origin}/?circle=${circleId}` : "";

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 420, margin: "0 auto", padding: 24 }}>
      <h1>Ajo</h1>
      <p>Savings circles that work across borders.</p>

      {!address ? (
        <>
          <button disabled={busy} onClick={() => login(createAccount)} style={btn}>Create account</button>
          <button disabled={busy} onClick={() => login(() => signIn())} style={light}>Sign in</button>
        </>
      ) : (
        <div>
          <p style={{ wordBreak: "break-all" }}>Address: {address}</p>
          <p>AUSD balance: <b>{bal?.ausd ?? "…"}</b> · MON (gas): {bal?.mon ?? "…"}</p>
          <button disabled={busy} onClick={faucet} style={btn}>Get test AUSD</button>
          <button disabled={busy} onClick={switchAccount} style={light}>Switch account</button>

          <hr />
          <h2>Savings circle</h2>

          {circleId === undefined ? (
            <>
              <h3>Start a circle</h3>
              <label>Contribution each round (AUSD)</label>
              <input value={cAmount} onChange={(e) => setCAmount(e.target.value)} inputMode="decimal" style={input} />
              <label>Members (2 to 20)</label>
              <input value={cMembers} onChange={(e) => setCMembers(e.target.value)} inputMode="numeric" style={input} />
              <label>Round length (seconds)</label>
              <input value={cSeconds} onChange={(e) => setCSeconds(e.target.value)} inputMode="numeric" style={input} />
              <button disabled={busy} onClick={create} style={btn}>Create circle</button>

              <h3>Open a circle</h3>
              <input placeholder="Circle number" value={openId} onChange={(e) => setOpenId(e.target.value)} inputMode="numeric" style={input} />
              <button disabled={!/^\d+$/.test(openId)} onClick={() => openCircle(BigInt(openId))} style={light}>Open</button>
            </>
          ) : circle === undefined ? (
            <p>Loading circle…</p>
          ) : circle === null ? (
            <>
              <p>No circle with that number.</p>
              <button onClick={closeCircle} style={light}>Back</button>
            </>
          ) : (
            <div>
              <h3>Circle #{String(circle.id)}</h3>
              <p>
                {formatUnits(circle.contribution, circle.decimals)} AUSD per round ·{" "}
                {circle.members.length}/{circle.maxMembers} members ·{" "}
                {circle.finished ? "Finished" : circle.started ? `Round ${circle.currentRound + 1} of ${circle.members.length}` : "Waiting for members"}
              </p>
              {active && (
                <p>
                  Paid this round: {paidN}/{circle.members.length} · Pot: {pot} AUSD<br />
                  Next payout goes to: <b>{recipient && recipient.toLowerCase() === me ? "you" : short(recipient!)}</b>
                </p>
              )}
              <ul>
                {circle.members.map((m, i) => (
                  <li key={m}>
                    {short(m)}{m.toLowerCase() === me ? " (you)" : ""}
                    {circle.started && !circle.finished ? (circle.paid[i] ? " ✓ paid" : " … not paid") : ""}
                  </li>
                ))}
              </ul>

              {!circle.started && !isMember && circle.members.length < circle.maxMembers && (
                <button disabled={busy} onClick={join} style={btn}>Join this circle</button>
              )}
              {active && isMember && !iPaid && (
                <button disabled={busy} onClick={contribute} style={btn}>
                  Contribute {formatUnits(circle.contribution, circle.decimals)} AUSD
                </button>
              )}
              {ready && (
                <button disabled={busy} onClick={payout} style={btn}>Pay out this round</button>
              )}
              {active && !ready && <p>Payout unlocks when everyone has paid, or when the round time runs out.</p>}

              <p style={{ wordBreak: "break-all" }}>Invite link: {invite}</p>
              <button onClick={() => navigator.clipboard.writeText(invite)} style={light}>Copy invite link</button>
              <button onClick={closeCircle} style={light}>Back</button>
            </div>
          )}

          <hr />
          <h3>Send AUSD</h3>
          <input placeholder="Recipient address (0x...)" value={to} onChange={(e) => setTo(e.target.value)} style={input} />
          <input placeholder="Amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} style={input} />
          <button disabled={busy || !to || !amount} onClick={send} style={btn}>Send</button>
        </div>
      )}

      {busy && <p>Working…</p>}
      {msg && <p style={{ wordBreak: "break-all" }}>{msg}</p>}
      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </main>
  );
}

const btn: React.CSSProperties = {
  display: "block", width: "100%", padding: 14, marginBottom: 12, fontSize: 16,
  border: 0, borderRadius: 10, background: "#0E3B34", color: "#fff",
};
const light: React.CSSProperties = { ...btn, background: "#eee", color: "#111" };
const input: React.CSSProperties = {
  display: "block", width: "100%", padding: 12, marginBottom: 12, fontSize: 16,
  boxSizing: "border-box", borderRadius: 8, border: "1px solid #ccc",
};