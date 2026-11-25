# Demo video: recording plan (4 minutes)

Everything shown is the **live Aevum deployment**, through the hosted dashboard's **replay** of
transactions that already happened on chain. Nothing has to run while you record, so nothing can
fail on camera. Words to say are in quotes; say them in your own way if that feels more natural.

## Before you record

- [ ] Open these tabs in this order, browser zoom at 110%:
  1. https://sihlangu-mthembu.github.io/chainwork/#job=7 (the zero-capital job)
  2. https://sihlangu-mthembu.github.io/chainwork/#job=11 (the bad-worker job)
  3. https://explorer-test.qday.info/tx/0x55eeba69b878f8c0a7cdad7cfcb6c4102818b94e7bec01705e9fd649e2d6fb46 (the challenge)
  4. https://github.com/sihlangu-mthembu/chainwork (the README)
- [ ] On tabs 1 and 2, wait until "What happened" lists the steps (a few seconds).
- [ ] Turn off notifications. Close anything personal. No passwords or keys anywhere on screen.
- [ ] Recorder: OBS (free) or Windows Game Bar (Win+Alt+R), 1920×1080, with your microphone.
- [ ] Do one practice run of the replay on tab 1: click the page once, press **Space** to play,
      **L** to jump back to live.

## Script

**0:00 to 0:25: the problem** (tab 1, the top of the page)

"AI agents are starting to hire other agents. Two things get in the way: whoever pays first has to
trust the other side, and the agent in the middle, the one that splits a job up, needs cash it
usually doesn't have. Chainwork fixes both, on Aevum."

**0:25 to 1:25: zero capital** (tab 1, press Space to replay)

As the replay runs, point at the money map:

"A client locks 0.10 tUSD8 in escrow with one signature, and pays no gas. The coordinator agent
holds zero tUSD8. It still hires two specialists, for 0.03 and 0.04, straight out of the locked
budget: its on-chain track record works as a credit line. Each worker delivers, a 30-second
challenge window passes, and everyone is paid."

Point at "Where the 0.10 tUSD8 went": "Every cent accounted for, and the coordinator never put up
any money of its own."

**1:25 to 2:40: a worker cheats** (tab 2, press Space)

"Now one worker delivers wrong numbers. A watcher re-runs the check and challenges inside the
window." When the red CHALLENGED stamp lands: "The evaluator rejects it. The bad worker's bond goes
to the coordinator it hurt, its budget comes back, and the coordinator hires a backup in the same
job."

Switch to tab 3: "This is that challenge on the Aevum explorer: real transactions, not a mock-up."

Back on tab 2, point at the ledger: "Still, every cent of the 0.10 is accounted for. Nobody was
paid for work that failed."

**2:40 to 3:20: safety** (tab 2, scroll down to the operator desk, click "Kill switches")

"Nothing here can trap the client's money. If nobody delivers, anyone can trigger the refund, and
no admin or agent can block it. Agents pay through a smart account with spending caps, and the
owner has a kill switch. A prompt-injected agent can't redirect payment: the SDK, the agent and the
smart account all refuse it. No AI model ever decides when money moves."

**3:20 to 4:00: proof** (tab 4, scroll to "Addresses")

"Six contracts are live on Aevum, and a script proves the code at each address is exactly this open
source. Every scenario you saw ran live on Aevum, with an explorer link for every transaction in the
evidence log. It's built on the ERC-8183 job standard and x402 payments, and it's MIT licensed.
That's Chainwork."

## After recording

- [ ] Watch it once: no personal tabs, nothing private visible.
- [ ] Upload to YouTube (Unlisted is fine) and paste the link into DoraHacks and `docs/SUBMISSION.md`.

## Where the numbers come from

All from the live run on 25 Nov 2026 ([evidence log](evidence/aevum-run.log)): job #7 (S1), job #11
(S2, worker #13 rejected, backup #14 paid), job #10 (S3 refund), job #1 (Gate 1).
