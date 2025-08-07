let batteryWarningShown = false

window.lowBatteryDialog = function () {
  return {
    showDialog: false,
    batteryLevel: 0,
    battery: null,

    async init() {
      if ('getBattery' in navigator) {
        try {
          this.battery = await navigator.getBattery()
          const checkBattery = () => this.updateBatteryStatus()
          checkBattery()
          this.battery.addEventListener('chargingchange', checkBattery)
          this.battery.addEventListener('levelchange', checkBattery)
          this.battery.addEventListener('dischargingtimechange', checkBattery)
        } catch (error) {
          console.warn('Battery API not available:', error)
        }
      }
    },

    updateBatteryStatus() {
      if (!this.battery) return
      this.batteryLevel = Math.round(this.battery.level * 100)
      if (this.battery.charging) return

      // Use discharge time if available and reliable, otherwise fall back to battery level
      const timeThreshold = 1200 // 20 minutes in seconds
      const lowBatteryFallback = 20 // Fallback threshold when time is not reliable

      const dischargingTime = this.battery.dischargingTime
      const shouldShowDialog =
        (dischargingTime > 0 && dischargingTime <= timeThreshold) ||
        ((!dischargingTime ||
          dischargingTime === Infinity ||
          isNaN(dischargingTime)) &&
          this.batteryLevel <= lowBatteryFallback)

      if (shouldShowDialog && !batteryWarningShown) {
        this.showDialog = true
      }
    },

    closeDialog() {
      this.showDialog = false
      batteryWarningShown = true
    }
  }
}
