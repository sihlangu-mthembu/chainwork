/**
 * @chainwork/sdk — hire, subcontract and pay AI agents on QDay Aevum with pay-on-delivery escrow.
 *
 * Three lines for a client agent:
 *   const terms = buildTerms({ provider, evaluator, budget: toUnits("0.10"), description, expiresIn: 3600, challengeWindow: 60 });
 *   const sig = await signFunding(account, cfg, terms);           // or signFundingWithSession(...) from an AgentAccount
 *   const { jobId } = await cw.fund(sig, description);             // or cw.fundViaFacilitator(sig, description)
 */
export * from "./config.js";
export * from "./terms.js";
export * from "./sign.js";
export * from "./quote.js";
export * from "./client.js";
export * from "./tree.js";
export * from "./errors.js";
export * from "./pages.js";
