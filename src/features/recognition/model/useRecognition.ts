import { computed, onUnmounted, ref } from 'vue'
import { clamp } from '../../../shared/math'
import {
  combineFragments,
  findFirstReveal,
  orderMarks,
  projectPoint,
  submitRecognitionAnswer,
  survivingHypotheses,
} from '../lib/identity'
import type { RecognitionAnswer } from '../lib/identity'
import { recognitionScenario } from './scenario'

export function useRecognition() {
  const scenario = recognitionScenario
  const currentTime = ref(scenario.suggestedAnswerTime)
  const playing = ref(false)
  const citedIds = ref<string[]>([])
  const submission = ref<RecognitionAnswer | null>(null)
  const attempts = ref<RecognitionAnswer[]>([])
  const revealFocusId = ref<string | null>(null)

  let frame = 0
  let last = 0

  const pose = computed(() => scenario.poseAt(currentTime.value))
  const projections = computed(() => scenario.marks.map(mark => ({
    mark,
    projection: projectPoint(mark.position, pose.value),
  })))
  const order = computed(() => orderMarks(scenario.marks, pose.value))
  const sideByMark = computed(() => {
    const result: Record<string, 'left' | 'right'> = {}
    order.value.forEach((id, index) => { result[id] = index === 0 ? 'left' : 'right' })
    return result
  })
  const markForSide = (side: 'left' | 'right'): string | undefined => order.value[side === 'left' ? 0 : order.value.length - 1]
  const correctSide = computed(() => sideByMark.value[scenario.turningMarkId])

  const seenFragments = computed(() => scenario.fragments
    .filter(fragment => fragment.time <= currentTime.value + 1e-6)
    .sort((a, b) => a.time - b.time))
  const citableFragments = computed(() => seenFragments.value.filter(fragment => fragment.id !== 'f-old-pier' || currentTime.value >= fragment.time))
  const citationChain = computed(() => citedIds.value.length > 1
    ? combineFragments(
        scenario.fragments.filter(fragment => citedIds.value.includes(fragment.id)),
        scenario.landmarks,
      )
    : null)

  const currentSurvivors = computed(() => survivingHypotheses(scenario, currentTime.value, { strictBefore: false }))
  const firstReveal = computed(() => findFirstReveal(scenario))
  const shadowOpacity = computed(() => {
    const interval = scenario.occlusion[0]
    if (!interval) return 0
    const t = currentTime.value
    const fadeIn = clamp((t - interval.from) / 0.35, 0, 1)
    const fadeOut = 1 - clamp((t - interval.to + 0.45) / 0.45, 0, 1)
    return Math.min(fadeIn, fadeOut) * 0.92
  })
  const orderSwapped = computed(() => {
    const before = scenario.poseAt(1.05)
    const initialOrder = orderMarks(scenario.marks, before).join('|')
    return order.value.join('|') !== initialOrder
  })

  function tick(now: number) {
    if (playing.value) {
      if (!last) last = now
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      currentTime.value = clamp(currentTime.value + dt * 1.05, 0, scenario.duration)
      if (currentTime.value >= scenario.duration) playing.value = false
    } else {
      last = 0
    }
    frame = requestAnimationFrame(tick)
  }
  if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(tick)
  onUnmounted(() => {
    if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
  })

  function togglePlay() {
    if (currentTime.value >= scenario.duration) currentTime.value = 0
    playing.value = !playing.value
    last = 0
  }
  function seek(time: number) {
    currentTime.value = clamp(time, 0, scenario.duration)
    revealFocusId.value = null
  }
  function replayFromStart() {
    currentTime.value = 0
    playing.value = true
    revealFocusId.value = null
  }
  function toggleCitation(id: string) {
    citedIds.value = citedIds.value.includes(id)
      ? citedIds.value.filter(item => item !== id)
      : [...citedIds.value, id]
  }
  function answerMark(markId: string) {
    playing.value = false
    // The currently rendered frame has already been seen before the click.
    const answerTime = currentTime.value + 1e-4
    const result = submitRecognitionAnswer(scenario, {
      time: answerTime,
      selectedMarkId: markId,
      citedFragmentIds: citedIds.value,
    })
    submission.value = result
    attempts.value = [result, ...attempts.value].slice(0, 8)
    revealFocusId.value = null
  }
  function chooseSide(side: 'left' | 'right') {
    const markId = markForSide(side)
    if (markId) answerMark(markId)
  }
  function answerUnknown() {
    playing.value = false
    const answerTime = currentTime.value + 1e-4
    const result = submitRecognitionAnswer(scenario, {
      time: answerTime,
      declaredUnknown: true,
      citedFragmentIds: citedIds.value,
    })
    submission.value = result
    attempts.value = [result, ...attempts.value].slice(0, 8)
  }
  function jumpToFirstReveal() {
    const reveal = submission.value?.firstReveal ?? firstReveal.value
    if (!reveal) return
    seek(reveal.time)
    revealFocusId.value = reveal.fragmentId
  }
  function reset() {
    playing.value = false
    currentTime.value = scenario.suggestedAnswerTime
    citedIds.value = []
    submission.value = null
    attempts.value = []
    revealFocusId.value = null
  }

  return {
    scenario,
    currentTime,
    playing,
    citedIds,
    submission,
    attempts,
    revealFocusId,
    pose,
    projections,
    order,
    sideByMark,
    markForSide,
    correctSide,
    seenFragments,
    citableFragments,
    citationChain,
    currentSurvivors,
    firstReveal,
    shadowOpacity,
    orderSwapped,
    togglePlay,
    seek,
    replayFromStart,
    toggleCitation,
    chooseSide,
    answerMark,
    answerUnknown,
    jumpToFirstReveal,
    reset,
  }
}
