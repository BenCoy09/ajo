import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import {
  createAccount, signIn, getBalances, getTestAusd, sendAusd,
  createCircleTx, joinCircleTx, contributeTx, payoutTx, loadCircle, loadActivity,
  friendlyError, publicClient, EXPLORER, type CircleView, type Activity,
} from "./lib/wallet";
import "./ajo.css";

type Hex = `0x${string}`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function circleFromUrl(): bigint | undefined {
  const v = new URLSearchParams(location.search).get("circle");
  return v && /^\d+$/.test(v) ? BigInt(v) : undefined;
}

function Splash({ out, onSkip }: { out: boolean; onSkip: () => void }) {
  const d = (s: string) => ({ animationDelay: s });
  return (
    <div id="splash" className={out ? "out" : ""} role="presentation">
      <svg viewBox="0 0 300 330" aria-label="Ajo">
        <circle className="ringdraw" cx="150" cy="140" r="95" fill="none" stroke="#1F6B5C" strokeWidth="5" />
        <circle className="sd" style={d(".5s")} cx="150" cy="140" r="14" fill="none" stroke="#F0B429" strokeWidth="12" />
        <g fill="#F0B429">
          <circle className="sd" style={d(".6s")} cx="232" cy="92" r="17" />
          <circle className="sd" style={d(".7s")} cx="232" cy="188" r="17" />
          <circle className="sd" style={d(".8s")} cx="150" cy="235" r="17" />
          <circle className="sd" style={d(".9s")} cx="68" cy="188" r="17" />
          <circle className="sd" style={d("1s")} cx="68" cy="92" r="17" />
        </g>
        <g className="orbit"><circle cx="150" cy="45" r="30" fill="#F6EBCB" /></g>
        <text className="word" x="150" y="318" textAnchor="middle">ajo</text>
      </svg>
      <button className="skip" onClick={onSkip}>Skip</button>
    </div>
  );
}

function CircleDemo() {
  const names = ["Ada", "Tunde", "Zainab", "Emeka", "Ife", "Kemi"];
  const N = names.length, cx = 150, cy = 135, R = 95;
  const [cur, setCur] = useState(0);
  const [amt, setAmt] = useState(100);
  const pos = names.map((_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / N;
    return [cx + R * Math.cos(a), cy + R * Math.sin(a)];
  });
  return (
    <div className="stage">
      <svg viewBox="0 0 300 280" role="img" aria-label="A circle of six members. The cream dot marks who receives the pot this round.">
        <circle cx={cx} cy={cy} r={R} fill="none" stroke="#1F6B5C" strokeWidth="4" />
        <circle cx={cx} cy={cy} r="11" fill="none" stroke="#F0B429" strokeWidth="9" />
        {pos.map(([x, y], i) => (
          <g key={i} tabIndex={0} role="button" aria-label={names[i]} style={{ cursor: "pointer" }}
            onClick={() => setCur(i)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCur(i); } }}>
            <circle className="dot" cx={x} cy={y} r={i === cur ? 22 : 16}
              fill={i === cur ? "#F6EBCB" : i < cur ? "#7a8f45" : "#F0B429"} />
            <text x={x} y={y + (y < cy ? -28 : 36)} textAnchor="middle" fill="#a9c2b7" fontSize="13">{names[i]}</text>
          </g>
        ))}
      </svg>
      <div className="readout" aria-live="polite">
        Round {cur + 1} of {N}: <b>{names[cur]}</b> receives <b>${(amt * N).toLocaleString()}</b>
      </div>
      <div className="ctl">
        <label htmlFor="amt">Each pays</label>
        <input id="amt" type="range" min={10} max={500} step={10} value={amt} onChange={(e) => setAmt(Number(e.target.value))} />
        <span>${amt}</span>
      </div>
      <button className="btn" onClick={() => setCur((cur + 1) % N)}>Next round</button>
      <div className="small">Demo. Tap a member to jump to their turn.</div>
    </div>
  );
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
  const [activity, setActivity] = useState<Activity[]>([]);
  const [cAmount, setCAmount] = useState("10");
  const [cMembers, setCMembers] = useState("2");
  const [cSeconds, setCSeconds] = useState("120");
  const [openId, setOpenId] = useState("");

  const [splash, setSplash] = useState<"on" | "out" | "off">(() => {
    if (circleFromUrl() !== undefined) return "off";
    try { if (sessionStorage.getItem("ajo-seen") === "1") return "off"; } catch { /* ignore */ }
    return "on";
  });
  const hideSplash = () => {
    setSplash("out");
    try { sessionStorage.setItem("ajo-seen", "1"); } catch { /* ignore */ }
    setTimeout(() => setSplash("off"), 950);
  };
  useEffect(() => {
    if (splash !== "on") return;
    const t = setTimeout(hideSplash, 3600);
    return () => clearTimeout(t);
  }, [splash]);

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

  useEffect(() => {
    if (circleId === undefined) { setActivity([]); return; }
    let stop = false;
    const tick = async () => {
      try { const a = await loadActivity(circleId); if (!stop) setActivity(a); } catch { /* ignore */ }
    };
    tick();
    const t = setInterval(tick, 6000);
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

  const describe = (a: Activity) => {
    const who = a.who.toLowerCase() === me ? "You" : short(a.who);
    const amt = a.amount !== undefined && circle ? formatUnits(a.amount, circle.decimals) : "";
    if (a.kind === "joined") return `${who} joined`;
    if (a.kind === "contributed") return `${who} paid ${amt} AUSD (round ${(a.round ?? 0) + 1})`;
    if (a.kind === "payout") return `${who} received ${amt} AUSD (round ${(a.round ?? 0) + 1})`;
    return `${who} missed round ${(a.round ?? 0) + 1}`;
  };

  const header = (
    <header className="top">
      <span className="brand">
        <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true">
          <circle cx="17" cy="17" r="12" fill="none" stroke="#1F6B5C" strokeWidth="2" />
          <circle cx="17" cy="4" r="4.5" fill="#F6EBCB" />
          <circle cx="28" cy="23" r="3" fill="#F0B429" />
          <circle cx="6" cy="23" r="3" fill="#F0B429" />
          <circle cx="17" cy="17" r="2.5" fill="#F0B429" />
        </svg>
        ajo
      </span>
      {address && <span className="chip">{short(address)}</span>}
    </header>
  );

  const status = (
    <>
      {busy && <p className="muted">Working…</p>}
      {msg && <p className="break ok">{msg}</p>}
      {error && <p className="err">{error}</p>}
    </>
  );

  return (
    <>
      {splash !== "off" && <Splash out={splash === "out"} onSkip={hideSplash} />}

      {!address ? (
        <div className="wrap">
          {header}
          <main>
            <div className="hero">
              <div>
                <h1>Save together. Take turns.</h1>
                <p className="lead">
                  Savings circles that work across borders. Everyone pays in each round, and one member takes the whole pot, until everyone has had their turn.
                </p>
                <div className="row">
                  <button className="btn" disabled={busy} onClick={() => login(createAccount)}>Create account</button>
                  <button className="btn light" disabled={busy} onClick={() => login(() => signIn())}>Sign in</button>
                </div>
                {status}
              </div>
              <CircleDemo />
            </div>

            <section className="band">
              <h2>One circle, everyone collects once.</h2>
              <div className="steps">
                <div><h3>Form the circle</h3><p>Pick the amount, the number of members and how long each round lasts. Share the invite link.</p></div>
                <div><h3>Pay each round</h3><p>Everyone adds their share. The pot sits in the contract, not in one person's account.</p></div>
                <div><h3>Collect your turn</h3><p>When it's your round, the full pot goes to you. Then the circle moves on to the next member.</p></div>
              </div>
            </section>
          </main>
          <footer className="foot">ajo · A savings circle on Monad</footer>
        </div>
      ) : (
        <div className="wrap narrow">
          {header}
          <main>
            <div className="card">
              <p className="break muted">Address: {address}</p>
              <p>AUSD balance: <b>{bal?.ausd ?? "…"}</b> · MON (gas): {bal?.mon ?? "…"}</p>
              <button className="btn" disabled={busy} onClick={faucet}>Get test AUSD</button>
              <button className="btn light" disabled={busy} onClick={switchAccount}>Switch account</button>
            </div>

            <div className="card">
              <h2>Savings circle</h2>

              {circleId === undefined ? (
                <>
                  <h3>Start a circle</h3>
                  <label>Contribution each round (AUSD)</label>
                  <input className="input" value={cAmount} onChange={(e) => setCAmount(e.target.value)} inputMode="decimal" />
                  <label>Members (2 to 20)</label>
                  <input className="input" value={cMembers} onChange={(e) => setCMembers(e.target.value)} inputMode="numeric" />
                  <label>Round length (seconds)</label>
                  <input className="input" value={cSeconds} onChange={(e) => setCSeconds(e.target.value)} inputMode="numeric" />
                  <button className="btn" disabled={busy} onClick={create}>Create circle</button>

                  <h3>Open a circle</h3>
                  <input className="input" placeholder="Circle number" value={openId} onChange={(e) => setOpenId(e.target.value)} inputMode="numeric" />
                  <button className="btn light" disabled={!/^\d+$/.test(openId)} onClick={() => openCircle(BigInt(openId))}>Open</button>
                </>
              ) : circle === undefined ? (
                <p>Loading circle…</p>
              ) : circle === null ? (
                <>
                  <p>No circle with that number.</p>
                  <button className="btn light" onClick={closeCircle}>Back</button>
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
                    <button className="btn" disabled={busy} onClick={join}>Join this circle</button>
                  )}
                  {active && isMember && !iPaid && (
                    <button className="btn" disabled={busy} onClick={contribute}>
                      Contribute {formatUnits(circle.contribution, circle.decimals)} AUSD
                    </button>
                  )}
                  {ready && (
                    <button className="btn" disabled={busy} onClick={payout}>Pay out this round</button>
                  )}
                  {active && !ready && <p className="muted">Payout unlocks when everyone has paid, or when the round time runs out.</p>}

                  <h4>Live activity <small className="muted" style={{ fontWeight: "normal" }}>(via Envio HyperRPC)</small></h4>
                  {activity.length === 0 ? (
                    <p className="muted">No activity yet.</p>
                  ) : (
                    <ul>
                      {[...activity].reverse().slice(0, 8).map((a) => (
                        <li key={a.tx + a.kind + a.who}>
                          {describe(a)}{" "}
                          <a href={EXPLORER + a.tx} target="_blank" rel="noreferrer">tx</a>
                        </li>
                      ))}
                    </ul>
                  )}

                  <p className="break muted">Invite link: {invite}</p>
                  <button className="btn light" onClick={() => navigator.clipboard.writeText(invite)}>Copy invite link</button>
                  <button className="btn light" onClick={closeCircle}>Back</button>
                </div>
              )}
            </div>

            <div className="card">
              <h3>Send AUSD</h3>
              <input className="input" placeholder="Recipient address (0x...)" value={to} onChange={(e) => setTo(e.target.value)} />
              <input className="input" placeholder="Amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <button className="btn" disabled={busy || !to || !amount} onClick={send}>Send</button>
            </div>

            {status}
          </main>
        </div>
      )}
    </>
  );
}
