# Phase 11 — Natural continuity and presence

## Decision

Recall does not need another memory store. It needs a narrow conversational
decision layer between attention and personality.

Deterministic systems remain responsible for truth, provenance, boundaries,
sensitivity, cooldowns, interruption cost, repair priority, and candidate
eligibility. A capable language model then chooses among only the eligible
possibilities—or chooses no memory—and writes the one short spoken move. This
uses model intelligence for judgment and taste without allowing it to bypass
memory policy.

## Research distilled

- Human conversation accumulates common ground. Continuity therefore works
  best when prior knowledge is used implicitly, not announced as retrieval.
- Memory-aware proactive dialogue research separates historical-topic
  retrieval from deciding whether the current moment can carry a topic shift.
  Its strongest instruction is also its simplest: a whole conversation may
  contain no historical topic shift; never force one.
- Mixed-initiative work shows that models can transition fluently, but become
  aggressive without an explicit planning step and a constrained action set.
- Follow-up questions increase interpersonal liking when they demonstrate
  responsiveness. A question ritual does the opposite. Statements,
  backchannels, reactions, and limited self-expression also increase user
  initiative.
- Voice proactivity is an interruptibility problem. Mood, current activity,
  movement, social context, and transition moments matter more than raw memory
  relevance. Recall must use only signals it actually has and keep uncertainty
  alive.
- Fast responses often signal conversational connection, while context-aware
  pauses can improve perceived listening. Latency and silence are therefore
  different: pending work should not feel frozen, but human quiet should not be
  automatically filled.
- Existing companion systems mostly expose memory capacity, pinned facts, or
  background synthesis. Recall's advantage is not remembering more; it is
  deciding when remembered life belongs in the room.

Primary references:

- [Interpersonal Memory Matters: A New Task for Proactive Dialogue Utilizing Conversational History](https://aclanthology.org/2025.conll-1.4/)
- [Prompting and Evaluating Large Language Models for Proactive Dialogues](https://aclanthology.org/2023.findings-emnlp.711/)
- [Effective Social Chatbot Strategies for Increasing User Initiative](https://aclanthology.org/2021.sigdial-1.11/)
- [OTTers: One-turn Topic Transitions for Open-Domain Dialogue](https://aclanthology.org/2021.acl-long.194/)
- [Beyond Task-Oriented and Chitchat Dialogues](https://aclanthology.org/2025.emnlp-main.672/)
- [The Design and Implementation of XiaoIce](https://aclanthology.org/2020.cl-1.2/)
- [It Helps to Ask: The Cumulative Benefits of Asking Follow-up Questions](https://www.hks.harvard.edu/publications/it-helps-ask-cumulative-benefits-asking-follow-questions)
- [Opportune Moments for Proactive Interactions with Smart Speakers](https://doi.org/10.1145/3411810)
- [ElevenLabs conversation flow](https://elevenlabs.io/docs/eleven-agents/customization/conversation-flow)
- [ElevenLabs skip turn](https://elevenlabs.io/docs/eleven-agents/customization/tools/system-tools/skip-turn)

## Runtime architecture

```text
canonical truth + active threads + prospective + relationship state
                              |
                              v
                   deterministic attention
        truth / safety / sensitivity / cooldown / timing gates
                              |
                         eligible set
                              |
                              v
                      presence planner LLM
         choose one candidate OR simple presence OR silence
                              |
                  validate ID, act, wording, novelty
                              |
                 re-run policy immediately before use
                              |
                              v
                    relationship expression
                              |
                   ElevenLabs expressive voice
```

The planner never sees blocked candidates. It cannot restore one by choosing
it. Its output is rejected when the candidate ID is unknown, the act does not
fit the candidate, the line exposes memory machinery, the line exceeds the
spoken budget, or it substantially repeats a recent opening.

## Session start

1. While the page is idle, Recall prepares the next opening in the background.
2. Attention compiles up to five eligible possibilities.
3. The planner may select one, decline all of them, or lead with repair.
4. The prepared plan is stored in a short-lived, one-shot server cache.
5. On tap, the server recomputes policy and confirms that the selected
   candidate is still eligible.
6. A valid plan is consumed once and injected as the ElevenLabs first message.
7. If preparation or validation fails, Recall says only `Hey.` and makes no
   personal claim.

This keeps model generation off the critical voice-start path in the common
case. A live local smoke test generated the plan in the background and consumed
it at start in about 350 ms.

## Lulls

After Recall finishes speaking, the client allows seven seconds of genuine
quiet before asking for one lull decision. The ElevenLabs silence turn is now
fourteen seconds rather than six.

- `action=wait`: call the native `skip_turn` tool. Do not say “still there?”
  and do not manufacture a topic.
- `action=speak`: carry one authorized thought naturally. Never add a second
  memory.
- Only one lull plan is allowed per user-turn epoch. Recall cannot keep
  prompting because the user remained quiet.
- Any detected user speech cancels the pending lull work. Stale results cannot
  enter a newer turn.

## Variation without randomness theater

Variation comes from choosing among conversational acts, not from rotating a
bag of greetings:

- resume a live thread;
- ask one tethered follow-up;
- make a thoughtful observation;
- give a practical nudge;
- offer a returning memory lightly;
- use one authorized shared callback;
- clarify uncertainty;
- repair;
- offer simple presence;
- wait.

The last five used acts and actual spoken openings are included only as
anti-repetition evidence. A near-duplicate is rejected. Urgent obligations and
repair may override stylistic variety, but never safety or truth.

## Relationship and provenance

The selected attention decision is recorded only when a prepared plan is
consumed, not while it is merely prefetched. The session handoff records the
planned act, planned line, actual first spoken line, candidate kind, and
attention decision ID. Evidence from that decision joins the handoff evidence
graph, so deleting the underlying memory also removes the dependent derived
continuity history.

Relationship repair still outranks humor. Learned dialect may tune warmth,
brevity, directness, initiative, and teasing only after the final attention
choice. A model cannot charm its way past an unresolved mistake.

## Deliberate exclusions

- No new vector database or memory category.
- No unconstrained LLM browsing of the continuity kernel for proactive ideas.
- No random greeting templates.
- No engagement objective based on conversation length.
- No fake inner life or claims about what Recall did while absent.
- No repeated “I was wondering” opener.
- No question on every turn.
- No automatic “still there?” after a timer.

## Evaluation

The phase adds a deterministic 44-check replay suite covering:

- blocked and sensitive candidate exclusion;
- model selection only inside the eligible set;
- the model declining a high-ranked candidate;
- statement-based continuity and question-free openings;
- explicit lull silence mapped to `skip_turn`;
- invalid IDs and candidate/act mismatches;
- memory-machinery wording rejection;
- short spoken-word limits;
- near-duplicate opening rejection;
- repair priority;
- one-shot prefetch consumption;
- actual spoken-opening history;
- attention/evidence provenance in handoffs;
- SQLite integrity.

The existing full release gate remains authoritative for canonical memory,
truth, threads, context, continuity, attention, relationship intelligence,
learning, the continuity kernel, hardening, routing, and product behavior.
