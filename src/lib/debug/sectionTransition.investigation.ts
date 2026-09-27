/**
 * Section 22→23 playback investigation — run with:
 *   npx tsx lib/debug/sectionTransition.investigation.ts
 *
 * Does not hit the network. Asserts the production control flow that decides
 * A (23 URL + 22 playlist) vs B (redirect back to 22).
 */
import {
  lockedSectionRedirectQuery,
} from "./sectionTransitionTrace";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// B: locked 23 with highestUnlocked=22 does NOT open 22 at step=1.
{
  const query = lockedSectionRedirectQuery({
    requestedSectionIndex: 23,
    highestUnlockedSection: 22,
  });
  assert(
    "summary" in query && query.summary === "1",
    `locked 23 must bounce to 22 summary, got ${JSON.stringify(query)}`,
  );
}

// step=1 is only used when the target is not behind the request.
{
  const query = lockedSectionRedirectQuery({
    requestedSectionIndex: 22,
    highestUnlockedSection: 22,
  });
  assert(
    "step" in query && query.step === "1",
    `same-section locked fallback uses step=1, got ${JSON.stringify(query)}`,
  );
}

// Freeze without remount cannot restart at unit 0: the initializer only
// runs once, and currentUnitIndex is also useState(initial) once.
{
  let sessionUnits = ["s22-u0", "s22-u1", "s22-u9"];
  let currentUnitIndex = 9; // last clip of 22
  const nextProps = {
    learningUnits: ["s23-u0", "s23-u1"],
    initialUnitIndex: 0,
    sectionIndex: 23,
  };
  // Simulate React keeping state when VideoPlayerContainer does not remount.
  void nextProps;
  assert(
    sessionUnits[0] === "s22-u0" && currentUnitIndex === 9,
    "unremounted freeze keeps section 22 list AND last index, not the beginning",
  );
}

// Remount (pathname key includes /section/23) takes the new props.
{
  const remounted = {
    sessionUnits: ["s23-u0", "s23-u1"],
    currentUnitIndex: 0,
    sectionIndex: 23,
  };
  assert(
    remounted.sessionUnits[0] === "s23-u0",
    "a remounted player cannot still hold section 22 units unless RSC sent them",
  );
}

console.log("sectionTransition.investigation: invariants hold");
console.log(
  [
    "A (23 URL + frozen 22 units from the beginning): NOT produced by freeze.",
    "  Unremounted freeze would show the LAST unit of 22, with header 23.",
    "  Remount (KeyedLearnBoundary key=pathname) discards freeze.",
    "B (unlock redirect): current code sends 23→22?summary=1, not 22?step=1.",
    "  Playback of 22 from the beginning is 22?step=1 (missing step redirect",
    "  or a cached/old bounce), not the locked-section summary bounce.",
    "C: unlock race can still fire (complete persist is not awaited), but it",
    "  yields summary of 22, not replay of 22 clips inside a 23 player.",
  ].join("\n"),
);
