import { relativeBearing } from '../lib/identity'
import type { CameraPose, MarkFragment, RecognitionScenario, ShoreReference } from '../lib/identity'

function poseAt(time: number): CameraPose {
  return {
    position: { x: -8 + 32 * time, y: 3.2 * Math.sin(time * 0.65) },
    heading: -3 + 3.6 * Math.sin(time * 0.82),
    heel: -5.5 + 8.5 * Math.sin(time * 1.08),
  }
}

const whiteNotch = { id: 'white-notch', name: '白屿岸嘴', position: { x: 260, y: -112 } }
const southPier = { id: 'south-pier', name: '南堤灯桩', position: { x: -92, y: 122 } }

function shoreFor(time: number): ShoreReference {
  const pose = poseAt(time)
  const landmarkBearing = relativeBearing(pose, whiteNotch.position)
  // The marks are to the right of this left-hand shore silhouette.
  return { landmarkId: whiteNotch.id, landmarkBearing, markSide: 'right', uncertaintyDeg: 5 }
}

function fragment(
  id: string,
  time: number,
  actualMarkId: string,
  label: string,
  contour: string[],
  outline: number,
  note: string,
  withShore = true,
): MarkFragment {
  const pose = poseAt(time)
  const markPosition = actualMarkId === 'mark-a' ? { x: 230, y: -22 } : { x: 290, y: -34 }
  return {
    id,
    time,
    label,
    pose,
    bearing: relativeBearing(pose, markPosition),
    contour,
    outline,
    shore: withShore ? shoreFor(time) : undefined,
    note,
    actualMarkId,
  }
}

const oldPose: CameraPose = { position: { x: -72, y: 78 }, heading: 43, heel: 4 }
const oldFragment: MarkFragment = {
  id: 'f-old-pier',
  time: 0.45,
  label: '旧航段的橙色弧边',
  pose: oldPose,
  bearing: 59,
  outline: 0.28,
  contour: ['upper-arc'],
  shore: {
    landmarkId: southPier.id,
    landmarkBearing: relativeBearing(oldPose, southPier.position),
    markSide: 'left',
  },
  note: '颜色相同，但来自另一个船位；没有共同岸标，不能并入当前双标。',
}

export const recognitionScenario: RecognitionScenario = {
  id: 'twin-marks-white-notch',
  title: '白屿岸嘴前的同色双标',
  duration: 8.1,
  suggestedAnswerTime: 5.45,
  turningMarkId: 'mark-a',
  marks: [
    {
      id: 'mark-a',
      name: '左链标',
      position: { x: 230, y: -22 },
      color: '#e77c62',
      features: {
        'upper-arc': 0,
        'left-arc': 0,
        'right-arc': 0,
        'lower-arc': 0,
        'cap-line': 0,
        'crown-notch': 6.3,
      },
    },
    {
      id: 'mark-b',
      name: '右链标',
      position: { x: 290, y: -34 },
      color: '#e77c62',
      features: {
        'upper-arc': 0,
        'left-arc': 0,
        'right-arc': 0,
        'lower-arc': 0,
        'cap-line': 0,
        'round-crown': 6.3,
      },
    },
  ],
  landmarks: [whiteNotch, southPier],
  occlusion: [
    { from: 2.85, to: 4.15, reason: '前帆影扫过，双标短时被挡；投影次序在遮挡中交换' },
  ],
  poseAt,
  fragments: [
    oldFragment,
    fragment('f-01', 1.05, 'mark-b', '遮挡前 · 左投影的上弧', ['upper-arc', 'cap-line'], 0.34, '只看到上弧；白屿岸嘴在其左侧。'),
    fragment('f-02', 1.75, 'mark-a', '遮挡前 · 右投影的左弧', ['left-arc'], 0.27, '船首偏转和横倾后，只剩一段左弧。'),
    {
      ...fragment('f-03-shadow', 3.35, 'mark-a', '帆影中 · 断续色点', [], 0.08, '被前帆影完全削弱，不能作为轮廓证据。', false),
      occluded: true,
      usable: false,
    },
    fragment('f-04', 4.35, 'mark-a', '遮挡后 · 左投影的右弧', ['right-arc', 'cap-line'], 0.39, '投影左右次序已交换；右弧可与此前视角、岸嘴侧别互证。'),
    fragment('f-05', 5.05, 'mark-b', '遮挡后 · 右投影的下弧', ['lower-arc'], 0.31, '仍是 partial outline，两种互换身份解释都能通过。'),
    fragment('f-06-reveal', 6.35, 'mark-a', '首次露出 · 冠顶缺口', ['crown-notch'], 0.44, '冠顶缺口第一次露出；另一种解释中的圆冠没有这个缺口。', false),
    fragment('f-07', 7.15, 'mark-b', '稍后 · 圆冠轮廓', ['round-crown', 'right-arc'], 0.58, '另一标露出圆冠，进一步确认首次露出的判断。', false),
  ],
}
