<script setup lang="ts">
import { computed } from 'vue'
import { Crosshair, Eye, EyeOff, Pause, Play, RotateCcw, Scale } from 'lucide-vue-next'
import { clock } from '../../../shared/format'
import { projectPoint } from '../lib/identity'
import { useRecognition } from '../model/useRecognition'

const {
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
  markForSide,
  correctSide,
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
  answerUnknown,
  jumpToFirstReveal,
  reset,
} = useRecognition()

const landmarkViews = computed(() => scenario.landmarks.map(landmark => ({
  landmark,
  projection: projectPoint(landmark.position, pose.value, { maxRelativeBearing: 86 }),
})).filter(item => item.projection.visible))

function sideOf(markId: string): 'left' | 'right' {
  return order.value[0] === markId ? 'left' : 'right'
}

function answerLabel(classification: string): string {
  return {
    correct: '识别正确',
    incorrect: '识别错误',
    indistinguishable: '当时不可辨',
    'ambiguity-recognized': '已正确标记为不可辨',
    'overconfident-unknown': '已有唯一解释',
  }[classification] ?? classification
}

function hypothesisLabel(id: string): string {
  const index = scenario.marks.findIndex(mark => `H_${mark.id}` === id)
  return index === 0 ? '解释一' : index === 1 ? '解释二' : id
}

function hypothesisLabels(ids: string[]): string {
  return ids.map(hypothesisLabel).join(' / ') || '无'
}
</script>

<template>
  <section class="recognition" data-testid="recognition-trainer" aria-label="双标身份识别训练">
    <div class="recognition-head">
      <div>
        <span class="recognition-eyebrow" data-testid="recognition-mode">双标识别训练</span>
        <h2><Eye :size="18" /> {{ scenario.title }}</h2>
        <p>同色双标会在帆影遮挡中交换投影次序；把能由视角和同一岸上参照复核的碎片合用，再判断真正的转向标。</p>
      </div>
      <div class="recognition-actions">
        <button type="button" class="start-button" data-testid="start-recognition" @click="replayFromStart"><Play :size="15" />开始练习</button>
        <button type="button" data-testid="recognition-play" @click="togglePlay">
          <component :is="playing ? Pause : Play" :size="15" />{{ playing ? '暂停' : '播放' }}
        </button>
        <button type="button" data-testid="recognition-replay" @click="replayFromStart"><RotateCcw :size="15" />回看全过程</button>
        <button type="button" class="icon-button" title="重置训练" aria-label="重置训练" data-testid="recognition-reset" @click="reset"><Crosshair :size="17" /></button>
      </div>
    </div>

    <div class="recognition-grid">
      <div class="boat-view" data-testid="boat-view">
        <svg viewBox="0 0 960 390" role="img" aria-label="随船首和横倾变化的船上视野">
          <defs>
            <pattern id="wave-grid" width="54" height="26" patternUnits="userSpaceOnUse">
              <path d="M0 13 Q13 5 27 13 T54 13" fill="none" stroke="#9fc7c3" stroke-opacity=".22" stroke-width="1.4" />
            </pattern>
            <radialGradient id="shadow-grad" cx="50%" cy="38%" r="62%">
              <stop offset="0" stop-color="#071b1f" stop-opacity=".96" />
              <stop offset=".62" stop-color="#0b2529" stop-opacity=".82" />
              <stop offset="1" stop-color="#0b2529" stop-opacity="0" />
            </radialGradient>
          </defs>

          <rect width="960" height="390" fill="#8fb8bd" />
          <g :transform="`rotate(${pose.heel.toFixed(2)} 480 218)`" data-testid="rolled-world">
            <rect x="-320" y="-320" width="1600" height="538" fill="#a9c9c8" />
            <rect x="-320" y="218" width="1600" height="560" fill="#2c6267" />
            <rect x="-320" y="218" width="1600" height="560" fill="url(#wave-grid)" />
            <line x1="-320" y1="218" x2="1280" y2="218" stroke="#d8d0aa" stroke-opacity=".65" stroke-width="2" />

            <g v-for="item in landmarkViews" :key="item.landmark.id" :transform="`translate(${item.projection.x} ${item.projection.y})`" data-testid="shore-reference">
              <path d="M-58 18 L-30 -28 L-8 4 L18 -42 L58 18 Z" fill="#8f8868" stroke="#e4dcc0" stroke-width="1.5" />
              <rect x="-4" y="-58" width="8" height="32" fill="#f1e9cd" stroke="#31585a" stroke-width="1" />
              <circle cy="-61" r="5" fill="#ffd455" stroke="#31585a" stroke-width="1.2" />
              <text y="42" text-anchor="middle" fill="#f5efd9" font-size="15" font-weight="700" style="paint-order: stroke; stroke: #24484c; stroke-width: 3px;">{{ item.landmark.name }}</text>
            </g>

            <g
              v-for="item in projections"
              :key="item.mark.id"
              :transform="`translate(${item.projection.x} ${item.projection.y}) scale(${item.projection.scale / 18})`"
              :data-mark-id="item.mark.id"
              :data-testid="`sight-${item.mark.id}`"
              :data-side="sideOf(item.mark.id)"
              :data-correct-choice="scenario.turningMarkId === item.mark.id"
              role="button"
              tabindex="0"
              :aria-label="`选择当前${sideOf(item.mark.id) === 'left' ? '左' : '右'}投影为转向标`"
              @click="chooseSide(sideOf(item.mark.id))"
              @keydown.enter.prevent="chooseSide(sideOf(item.mark.id))"
            >
              <circle r="25" fill="transparent" />
              <path d="M0 -34 L7 -16 L-7 -16 Z" :fill="currentTime >= 6.3 ? (item.mark.id === 'mark-a' ? '#263b3e' : '#f1e9cd') : '#263b3e'" />
              <path v-if="item.mark.id === 'mark-a' && currentTime >= 6.3" d="M-5 -34 L0 -42 L5 -34" fill="none" stroke="#ffd455" stroke-width="3" data-testid="crown-notch" />
              <circle cy="-4" r="15" :fill="item.mark.color" stroke="#18383b" stroke-width="2.4" />
              <path d="M-13 -7 A15 15 0 0 1 8 -18" fill="none" stroke="#ffe7cf" stroke-width="3.2" stroke-linecap="round" opacity=".86" />
              <path d="M-12 5 A13 13 0 0 0 10 8" fill="none" stroke="#7d3027" stroke-width="2.2" stroke-linecap="round" opacity=".5" />
              <line x1="0" y1="11" x2="0" y2="25" stroke="#18383b" stroke-width="3" />
              <circle r="20" fill="none" stroke="#ffd455" stroke-width="2.5" stroke-dasharray="31 94" transform="rotate(-72)" opacity=".95" />
            </g>
          </g>

          <path d="M0 0 H382 C421 72 414 151 454 226 H300 C322 142 294 61 258 0 Z" fill="#17363a" opacity=".28" />
          <path d="M960 0 H578 C548 78 557 151 514 226 H666 C650 139 681 61 716 0 Z" fill="#17363a" opacity=".22" />
          <ellipse cx="480" cy="150" rx="245" ry="188" fill="url(#shadow-grad)" :opacity="shadowOpacity" data-testid="sail-shadow" />
          <path d="M352 390 L455 252 H505 L612 390 Z" fill="#f1e7c8" stroke="#8d8468" stroke-width="2" />
          <path d="M480 252 V390" stroke="#9b9274" stroke-width="2" stroke-dasharray="8 8" />
          <path d="M468 270 L480 252 L492 270" fill="none" stroke="#31585a" stroke-width="3" />
        </svg>

        <div class="boat-hud">
          <span data-testid="recognition-time"><Crosshair :size="13" />{{ clock(currentTime) }}</span>
          <span>船首 {{ pose.heading.toFixed(1) }}°</span>
          <span>横倾 {{ pose.heel.toFixed(1) }}°</span>
          <span :data-state="orderSwapped ? 'swapped' : 'before'" data-testid="projection-order">{{ orderSwapped ? '投影次序已交换' : '初始投影次序' }}</span>
          <span v-if="shadowOpacity > .2" class="shadow-warning" data-testid="shadow-active"><EyeOff :size="13" />船影遮挡中</span>
        </div>

        <div class="answer-row">
          <button type="button" data-testid="answer-left" data-choice="left" :data-mark-id="markForSide('left')" :data-correct-choice="correctSide === 'left'" @click="chooseSide('left')">当前左投影是转向标</button>
          <button type="button" data-testid="answer-right" data-choice="right" :data-mark-id="markForSide('right')" :data-correct-choice="correctSide === 'right'" @click="chooseSide('right')">当前右投影是转向标</button>
          <button type="button" class="unknown-button" data-testid="answer-unknown" @click="answerUnknown"><Scale :size="15" />证据不足 / 不可辨</button>
        </div>
        <input class="recognition-timeline" type="range" min="0" :max="scenario.duration" step=".01" :value="currentTime" aria-label="双标识别回放时间" data-testid="recognition-timeline" @input="seek(Number(($event.target as HTMLInputElement).value))" />
      </div>

      <aside class="evidence-board" aria-label="身份解释与碎片证据">
        <div class="hypothesis-head">
          <h3>可见参照支持的解释</h3>
          <b data-testid="hypothesis-count">{{ currentSurvivors.length }}</b>
        </div>
        <p v-if="currentSurvivors.length === 2" class="two-interpretations" data-testid="two-interpretations">两种身份解释都能通过当前所有可见参照。</p>
        <ul class="hypothesis-list" data-testid="hypotheses">
          <li v-for="item in currentSurvivors" :key="item.hypothesis.id" :data-hypothesis="item.hypothesis.id">
            {{ hypothesisLabel(item.hypothesis.id) }}：当前证据可把该标解释为真转向标
          </li>
          <li v-if="!currentSurvivors.length" class="conflict">没有解释能通过全部参照</li>
        </ul>
        <p class="scoring-note">评分只读取作答时刻以前的视角、岸标和轮廓；之后的首次露出只用于回看讲解。</p>
        <button v-if="firstReveal" type="button" class="reveal-inline" data-testid="seek-first-reveal" @click="jumpToFirstReveal">
          <Crosshair :size="13" />回看首次露出（{{ clock(firstReveal.time) }}），排除一种解释
        </button>
        <span v-if="firstReveal" hidden data-testid="first-reveal-time" :data-time="firstReveal.time">{{ firstReveal.time }}</span>

        <h3>可引用的旧碎片</h3>
        <div class="fragment-list" data-testid="fragment-list">
          <label v-for="fragment in citableFragments" :key="fragment.id" class="fragment" :data-testid="`evidence-fragment-${fragment.id}`" :data-focused="revealFocusId === fragment.id" :data-usable="fragment.usable !== false">
            <input type="checkbox" :data-testid="`cite-${fragment.id}`" :value="fragment.id" :checked="citedIds.includes(fragment.id)" :disabled="fragment.usable === false || fragment.time >= currentTime" @change="toggleCitation(fragment.id)" />
            <span>
              <time>{{ clock(fragment.time) }}</time>
              <b>{{ fragment.label }}</b>
              <small>{{ fragment.note }}</small>
              <em>{{ fragment.usable === false ? '船影遮挡，不可作为证据' : `轮廓 ${Math.round(fragment.outline * 100)}% · ${fragment.shore ? '有同一岸标参照' : '无岸标参照'}` }}</em>
            </span>
          </label>
        </div>

        <div v-if="citationChain" class="citation-chain" :data-admissible="citationChain.admissible" data-testid="citation-chain">
          <b>{{ citationChain.admissible ? '所选碎片可归到同一件标' : '这些碎片不能当作同一件标合用' }}</b>
          <p v-for="reason in citationChain.reasons.slice(0, 3)" :key="reason">{{ reason }}</p>
        </div>
      </aside>
    </div>

    <div v-if="submission" class="answer-result" role="status" data-testid="answer-result" :data-classification="submission.classification" :data-ambiguous="submission.ambiguousAtTime">
      <div>
        <strong :data-testid="submission.ambiguousAtTime ? 'ambiguous' : 'verdict'" :data-verdict-badge="submission.classification">{{ answerLabel(submission.classification) }}</strong>
        <span v-if="submission.classification === 'indistinguishable' && submission.guessMatchesTruth" class="guess-but-ambiguous" data-testid="correct-guess-but-ambiguous">猜中，但不计为当时可辨</span>
        <p data-testid="verdict-summary">{{ submission.summary }}</p>
        <div class="result-meta">
          <span>评分截止 <output data-testid="answer-cutoff">{{ clock(submission.evidenceCutoff) }}</output></span>
          <span>猜中真标：<b data-testid="guess-matches-truth">{{ submission.guessMatchesTruth ? '是' : '否' }}</b></span>
          <span>当时存活解释：<b data-testid="surviving-ids" :data-raw-ids="submission.survivingHypothesisIds.join('|')">{{ hypothesisLabels(submission.survivingHypothesisIds) }}</b></span>
          <span data-testid="score">得分 <b data-testid="answer-score">{{ submission.earnedScore }}</b> / {{ submission.maxScore }}</span>
        </div>
      </div>
      <button v-if="submission.firstReveal" type="button" class="primary reveal-button" data-testid="jump-first-reveal" @click="jumpToFirstReveal">
        <Crosshair :size="15" />回看首次露出（{{ clock(submission.firstReveal.time) }}），排除另一解释
      </button>
    </div>

    <div v-if="currentTime >= (firstReveal?.time ?? Infinity)" class="reveal-note" data-testid="reveal-note">
      <Eye :size="15" />
      <span><b>首次露出：</b>{{ firstReveal?.explanation }}（排除 {{ hypothesisLabels(firstReveal?.excludedHypothesisIds ?? []) }}）。此证据未计入此前作答评分。</span>
    </div>

    <div v-if="attempts.length" class="attempt-history" data-testid="attempt-history">
      <span v-for="(attempt, index) in attempts" :key="index" :data-classification="attempt.classification">
        第{{ attempts.length - index }}次 · {{ clock(attempt.answeredAt) }} · {{ answerLabel(attempt.classification) }} · {{ attempt.earnedScore }}分
      </span>
    </div>
  </section>
</template>
