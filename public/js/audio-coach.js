/**
 * Audio Coach - Manages audio message playback during workouts
 */

import { phaseDurationSeconds } from './phases.js'

export class AudioCoach {
  constructor() {
    this.audioDir = null
    this.textEvents = []
    this.currentAudio = null
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

  async playAudioMessage(index) {
    try {
      const filename = String(index).padStart(3, '0') + '.mp3'
      const audioPath = `${this.audioDir}${filename}`

      if (this.currentAudio) this.currentAudio.pause()
      this.currentAudio = new Audio(audioPath)

      return new Promise((resolve, reject) => {
        this.currentAudio.addEventListener('ended', () => resolve(true))
        this.currentAudio.addEventListener('error', () => reject(false))
        this.currentAudio.play().catch(() => reject(false))
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
