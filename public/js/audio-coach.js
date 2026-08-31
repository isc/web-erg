/**
 * Audio Coach - Manages audio message playback during workouts
 */

import { phaseDurationSeconds } from './phases.js'
import { isTestEnv } from './utils.js'

const LLM_POLL_INTERVAL_MS = 15000

export class AudioCoach {
  constructor() {
    this.audioDir = null
    this.textEvents = []
    this.currentAudio = null
    this.llmPollingInterval = null
  }

  async loadTextEvents(doc, phases) {
    const uniqueId = doc.querySelector('uniqueId')?.textContent?.trim()
    if (!uniqueId) {
      console.warn('🎵 Audio Coach: No uniqueId found in XML')
      return false
    }
    this.audioDir = `audio/${uniqueId}/`

    let globalTimeOffset = 0

    const workout = doc.querySelector('workout')

    // `phases` comes from the same parseZwoPhases pass the runner used, in the same order as
    // workout.children: a text event fires on the runner's clock, so an offset computed from a
    // second, slightly different reading of the file drifts for the rest of the session.
    Array.from(workout.children).forEach((child, index) => {
      for (const textEvent of child.querySelectorAll('textevent')) {
        const message = textEvent.getAttribute('message')
        const timeoffset = parseFloat(
          textEvent.getAttribute('timeoffset') || '0'
        )

        if (message?.trim())
          this.textEvents.push({
            time: globalTimeOffset + timeoffset,
            message: message.replace(/&apos;/g, "'"),
            played: false
          })
      }

      globalTimeOffset += phaseDurationSeconds(phases[index])
    })

    console.log(
      `🎵 Audio Coach: Loaded ${this.textEvents.length} text events for workout ${uniqueId}`
    )

    const audioAvailable = await this.checkAudioAvailability()
    if (audioAvailable) {
      console.log(`🎵 Audio coaching available for workout ${uniqueId}`)
      return true
    } else {
      console.log(`🎵 Audio files not found for workout ${uniqueId}`)
      return false
    }
  }

  async callLlmCoach() {
    const state = this.workoutStateProvider()
    try {
      const response = await fetch('/llm_coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state, xml_path: this.xmlPath })
      })
      if (!response.ok) return
      const data = await response.json()
      if (!data.audio_url) return
      this.loadAudio(data.audio_url)
        .play()
        .catch(e => console.warn('LLM audio playback error', e))
    } catch (e) {
      console.warn('LLM coach API error', e)
    }
  }

  /**
   * Which workout the coach is coaching, and how to ask the ride what it is doing. Told once;
   * polling is started and stopped with the ride, so a workout can be sat on the screen — or
   * paused mid-interval — without anyone paying an LLM to talk to nobody.
   */
  useLlmCoach(workoutStateProvider, xmlPath) {
    this.workoutStateProvider = workoutStateProvider
    this.xmlPath = xmlPath
  }

  startLlmCoach() {
    // Every poll behind this one is billed twice over, to OpenAI and to Inworld, and the suite
    // rides a real workout out of the library — which is exactly what puts the coach in LLM mode.
    // Held here rather than in the runner so that everything above this line still runs in a test.
    if (!this.xmlPath || this.llmPollingInterval || isTestEnv()) return
    this.llmPollingInterval = setInterval(
      () => this.callLlmCoach(),
      LLM_POLL_INTERVAL_MS
    )
    this.callLlmCoach()
  }

  stopLlmCoach() {
    clearInterval(this.llmPollingInterval)
    this.llmPollingInterval = null
  }

  async checkAudioAvailability() {
    if (this.textEvents.length === 0) return false

    try {
      const testAudio = new Audio(`${this.audioDir}001.mp3`)
      return new Promise(resolve => {
        testAudio.addEventListener('canplaythrough', () => resolve(true))
        testAudio.addEventListener('error', () => resolve(false))
        testAudio.load()
      })
    } catch {
      return false
    }
  }

  /** One clip at a time: a new message cuts off whatever is still playing. */
  loadAudio(path) {
    this.currentAudio?.pause()
    this.currentAudio = new Audio(path)
    return this.currentAudio
  }

  async playAudioMessage(index) {
    try {
      const filename = String(index).padStart(3, '0') + '.mp3'
      const audio = this.loadAudio(`${this.audioDir}${filename}`)

      return new Promise((resolve, reject) => {
        audio.addEventListener('ended', () => resolve(true))
        audio.addEventListener('error', () => reject(false))
        audio.play().catch(() => reject(false))
      })
    } catch (error) {
      console.warn(`🎵 Audio Coach: Could not play audio ${index}:`, error)
      return false
    }
  }

  checkAndPlayMessages(currentTime) {
    for (let i = 0; i < this.textEvents.length; i++) {
      const event = this.textEvents[i]

      if (currentTime >= event.time && !event.played) {
        event.played = true
        const audioIndex = i + 1 // 1-based for files

        console.log(`🎵 Playing audio ${audioIndex}: "${event.message}"`)
        this.playAudioMessage(audioIndex).catch(() => {
          console.warn(`🎵 Could not play audio for "${event.message}"`)
        })
      }
    }
  }
}
