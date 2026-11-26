import { angleDelta, axis, distance, dot, normalize, radians, subtract } from '../../../shared/math'
import type { Point } from '../../../shared/race'

export type MarkId = string
export type HypothesisId = string
export type AnswerClassification =
  | 'correct'
  | 'incorrect'
  | 'indistinguishable'
  | 'ambiguity-recognized'
  | 'overconfident-unknown'

export interface CameraPose {
  position: Point
  /** Degrees in the chart's mathematical convention: 0 points along +x. */
  heading: number
  /** Degrees of heel/roll. Positive rotates the image clockwise. */
  heel: number
}

export interface ShoreReference {
  landmarkId: string
  /** Bearing from the camera to the landmark, relative to the bow. */
  landmarkBearing: number
  /** Which side of the landmark the fragment appears on. */
  markSide: 'left' | 'right' | 'aligned'
  uncertaintyDeg?: number
}

export interface MarkFragment {
  id: string
  time: number
  label: string
  pose: CameraPose
  /** Observed bearing of this partial outline, relative to the bow. */
  bearing: number
  /** Fraction of the complete outline visible in this frame, 0..1. */
  outline: number
  contour: string[]
  shore?: ShoreReference
  occluded?: boolean
  usable?: boolean
  note?: string
  /** Authoring truth. The scoring code may use it only to describe a guess. */
  actualMarkId?: MarkId
}

export interface RecognitionMark {
  id: MarkId
  name: string
  position: Point
  color: string
  /** Feature token -> first time at which that physical feature can appear. */
  features: Record<string, number>
}

export interface ShoreLandmark {
  id: string
  name: string
  position: Point
}

export interface OcclusionInterval {
  from: number
  to: number
  reason: string
}

export interface RecognitionScenario {
  id: string
  title: string
  duration: number
  suggestedAnswerTime: number
  turningMarkId: MarkId
  marks: RecognitionMark[]
  landmarks: ShoreLandmark[]
  fragments: MarkFragment[]
  occlusion: OcclusionInterval[]
  poseAt: (time: number) => CameraPose
}

export interface IdentityHypothesis {
  id: HypothesisId
  turningMarkId: MarkId
  assignment: Record<string, MarkId>
}

export interface CheckResult {
  ok: boolean
  reason?: string
  errorDeg?: number
}

export interface FragmentCheck {
  fragmentId: string
  markId: MarkId
  fits: boolean
  bearing: CheckResult
  shore: CheckResult
  contour: CheckResult
}

export interface HypothesisEvaluation {
  hypothesis: IdentityHypothesis
  survives: boolean
  checks: FragmentCheck[]
  failures: string[]
}

export interface RevealInfo {
  time: number
  fragmentId: string
  excludedHypothesisIds: HypothesisId[]
  survivingHypothesisIds: HypothesisId[]
  feature?: string
  explanation: string
}

export interface CitationLink {
  a: string
  b: string
  ok: boolean
  reasons: string[]
}

export interface CitationChain {
  admissible: boolean
  groups: string[][]
  links: CitationLink[]
  reasons: string[]
}

export interface RecognitionAnswer {
  answeredAt: number
  evidenceCutoff: number
  selectedMarkId?: MarkId
  selectedHypothesisId?: HypothesisId
  declaredUnknown: boolean
  citedFragmentIds: string[]
  classification: AnswerClassification
  /** True when the selected mark is the authored turning mark. */
  guessMatchesTruth: boolean
  ambiguousAtTime: boolean
  survivingHypothesisIds: HypothesisId[]
  excludedAfterAnswer: HypothesisId[]
  firstReveal: RevealInfo | null
  citationChain: CitationChain | null
  earnedScore: number
  maxScore: number
  summary: string
}

export interface ProjectedPoint {
  x: number
  y: number
  depth: number
  relativeBearing: number
  scale: number
  visible: boolean
}

export interface ProjectionOptions {
  width?: number
  horizon?: number
  focalLength?: number
  perspective?: number
  maxRelativeBearing?: number
}

export interface FitOptions {
  bearingToleranceDeg?: number
  shoreToleranceDeg?: number
}

export interface LinkOptions extends FitOptions {
  maxRange?: number
  intersectionEpsilon?: number
}

const EPS = 1e-6

export function worldBearing(from: Point, to: Point): number {
  return normalize((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI)
}

export function relativeBearing(pose: CameraPose, point: Point): number {
  return angleDelta(pose.heading, worldBearing(pose.position, point))
}

export function projectPoint(point: Point, pose: CameraPose, options: ProjectionOptions = {}): ProjectedPoint {
  const width = options.width ?? 960
  const horizon = options.horizon ?? 218
  const focal = options.focalLength ?? 390
  const perspective = options.perspective ?? 5200
  const maxBearing = options.maxRelativeBearing ?? 78
  const delta = subtract(point, pose.position)
  const forward = axis(pose.heading)
  const depth = dot(delta, forward)
  const rel = relativeBearing(pose, point)
  const x = width / 2 + focal * Math.tan(radians(rel))
  const safeDepth = Math.max(depth, 1)
  const y = horizon + perspective / safeDepth
  const scale = Math.max(0.45, 1750 / safeDepth)
  const visible = depth > 1 && Math.abs(rel) <= maxBearing && Number.isFinite(x) && Number.isFinite(y)
  return { x, y, depth, relativeBearing: rel, scale, visible }
}

export function applyHeel(x: number, y: number, heelDeg: number, pivot: Point): Point {
  const a = radians(heelDeg)
  const dx = x - pivot.x
  const dy = y - pivot.y
  return {
    x: pivot.x + dx * Math.cos(a) - dy * Math.sin(a),
    y: pivot.y + dx * Math.sin(a) + dy * Math.cos(a),
  }
}

export function orderMarks(marks: RecognitionMark[], pose: CameraPose): MarkId[] {
  return marks
    .map(mark => ({ id: mark.id, x: projectPoint(mark.position, pose).x }))
    .sort((a, b) => a.x - b.x)
    .map(item => item.id)
}

export function projectionOrderSwapped(
  before: CameraPose,
  after: CameraPose,
  marks: RecognitionMark[],
): boolean {
  const a = orderMarks(marks, before).join('|')
  const b = orderMarks(marks, after).reverse().join('|')
  return a === b
}

function bearingCheck(observed: number, predicted: number, tolerance: number): CheckResult {
  const errorDeg = Math.abs(angleDelta(observed, predicted))
  return errorDeg <= tolerance + EPS
    ? { ok: true, errorDeg }
    : { ok: false, errorDeg, reason: `方位差 ${errorDeg.toFixed(1)}° 超过 ${tolerance}°` }
}

export function checkShoreReference(
  fragment: MarkFragment,
  mark: RecognitionMark,
  landmarks: ShoreLandmark[],
  options: FitOptions = {},
): CheckResult {
  if (!fragment.shore) return { ok: true }
  const tolerance = options.shoreToleranceDeg ?? 6
  const landmark = landmarks.find(item => item.id === fragment.shore?.landmarkId)
  if (!landmark) return { ok: false, reason: '岸上参照不存在' }

  const predictedLandmarkBearing = relativeBearing(fragment.pose, landmark.position)
  const landmarkCheck = bearingCheck(fragment.shore.landmarkBearing, predictedLandmarkBearing, tolerance)
  if (!landmarkCheck.ok) return { ...landmarkCheck, reason: `岸标方位不符：${landmarkCheck.reason}` }

  const predictedMarkBearing = relativeBearing(fragment.pose, mark.position)
  const observedSeparation = angleDelta(fragment.shore.landmarkBearing, fragment.bearing)
  const predictedSeparation = angleDelta(predictedLandmarkBearing, predictedMarkBearing)
  const separationError = Math.abs(angleDelta(observedSeparation, predictedSeparation))
  if (separationError > tolerance + 2) {
    return { ok: false, errorDeg: separationError, reason: `标与岸标的夹角不符（${separationError.toFixed(1)}°）` }
  }

  const observedSide: ShoreReference['markSide'] = observedSeparation > 1.5 ? 'right' : observedSeparation < -1.5 ? 'left' : 'aligned'
  if (fragment.shore.markSide !== observedSide) {
    return { ok: false, reason: `岸标相对侧别应为${observedSide}，记录为${fragment.shore.markSide}` }
  }
  return { ok: true, errorDeg: landmarkCheck.errorDeg }
}

export function fragmentFitsMark(
  fragment: MarkFragment,
  mark: RecognitionMark,
  landmarks: ShoreLandmark[],
  options: FitOptions = {},
): FragmentCheck {
  const bearingTolerance = options.bearingToleranceDeg ?? 4.8
  const shoreTolerance = options.shoreToleranceDeg ?? 6.5
  const predictedBearing = relativeBearing(fragment.pose, mark.position)
  const bearing = bearingCheck(fragment.bearing, predictedBearing, bearingTolerance)
  const shore = checkShoreReference(fragment, mark, landmarks, { ...options, shoreToleranceDeg: shoreTolerance })

  const missingFeature = fragment.contour.find(token => {
    const firstVisible = mark.features[token]
    return firstVisible === undefined || fragment.time + EPS < firstVisible
  })
  const contour: CheckResult = missingFeature
    ? { ok: false, reason: `轮廓特征 ${missingFeature} 不属于该解释或尚未露出` }
    : { ok: true }

  const fits = bearing.ok && shore.ok && contour.ok
  return { fragmentId: fragment.id, markId: mark.id, fits, bearing, shore, contour }
}

interface Ray {
  origin: Point
  bearing: number
  direction: Point
}

function fragmentRay(fragment: MarkFragment): Ray {
  const bearing = normalize(fragment.pose.heading + fragment.bearing)
  return { origin: fragment.pose.position, bearing, direction: axis(bearing) }
}

function cross(a: Point, b: Point): number {
  return a.x * b.y - a.y * b.x
}

/**
 * Viewpoint check for joining two fragments. Two sightings may be fragments of
 * one mark when their rays meet ahead of both cameras at a plausible range.
 * Coincident viewpoints are accepted when the observed bearings agree.
 */
export function viewpointAllowsSameMark(a: MarkFragment, b: MarkFragment, options: LinkOptions = {}): CheckResult {
  const maxRange = options.maxRange ?? 620
  const rayA = fragmentRay(a)
  const rayB = fragmentRay(b)
  const denominator = cross(rayA.direction, rayB.direction)
  const difference = subtract(rayB.origin, rayA.origin)

  if (Math.abs(denominator) < 0.002) {
    const originGap = distance(rayA.origin, rayB.origin)
    const bearingError = Math.abs(angleDelta(rayA.bearing, rayB.bearing))
    if (originGap < 8 && bearingError <= (options.bearingToleranceDeg ?? 5) * 0.25) return { ok: true }
    return { ok: false, reason: '视角变化不足或两条视线不一致，无法复核为同一标' }
  }

  const t = cross(difference, rayB.direction) / denominator
  const s = cross(difference, rayA.direction) / denominator
  if (t < -0.5 || s < -0.5) return { ok: false, reason: '视线交点不在两个视角的前方' }
  if (t > maxRange || s > maxRange) return { ok: false, reason: '视线交点距离超出可信范围' }
  return { ok: true }
}

export function shoreAllowsSameMark(
  a: MarkFragment,
  b: MarkFragment,
  landmarks: ShoreLandmark[] = [],
  options: FitOptions = {},
): CheckResult {
  if (!a.shore || !b.shore) return { ok: false, reason: '缺少可见岸上参照' }
  if (a.shore.landmarkId !== b.shore.landmarkId) return { ok: false, reason: '两次碎片没有同一岸上参照' }
  if (a.shore.markSide !== b.shore.markSide) return { ok: false, reason: '碎片相对岸标的侧别不一致' }

  const landmark = landmarks.find(item => item.id === a.shore?.landmarkId)
  if (landmark) {
    const tol = options.shoreToleranceDeg ?? 6.5
    const predictedA = relativeBearing(a.pose, landmark.position)
    const predictedB = relativeBearing(b.pose, landmark.position)
    const landmarkA = bearingCheck(a.shore.landmarkBearing, predictedA, tol)
    const landmarkB = bearingCheck(b.shore.landmarkBearing, predictedB, tol)
    if (!landmarkA.ok) return { ok: false, reason: '前一碎片的岸标方位不可复核' }
    if (!landmarkB.ok) return { ok: false, reason: '后一碎片的岸标方位不可复核' }
  }
  return { ok: true }
}

export function canLinkFragments(
  a: MarkFragment,
  b: MarkFragment,
  landmarks: ShoreLandmark[] = [],
  options: LinkOptions = {},
): CitationLink {
  const viewpoint = viewpointAllowsSameMark(a, b, options)
  const shore = shoreAllowsSameMark(a, b, landmarks, options)
  const reasons = [viewpoint.reason, shore.reason].filter((reason): reason is string => Boolean(reason))
  return { a: a.id, b: b.id, ok: viewpoint.ok && shore.ok, reasons }
}

export function triangulationResidualDeg(fragments: MarkFragment[]): number | null {
  if (fragments.length < 2) return 0
  let a11 = 0, a12 = 0, a22 = 0
  let b1 = 0, b2 = 0
  for (const fragment of fragments) {
    const ray = fragmentRay(fragment)
    const ux = ray.direction.x
    const uy = ray.direction.y
    const m11 = 1 - ux * ux
    const m12 = -ux * uy
    const m22 = 1 - uy * uy
    a11 += m11
    a12 += m12
    a22 += m22
    b1 += m11 * ray.origin.x + m12 * ray.origin.y
    b2 += m12 * ray.origin.x + m22 * ray.origin.y
  }
  const determinant = a11 * a22 - a12 * a12
  if (Math.abs(determinant) < EPS) return null
  const point: Point = {
    x: (b1 * a22 - a12 * b2) / determinant,
    y: (a11 * b2 - a12 * b1) / determinant,
  }
  return Math.max(...fragments.map(fragment =>
    Math.abs(angleDelta(fragmentRay(fragment).bearing, worldBearing(fragment.pose.position, point)))))
}

/** Group cited fragments by defensible same-mark links. */
export function combineFragments(
  fragments: MarkFragment[],
  landmarks: ShoreLandmark[] = [],
  options: LinkOptions = {},
): CitationChain {
  const links: CitationLink[] = []
  const parent = new Map<string, string>()
  const find = (id: string): string => {
    const root = parent.get(id) ?? id
    if (root !== id) parent.set(id, find(root))
    return parent.get(id) ?? id
  }
  const union = (a: string, b: string) => parent.set(find(a), find(b))
  fragments.forEach(fragment => parent.set(fragment.id, fragment.id))

  const chronological = [...fragments].sort((a, b) => a.time - b.time)
  for (let i = 0; i < chronological.length; i++) {
    for (let j = i + 1; j < chronological.length; j++) {
      const link = canLinkFragments(chronological[i], chronological[j], landmarks, options)
      links.push(link)
      if (link.ok) union(link.a, link.b)
    }
  }

  const groupMap = new Map<string, string[]>()
  for (const fragment of fragments) {
    const root = find(fragment.id)
    groupMap.set(root, [...(groupMap.get(root) ?? []), fragment.id])
  }
  const groups = [...groupMap.values()].map(ids => ids.sort((a, b) => {
    const ta = fragments.find(f => f.id === a)?.time ?? 0
    const tb = fragments.find(f => f.id === b)?.time ?? 0
    return ta - tb
  }))

  const reasons: string[] = []
  let admissible = true
  if (fragments.length > 1 && groups.length !== 1) {
    admissible = false
    reasons.push('所选碎片不能全部归到同一件标')
  }
  for (const group of groups) {
    if (group.length < 3) continue
    const groupFragments = group
      .map(id => fragments.find(fragment => fragment.id === id))
      .filter((fragment): fragment is MarkFragment => Boolean(fragment))
    const residual = triangulationResidualDeg(groupFragments)
    if (residual === null || residual > 1.35) {
      admissible = false
      reasons.push('多个视角的交点不能收敛：这些碎片不应合并为同一件标')
      break
    }
  }
  const hasBrokenPair = links.some(link => !link.ok)
  if (hasBrokenPair) admissible = false
  for (const link of links.filter(link => !link.ok)) reasons.push(`${link.a}↔${link.b}：${link.reasons.join('；')}`)
  return { admissible, groups, links, reasons }
}

export function createHypotheses(scenario: RecognitionScenario): IdentityHypothesis[] {
  const other = scenario.marks.find(mark => mark.id !== scenario.turningMarkId)
  if (!other) return []
  const truthAssignment: Record<string, MarkId> = {}
  for (const fragment of scenario.fragments) {
    if (fragment.actualMarkId) truthAssignment[fragment.id] = fragment.actualMarkId
  }
  const swappedAssignment: Record<string, MarkId> = {}
  for (const [fragmentId, markId] of Object.entries(truthAssignment)) {
    swappedAssignment[fragmentId] = markId === scenario.turningMarkId ? other.id : scenario.turningMarkId
  }
  return [
    { id: `H_${scenario.turningMarkId}`, turningMarkId: scenario.turningMarkId, assignment: truthAssignment },
    { id: `H_${other.id}`, turningMarkId: other.id, assignment: swappedAssignment },
  ]
}

export function fragmentsVisibleAt(
  scenario: RecognitionScenario,
  time: number,
  strictBefore = false,
): MarkFragment[] {
  return scenario.fragments
    .filter(fragment => (strictBefore ? fragment.time < time - EPS : fragment.time <= time + EPS))
    .sort((a, b) => a.time - b.time)
}

export function evaluateHypothesis(
  hypothesis: IdentityHypothesis,
  scenario: RecognitionScenario,
  time: number,
  options: FitOptions & { strictBefore?: boolean; citedFragmentIds?: string[] } = {},
): HypothesisEvaluation {
  const visible = fragmentsVisibleAt(scenario, time, options.strictBefore ?? false)
  const cited = options.citedFragmentIds?.length
    ? visible.filter(fragment => options.citedFragmentIds?.includes(fragment.id))
    : visible
  const checks: FragmentCheck[] = []
  const failures: string[] = []

  for (const fragment of cited) {
    if (fragment.usable === false) continue
    const markId = hypothesis.assignment[fragment.id]
    if (!markId) continue
    const mark = scenario.marks.find(item => item.id === markId)
    if (!mark) {
      failures.push(`${fragment.id} 指向不存在的标 ${markId}`)
      continue
    }
    const check = fragmentFitsMark(fragment, mark, scenario.landmarks, options)
    checks.push(check)
    if (!check.fits) {
      const reason = check.bearing.reason ?? check.shore.reason ?? check.contour.reason ?? '证据不合'
      failures.push(`${fragment.id} 不能解释为 ${mark.name}：${reason}`)
    }
  }

  return { hypothesis, survives: failures.length === 0, checks, failures }
}

export function survivingHypotheses(
  scenario: RecognitionScenario,
  time: number,
  options: FitOptions & { strictBefore?: boolean; citedFragmentIds?: string[]; hypotheses?: IdentityHypothesis[] } = {},
): HypothesisEvaluation[] {
  const hypotheses = options.hypotheses ?? createHypotheses(scenario)
  return hypotheses
    .map(hypothesis => evaluateHypothesis(hypothesis, scenario, time, options))
    .filter(evaluation => evaluation.survives)
}

export function findFirstReveal(
  scenario: RecognitionScenario,
  options: FitOptions & { afterTime?: number } = {},
): RevealInfo | null {
  const hypotheses = createHypotheses(scenario)
  const times = [...new Set(scenario.fragments.map(fragment => fragment.time))].sort((a, b) => a - b)
  for (const time of times) {
    if (options.afterTime !== undefined && time < options.afterTime - EPS) continue
    const before = survivingHypotheses(scenario, time, { ...options, strictBefore: true, hypotheses })
    const after = survivingHypotheses(scenario, time, { ...options, strictBefore: false, hypotheses })
    if (before.length > 1 && after.length === 1) {
      const fragment = scenario.fragments.find(item => Math.abs(item.time - time) < EPS)
      const beforeIds = before.map(item => item.hypothesis.id)
      const afterIds = after.map(item => item.hypothesis.id)
      const excluded = beforeIds.filter(id => !afterIds.includes(id))
      return {
        time,
        fragmentId: fragment?.id ?? '',
        excludedHypothesisIds: excluded,
        survivingHypothesisIds: afterIds,
        feature: fragment?.contour.at(-1),
        explanation: fragment?.note ?? '这一首次露出的轮廓排除了另一种身份解释。',
      }
    }
  }
  return null
}

export interface SubmitAnswerInput {
  time: number
  selectedMarkId?: MarkId
  declaredUnknown?: boolean
  citedFragmentIds?: string[]
}

export function submitRecognitionAnswer(
  scenario: RecognitionScenario,
  input: SubmitAnswerInput,
  options: FitOptions = {},
): RecognitionAnswer {
  const citedFragmentIds = [...new Set(input.citedFragmentIds ?? [])].sort()
  const citationChain = citedFragmentIds.length > 1
    ? combineFragments(
        scenario.fragments.filter(fragment => citedFragmentIds.includes(fragment.id)),
        scenario.landmarks,
        options,
      )
    : null

  // Scoring is epistemic: only evidence strictly before the answer counts.
  const survivors = survivingHypotheses(scenario, input.time, { ...options, strictBefore: true })
  const ambiguous = survivors.length > 1
  const truthHypothesisId = `H_${scenario.turningMarkId}`
  const selectedHypothesisId = input.selectedMarkId ? `H_${input.selectedMarkId}` : undefined
  const guessMatchesTruth = input.selectedMarkId === scenario.turningMarkId
  const firstReveal = findFirstReveal(scenario, options)
  const excludedAfterAnswer = firstReveal
    ? firstReveal.excludedHypothesisIds
    : survivors.length === 1
      ? createHypotheses(scenario).map(h => h.id).filter(id => !survivors.some(s => s.hypothesis.id === id))
      : []

  let classification: AnswerClassification
  let earnedScore = 0
  let summary: string

  if (input.declaredUnknown) {
    if (ambiguous) {
      classification = 'ambiguity-recognized'
      earnedScore = 60
      summary = '判断正确：作答前两种身份解释都能通过可见参照，当时确实不可辨。'
    } else {
      classification = 'overconfident-unknown'
      summary = '已有足够证据排除另一种解释，仍选择不可辨。'
    }
  } else if (ambiguous) {
    classification = 'indistinguishable'
    summary = guessMatchesTruth
      ? '当时不可辨：即使这一猜恰好等于真标，作答前证据仍同时支持两种身份解释。'
      : '当时不可辨：作答前证据同时支持两种身份解释，不能据此判定为识别正确。'
  } else if (survivors.length === 1) {
    const only = survivors[0].hypothesis
    if (input.selectedMarkId && selectedHypothesisId === only.id && only.turningMarkId === scenario.turningMarkId) {
      classification = 'correct'
      earnedScore = 100
      summary = '正确：作答前的视角与岸上参照已收敛到唯一身份解释。'
    } else {
      classification = 'incorrect'
      summary = '错误：作答前证据已支持另一身份解释。'
    }
  } else {
    classification = 'incorrect'
    summary = '可见证据互相冲突，未能形成有效身份解释。'
  }

  return {
    answeredAt: input.time,
    evidenceCutoff: input.time,
    selectedMarkId: input.selectedMarkId,
    selectedHypothesisId,
    declaredUnknown: Boolean(input.declaredUnknown),
    citedFragmentIds,
    classification,
    guessMatchesTruth,
    ambiguousAtTime: ambiguous,
    survivingHypothesisIds: survivors.map(item => item.hypothesis.id),
    excludedAfterAnswer,
    firstReveal,
    citationChain,
    earnedScore,
    maxScore: 100,
    summary,
  }
}

export function isAmbiguousAtTime(
  scenario: RecognitionScenario,
  time: number,
  options: FitOptions & { strictBefore?: boolean } = {},
): boolean {
  return survivingHypotheses(scenario, time, options).length > 1
}

export function canCombineFragments(
  fragments: MarkFragment[],
  landmarks: ShoreLandmark[] = [],
  options: LinkOptions = {},
): boolean {
  return combineFragments(fragments, landmarks, options).admissible
}

export const evaluateRecognitionAnswer = submitRecognitionAnswer
export const scoreMarkIdentification = submitRecognitionAnswer
export const resolveIdentityHypotheses = survivingHypotheses
export const findDisambiguatingReveal = findFirstReveal
