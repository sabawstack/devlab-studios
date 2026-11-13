/**
 * The scene registry (audit BR.8 / UX-02): the illustrated scenes the public
 * site may show, and the only values a CMS `scene` block, a hero `visualId`, an
 * article `heroVisualId` or a project `systemDiagramId` can name.
 *
 * Art is code-owned. The CMS selects a scene by id and may override its
 * caption; it never uploads or edits SVG. `artReady` stays false until the
 * scene's SVG has been drawn and approved (docs/brand/scenes.md): until then a
 * block that names it renders its frame and caption only.
 */
export interface SceneDefinition {
  id: string
  /** The plan's reference code (S1-S6). */
  code: string
  title: string
  /** Default figure caption; a CMS block may override it. */
  caption: string
  /** Accessible description of what the art shows. */
  alt: string
  /** Aspect ratios of the wide (desktop) and tall (phone) crops, as w/h. */
  aspect: { wide: [number, number]; tall: [number, number] }
  /** Maximum size of the optimised SVG, in bytes. */
  byteBudget: number
  artReady: boolean
  /** A scene (S-x) or a per-project system diagram (D-x). */
  kind: 'scene' | 'diagram'
  /**
   * A separate tall (phone) drawing exists. Phones show it only once
   * `tallArtReady` is true (owner approval on /brand); until then they show
   * the wide drawing at full width.
   */
  tall: boolean
  tallArtReady: boolean
}

export const SCENES = [
  {
    id: 'fragmented-intake',
    code: 'S1',
    title: 'Fragmented intake',
    caption: 'Inquiries arrive through four channels into four tools. Nobody owns them.',
    alt: 'Inquiries arriving through four channels into four disconnected tools with no owner',
    aspect: { wide: [3, 2], tall: [4, 5] },
    byteBudget: 24 * 1024,
    artReady: true,
    kind: 'scene',
    tall: true,
    tallArtReady: false,
  },
  {
    id: 'connected-system',
    code: 'S2',
    title: 'The connected system',
    caption: 'The same inquiries recorded once, each with a status and an owner.',
    alt: 'The same inquiries recorded once, with a status and an owner',
    aspect: { wide: [3, 2], tall: [4, 5] },
    byteBudget: 28 * 1024,
    artReady: true,
    kind: 'scene',
    tall: true,
    tallArtReady: false,
  },
  {
    id: 'persist-before-deliver',
    code: 'S3',
    title: 'Persist before deliver',
    caption: 'The submission is saved first. A failed delivery is marked and can be retried.',
    alt: 'The submission is saved first; the failed delivery is marked and can be retried',
    aspect: { wide: [16, 9], tall: [4, 5] },
    byteBudget: 24 * 1024,
    artReady: true,
    kind: 'scene',
    tall: true,
    tallArtReady: false,
  },
  {
    id: 'handoff-to-person',
    code: 'S4',
    title: 'Handoff to a person',
    caption: 'An ambiguous case leaves the automated path for a named person to approve.',
    alt: 'An ambiguous case routed to a named person for approval',
    aspect: { wide: [1, 1], tall: [1, 1] },
    byteBudget: 16 * 1024,
    artReady: true,
    kind: 'scene',
    tall: false,
    tallArtReady: false,
  },
  {
    id: 'build-in-layers',
    code: 'S5',
    title: 'Build in layers',
    caption: 'A system drawn as its layers: interface, services, data, automation and the people who run it.',
    alt: 'A system drawn as its layers: interface, services, data, automation and the people who operate it',
    aspect: { wide: [16, 9], tall: [4, 5] },
    byteBudget: 20 * 1024,
    artReady: true,
    kind: 'scene',
    tall: false,
    tallArtReady: false,
  },
  {
    id: 'workflow-audit',
    code: 'S6',
    title: 'Workflow audit',
    caption: 'A workflow reviewed and marked up, with recommendations in priority order.',
    alt: 'A workflow reviewed and marked up, with a prioritised recommendation',
    aspect: { wide: [3, 2], tall: [4, 5] },
    byteBudget: 24 * 1024,
    artReady: true,
    kind: 'scene',
    tall: true,
    tallArtReady: false,
  },
  // New in spec H.1 (BRAND-05): pending owner approval on /brand.
  {
    id: 'human-controlled-automation',
    code: 'S7',
    title: 'Human-controlled automation',
    caption: 'Automation handles the routine steps. The one exception goes to a named person and comes back approved.',
    alt: 'A row of automated steps, each checked; one exception leaves the row for a named person and returns stamped',
    aspect: { wide: [3, 2], tall: [4, 5] },
    byteBudget: 12 * 1024,
    artReady: false,
    kind: 'scene',
    tall: true,
    tallArtReady: false,
  },
  {
    id: 'the-receipt',
    code: 'S8',
    title: 'The receipt',
    caption: 'Your inquiry is saved and stamped first; the receipt goes to you, and a person reads it.',
    alt: 'A form saved as a stamped record, then a receipt envelope sent to a person',
    aspect: { wide: [3, 2], tall: [4, 5] },
    byteBudget: 12 * 1024,
    artReady: false,
    kind: 'scene',
    tall: true,
    tallArtReady: false,
  },
  {
    id: 'diagram-memory-preview',
    code: 'D-1',
    title: 'Memory Preview, as built',
    caption: 'ChatGPT proposes through an MCP bridge; checks run; a person approves; approved knowledge is versioned in GitHub.',
    alt: 'Chat to an MCP bridge, then checks, then a person approves, then the knowledge is saved in GitHub',
    aspect: { wide: [16, 9], tall: [4, 5] },
    byteBudget: 16 * 1024,
    artReady: false,
    kind: 'diagram',
    tall: true,
    tallArtReady: false,
  },
  {
    id: 'diagram-lead-qualification',
    code: 'D-2',
    title: 'Lead qualification, as built',
    caption: 'Leads are cleaned on a schedule, called by an AI voice agent, recorded from the call webhook, then handed to acquisitions.',
    alt: 'Scheduled intake, an AI voice call, the call webhook, the lead record, then a person in acquisitions',
    aspect: { wide: [16, 9], tall: [4, 5] },
    byteBudget: 16 * 1024,
    artReady: false,
    kind: 'diagram',
    tall: true,
    tallArtReady: false,
  },
  {
    id: 'diagram-buyer-intelligence',
    code: 'D-3',
    title: 'Buyer intelligence, as built',
    caption: 'A deal comes in, the address is geocoded and cached, buyers are ranked, and the shortlist lands in a sheet a person reviews.',
    alt: 'Deal intake, geocoding, an address cache, AI ranking, a buyer sheet, then a person reviewing it',
    aspect: { wide: [16, 9], tall: [4, 5] },
    byteBudget: 16 * 1024,
    artReady: false,
    kind: 'diagram',
    tall: true,
    tallArtReady: false,
  },
  {
    id: 'diagram-messenger-agent',
    code: 'D-4',
    title: 'Messenger agent, as built',
    caption: 'A message is filtered, context is fetched, an AI reply is drafted, downstream actions run, and the reply goes back.',
    alt: 'A message, a filter, fetched context, an AI reply, downstream actions, then the reply sent back',
    aspect: { wide: [16, 9], tall: [4, 5] },
    byteBudget: 16 * 1024,
    artReady: false,
    kind: 'diagram',
    tall: true,
    tallArtReady: false,
  },
] as const satisfies readonly SceneDefinition[]

export type SceneId = (typeof SCENES)[number]['id']
export const SCENE_IDS = SCENES.map((scene) => scene.id) as [SceneId, ...SceneId[]]

export function getScene(id: string): SceneDefinition | null {
  return (SCENES as readonly SceneDefinition[]).find((scene) => scene.id === id) ?? null
}

/** Hero visuals: none, the legacy node canvas, or a scene. '' keeps the hero's existing behaviour. */
export const HERO_VISUAL_IDS = ['', 'none', 'system-canvas', ...SCENE_IDS.map((id) => `scene:${id}`)] as const

/**
 * Per-project system diagrams (the plan's D-x). Each is drawn for one real
 * write-up; until one exists a project may reference a scene instead (the
 * plan allows S5 as the generic system drawing).
 */
export const SYSTEM_DIAGRAM_IDS: readonly string[] = [...SCENE_IDS]
