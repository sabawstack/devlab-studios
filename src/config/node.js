// Node, the DevLab router: states, tiers and the owner's approval record
// (spec G.3, MASCOT-01; owner decision Q-13). A state renders on public pages
// only once the owner has approved it on /brand (preview); until then the
// placements render nothing and /brand shows it for review. If the redraw
// fails the 24 px silhouette review, MASCOT-04 applies instead (symbol only).
//
// To approve: set the state to true, fill `reviewedOn` and `reviewer`, and
// record the decision in docs/brand/node.md in the same commit.

export const NODE_STATES = ['idle', 'holding', 'confirming', 'needs-person']

/** Base sizes in px and the drawing's viewBox per fidelity tier (spec G.3). */
export const NODE_TIERS = {
  mark: { size: 24, viewBox: [24, 28] },
  figure: { size: 96, viewBox: [96, 112] },
  scene: { size: 240, viewBox: [200, 112] },
}

export const NODE_ART = {
  reviewedOn: null,
  reviewer: null,
  states: { idle: false, holding: false, confirming: false, 'needs-person': false },
}

export function isNodeReady(state) {
  return NODE_ART.states[state] === true
}
