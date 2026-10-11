import { ReinLine } from "./ReinLine";

const STEPS = [
  { title: "Create a rein", text: <>Set the agent’s address, your limits and the merchants it may pay. Deposit USDC. It takes an approval and one transaction.</> },
  { title: "The agent pays", text: <>It calls <span className="mono">pay</span> with a recipient, an amount and a memo. The contract answers Paid, Held or Blocked. It never reverts for a rule.</> },
  { title: "You stay in charge", text: <>Approve or deny held payments, freeze the agent, withdraw your balance. The dashboard shows every event as it lands.</> },
];

/**
 * Three numbered steps. Each numeral sits on a 72px disc; the rein line runs behind the discs from 1 to 2 to 3
 * (across the row on desktop, down the left when stacked). When the section scrolls into view the line draws,
 * each disc scales in as the line reaches it, then its numeral appears. Reduced motion: everything is just there.
 */
export function Steps() {
  return (
    <ol className="steps2 reveal-steps">
      {STEPS.map((s, i) => (
        <li className="step2" key={s.title} tabIndex={0} style={{ ["--i" as string]: i }}>
          {i < STEPS.length - 1 && (
            <>
              <ReinLine className="link link-h" draw={false} />
              <ReinLine className="link link-v" vertical draw={false} />
            </>
          )}
          <span className="disc" aria-hidden="true"><span className="num2">{i + 1}</span></span>
          <div className="step2-text">
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
