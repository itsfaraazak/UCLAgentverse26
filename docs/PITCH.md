# Pitch and demo script (4 minutes + 2 minutes judge testing)

## The biology you need (30-second version for presenters)

- **A variant** is a spelling difference in someone's DNA compared with the reference genome.
- **Variant interpretation** asks whether that difference causes disease. The answer is one of five labels: *Pathogenic*, *Likely Pathogenic*, *Uncertain Significance (VUS)*, *Likely Benign* or *Benign*.
- **ACMG criteria** are the official rulebook. Each rule (for example, "very rare in the population" or "breaks the protein") adds or subtracts points, and the total gives the label.
- **The evidence comes from three sources:**
  - **gnomAD:** how common the variant is in healthy people. Common usually means harmless.
  - **AlphaMissense:** DeepMind's AI score for whether a single amino-acid change is damaging.
  - **ClinVar:** what expert labs have already concluded. We hide it from the classifier and use it as the answer key.
- **rs334** is the sickle-cell mutation. It's a famous trap: it's common (carriers are protected from malaria) and AlphaMissense scores it benign, yet it causes sickle-cell disease.
- **BRCA1 c.5266dupC** is a well-known breast-cancer risk mutation. It breaks the protein, and every source agrees it's pathogenic.

## Before you walk on

- [ ] `pnpm build && pnpm start` on the demo laptop, with `.env.local` holding the Gemini key. Open `http://localhost:3000`.
- [ ] Set your identity, top right ("Who are you?"): your name, role *Clinical scientist*.
- [ ] Click **Reset demo**. Then **pre-run rs334** ("Assess rs334 in a patient with recurrent pain crises") so it's finished before you start. It takes about 60 seconds, because the model is slow.
- [ ] Keep `/evaluation` open in a second tab.
- [ ] If the venue Wi-Fi is bad, the app still runs: evidence for the demo variants is cached, and if Gemini fails a deterministic pipeline finishes the run and says so on screen.

## The 4-minute pitch

**0:00 to 0:30, the problem.**
"When a patient's genome is sequenced, a clinical scientist has to decide, variant by variant, whether each DNA change causes disease. They pull population data, AI predictions and published evidence together and apply the ACMG rulebook by hand. It's slow, and when AI is involved it's unclear what the model said versus what the human decided. We built the tool software engineers take for granted, version control with required checks and review, for that decision."

**0:30 to 1:30, live run (BRCA1).** Click the chip *"Interpret BRCA1 c.5266dupC…"*. It takes about 20 seconds; narrate while the cards appear.
- "The **safety gate** runs first. It's deterministic, before any AI. Interpreting a variant is allowed."
- "Gemini **plans**, then calls our tools. The **evidence** is real data from gnomAD and AlphaMissense, each value with its source and licence."
- "The **ACMG classifier** is a required check the agent cannot skip: frameshift in a known disease gene, absent from the population, 10 points, Pathogenic."
- "Only then do we reveal **ClinVar**, the expert answer we held out. It agrees."
- "Every card is a **delta**: who made it, from what evidence, with a content hash, exactly like a commit."

**1:30 to 2:45, the hard case (rs334, already run).** Click the rs334 branch.
- "Here's why a human must stay in the loop. This is the sickle-cell mutation. It's common, because carriers resist malaria, and DeepMind's AlphaMissense scores it benign. So the rulebook lands on *Uncertain*."
- "But ClinVar says **Pathogenic**, a **major disagreement**. See the merge gate on the right: merging is **blocked** until a named human signs off."
- Dismiss **BS1** live on the classification card, with the reason "Recessive disease; carrier frequency raised by malaria selection". "Humans can adjust the evidence, and the classifier re-runs. The history forks; nothing is overwritten."
- Optional: comment "Why does AlphaMissense call this benign?" with *ask the agent* ticked. The agent answers with citations to the deltas (about 20 seconds).
- Sign off as *Pathogenic* with a rationale, then **Merge into main**. "Now it's in the signed case record, and you can see exactly what the AI did and what the human decided."

**2:45 to 3:15, the safety boundary.** Click the chip *"Propose disrupting BRCA1"* (red-team).
- "Edit proposals go through a biosafety policy. Disrupting a tumour suppressor is refused instantly, before any model call, and the request text is not even stored."

**3:15 to 3:50, the evaluation** (switch to the `/evaluation` tab).
- "We tested on 200 expert-reviewed ClinVar variants, with ClinVar hidden. AlphaMissense alone makes more calls, but called 5 disease-causing variants benign. Our classifier made zero such errors. It's deliberately conservative and sends uncertainty to a human, and every one of those pathogenic-but-uncertain cases would have been flagged for sign-off. We're upfront that it implements 8 of the 28 rules and is not a clinical tool."

**3:50 to 4:00, close.**
"Next step: pilot as a second reader in one lab's interpretation queue, and measure time per variant. Judges, try any variant you like."

## Judge testing (2 minutes)

Hand over the keyboard. The input box takes:
- rsIDs: `rs113993960`, `rs28934578`, `rs1801133`
- gene + HGVS: `TP53 p.Arg175His`, `CFTR p.Phe508del`, `MLH1 c.350C>T`
- natural language: "Is CFTR p.Phe508del pathogenic?"

Each run takes 20 to 60 seconds; say "the model is thinking, every step streams in as a delta". If a variant isn't found, the agent says so and asks for an rsID or gene + HGVS. That's the correct behaviour, not a crash.

## Likely questions

- **"Where's the agent? Isn't it mostly deterministic?"** Gemini decides what to look up, runs tools in parallel, searches literature, answers follow-ups and explains disagreements. We deliberately keep the *decision* deterministic and human-owned, because in a clinical setting you need to re-derive every classification by hand.
- **"Why is coverage only 15%?"** Our rule engine implements 8 of the ~28 ACMG criteria, so most missense variants can't reach a decisive call. That's honest, not tuned. Adding ClinGen-calibrated computational thresholds and the remaining criteria is the next step. The important number is zero false reassurance.
- **"Isn't comparing to ClinVar circular?"** Partly, because curators also use gnomAD and predictors, and we say so on the evaluation page. It measures consistency with expert curation, not clinical validity.
- **"What about novel variants with no ClinVar record?"** Then there's nothing to disagree with, and the Uncertain call itself sends the variant to a human.
- **"Why does AlphaMissense get sickle cell wrong?"** The sickle mutation causes disease by making haemoglobin stick together in low oxygen (a gain of function). Predictors trained on whether a change is tolerated across evolution tend to miss that mechanism.
- **"Is the data licensed?"** Yes. gnomAD is CC0, AlphaMissense is CC BY 4.0, and ClinVar is unrestricted. Each value shows its source and licence. There's no patient data.
- **"Gene editing?"** Edit proposals are modelled at sequence level only, with the before and after codon and amino acid, and are screened by policy. We never produce guides, primers or protocols.
